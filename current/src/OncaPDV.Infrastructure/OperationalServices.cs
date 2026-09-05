using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using OncaPDV.Application;
using OncaPDV.Domain;
namespace OncaPDV.Infrastructure;

public sealed record CreditView(Guid Id,Guid CustomerId,string Customer,long SaleNumber,decimal Original,decimal Paid,decimal Balance,DateTimeOffset DueAt,CreditStatus Status);
public sealed record CreditMovement(Guid Id,decimal Amount,PaymentMethod Method,DateTimeOffset CreatedAt,string? Notes);
public sealed record SalesSummary(int Quantity,decimal Gross,decimal Discounts,decimal Net,decimal Cash,decimal Pix,decimal Debit,decimal Credit,decimal StoreCredit,decimal CreditReceipts);
public sealed record SalesHistoryView(Guid Id,long Number,DateTimeOffset CreatedAt,string Customer,string Products,int ItemLines,decimal ItemQuantity,decimal Gross,decimal Discount,decimal Total,string Payments,decimal CashReceived,decimal Change,string Operator,string Status);
public sealed record StockView(Guid Id,string Product,string Code,string? Barcode,string? Category,string? Brand,string Unit,decimal Stock,decimal Minimum,decimal Cost,decimal Price,decimal EstimatedCost,decimal EstimatedSale,decimal MarginPercent,string Status);
public sealed record StockMovementView(Guid Id,DateTimeOffset CreatedAt,string Type,decimal Quantity,string Reason,string Origin);
public sealed record CashSnapshot(Guid SessionId,DateTimeOffset OpenedAt,decimal Opening,decimal CashSales,decimal Pix,decimal Debit,decimal Credit,decimal StoreCreditGenerated,decimal CreditReceipts,decimal Withdrawals,decimal Supplies,decimal ExpectedCash,decimal TotalSales,int SalesCount);
public sealed record CashMovementView(Guid Id,DateTimeOffset CreatedAt,string Type,string Reason,decimal Amount);
public sealed record CashSessionHistoryView(Guid Id,DateTimeOffset OpenedAt,DateTimeOffset ClosedAt,decimal Opening,decimal Expected,decimal Informed,decimal Difference);
public sealed record CashClosing(Guid SessionId,decimal Opening,decimal CashSales,decimal Pix,decimal Debit,decimal Credit,decimal StoreCreditGenerated,decimal CreditReceipts,decimal Withdrawals,decimal Supplies,decimal Expected,decimal Informed,decimal Difference);
public sealed class OperationalService(OncaDatabase db,AppPaths paths)
{
 public Task<string?> EnsureDailyBackupAsync(CancellationToken ct=default){paths.EnsureCreated();var prefix=$"onca-pdv-pro-{DateTime.Now:yyyyMMdd}-";var existing=Directory.GetFiles(paths.Backups,prefix+"*.zip").FirstOrDefault();return existing is null?CreateDaily():Task.FromResult<string?>(existing);async Task<string?> CreateDaily()=>await CreateBackupAsync(30,ct);}
 public async Task<IReadOnlyList<CreditView>> CreditsAsync(string status="Todos",Guid? customer=null,CancellationToken ct=default){var list=new List<CreditView>();await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="""SELECT a.id,a.customer_id,c.name,s.number,a.original_amount,a.balance,a.due_at,a.status FROM credit_accounts a JOIN customers c ON c.id=a.customer_id JOIN sales s ON s.id=a.sale_id WHERE ($customer IS NULL OR a.customer_id=$customer) AND ($status='Todos' OR a.status=$status OR ($status='Overdue' AND a.balance>0 AND a.due_at<$now)) ORDER BY a.due_at DESC LIMIT 500""";q.Parameters.AddWithValue("$customer",(object?)customer?.ToString()??DBNull.Value);q.Parameters.AddWithValue("$status",status);q.Parameters.AddWithValue("$now",DateTimeOffset.Now.ToString("O"));await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct)){var due=DateTimeOffset.Parse(r.GetString(6));var st=Enum.Parse<CreditStatus>(r.GetString(7));if(st is not CreditStatus.Paid&&due<DateTimeOffset.Now)st=CreditStatus.Overdue;var original=r.GetDecimal(4);var balance=r.GetDecimal(5);list.Add(new(Guid.Parse(r.GetString(0)),Guid.Parse(r.GetString(1)),r.GetString(2),r.GetInt64(3),original,original-balance,balance,due,st));}return list;}
 public async Task<IReadOnlyList<CreditMovement>> CreditMovementsAsync(Guid account,CancellationToken ct=default){var list=new List<CreditMovement>();await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT id,amount,method,created_at,notes FROM credit_receipts WHERE account_id=$id ORDER BY created_at";q.Parameters.AddWithValue("$id",account.ToString());await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(new(Guid.Parse(r.GetString(0)),r.GetDecimal(1),Enum.Parse<PaymentMethod>(r.GetString(2)),DateTimeOffset.Parse(r.GetString(3)),r.IsDBNull(4)?null:r.GetString(4)));return list;}
 public async Task<IReadOnlyList<Sale>> CustomerSalesAsync(Guid customer,CancellationToken ct=default){var repo=new SqliteSaleRepository(db,new SystemClock());var ids=new List<Guid>();await using(var c=db.Open()){await using var q=c.CreateCommand();q.CommandText="SELECT id FROM sales WHERE customer_id=$id AND status='Completed' ORDER BY created_at DESC LIMIT 200";q.Parameters.AddWithValue("$id",customer.ToString());await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))ids.Add(Guid.Parse(r.GetString(0)));}var result=new List<Sale>();foreach(var id in ids){var sale=await repo.GetAsync(id,ct);if(sale is not null)result.Add(sale);}return result;}
 public async Task<SalesSummary> SalesSummaryAsync(DateTimeOffset from,DateTimeOffset to,Guid? customer=null,Guid? op=null,PaymentMethod? method=null,CancellationToken ct=default){await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="""SELECT COUNT(*),COALESCE(SUM((SELECT SUM(subtotal) FROM sale_items i WHERE i.sale_id=s.id)),0),COALESCE(SUM(s.discount),0),COALESCE(SUM(s.total),0),COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='Cash')),0),COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='Pix')),0),COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='Debit')),0),COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='Credit')),0),COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='StoreCredit')),0) FROM sales s WHERE s.status='Completed' AND s.created_at >= $from AND s.created_at < $to AND ($customer IS NULL OR s.customer_id=$customer) AND ($op IS NULL OR s.operator_id=$op) AND ($method IS NULL OR EXISTS(SELECT 1 FROM payments pf WHERE pf.sale_id=s.id AND pf.method=$method))""";q.Parameters.AddWithValue("$from",from.ToString("O"));q.Parameters.AddWithValue("$to",to.ToString("O"));q.Parameters.AddWithValue("$customer",(object?)customer?.ToString()??DBNull.Value);q.Parameters.AddWithValue("$op",(object?)op?.ToString()??DBNull.Value);q.Parameters.AddWithValue("$method",(object?)method?.ToString()??DBNull.Value);await using var r=await q.ExecuteReaderAsync(ct);await r.ReadAsync(ct);var receipts=await Scalar(c,"SELECT COALESCE(SUM(amount),0) FROM credit_receipts WHERE created_at >= $from AND created_at < $to",from,to,ct);return new(r.GetInt32(0),r.GetDecimal(1),r.GetDecimal(2),r.GetDecimal(3),r.GetDecimal(4),r.GetDecimal(5),r.GetDecimal(6),r.GetDecimal(7),r.GetDecimal(8),receipts);}
 public async Task<SalesSummary> SalesSummaryFilteredAsync(DateTimeOffset from,DateTimeOffset to,string status="Concluidas",PaymentMethod? method=null,CancellationToken ct=default)
 {
  await using var c=db.Open();await using var q=c.CreateCommand();
  q.CommandText="""
  SELECT COUNT(*),
  COALESCE(SUM((SELECT SUM(subtotal) FROM sale_items i WHERE i.sale_id=s.id)),0),
  COALESCE(SUM(s.discount),0),COALESCE(SUM(s.total),0),
  COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='Cash')),0),
  COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='Pix')),0),
  COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='Debit')),0),
  COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='Credit')),0),
  COALESCE(SUM((SELECT SUM(amount) FROM payments p WHERE p.sale_id=s.id AND p.method='StoreCredit')),0)
  FROM sales s
  WHERE s.created_at >= $from AND s.created_at < $to
    AND ($status='Todos' OR ($status='Concluidas' AND s.status='Completed') OR ($status='Canceladas' AND s.status='Cancelled'))
    AND ($method IS NULL OR EXISTS(SELECT 1 FROM payments pf WHERE pf.sale_id=s.id AND pf.method=$method))
  """;
  q.Parameters.AddWithValue("$from",from.ToString("O"));q.Parameters.AddWithValue("$to",to.ToString("O"));q.Parameters.AddWithValue("$status",status);q.Parameters.AddWithValue("$method",(object?)method?.ToString()??DBNull.Value);
  await using var r=await q.ExecuteReaderAsync(ct);await r.ReadAsync(ct);
  var receipts=status=="Canceladas"?0m:await Scalar(c,"SELECT COALESCE(SUM(amount),0) FROM credit_receipts WHERE created_at >= $from AND created_at < $to",from,to,ct);
  return new(r.GetInt32(0),r.GetDecimal(1),r.GetDecimal(2),r.GetDecimal(3),r.GetDecimal(4),r.GetDecimal(5),r.GetDecimal(6),r.GetDecimal(7),r.GetDecimal(8),receipts);
 }
 public async Task<IReadOnlyList<SalesHistoryView>> SalesHistoryAsync(DateTimeOffset from,DateTimeOffset to,string search="",string payment="Todos",string status="Concluidas",CancellationToken ct=default)
 {
  var list=new List<SalesHistoryView>();await using var c=db.Open();await using var q=c.CreateCommand();
  q.CommandText="""
  SELECT s.id,s.number,s.created_at,COALESCE(c.name,'CONSUMIDOR'),
  COALESCE((SELECT GROUP_CONCAT(si.name || ' x' || printf('%.3g',si.quantity),' | ') FROM sale_items si WHERE si.sale_id=s.id),''),
  (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id=s.id),
  COALESCE((SELECT SUM(quantity) FROM sale_items i WHERE i.sale_id=s.id),0),
  COALESCE((SELECT SUM(subtotal) FROM sale_items i WHERE i.sale_id=s.id),s.total+s.discount),
  s.discount,s.total,
  COALESCE((SELECT GROUP_CONCAT(p.method || ': R$ ' || printf('%.2f',p.amount),' | ') FROM payments p WHERE p.sale_id=s.id),''),
  COALESCE((SELECT SUM(COALESCE(p.received,p.amount)) FROM payments p WHERE p.sale_id=s.id AND p.method='Cash'),0),
  COALESCE((SELECT SUM(p.change_amount) FROM payments p WHERE p.sale_id=s.id AND p.method='Cash'),0),
  substr(upper(replace(s.operator_id,'-','')),1,8),
  s.status
  FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
  WHERE s.created_at >= $from AND s.created_at < $to
    AND ($status='Todos' OR ($status='Concluidas' AND s.status='Completed') OR ($status='Canceladas' AND s.status='Cancelled'))
    AND ($payment='Todos' OR EXISTS(SELECT 1 FROM payments fp WHERE fp.sale_id=s.id AND fp.method=$payment))
    AND ($search='' OR CAST(s.number AS TEXT) LIKE $like OR COALESCE(c.name,'CONSUMIDOR') LIKE $like
      OR EXISTS(SELECT 1 FROM sale_items si WHERE si.sale_id=s.id AND (si.name LIKE $like OR si.code LIKE $like))
      OR EXISTS(SELECT 1 FROM payments sp WHERE sp.sale_id=s.id AND sp.method LIKE $like))
  ORDER BY s.created_at DESC LIMIT 2000
  """;
  q.Parameters.AddWithValue("$from",from.ToString("O"));q.Parameters.AddWithValue("$to",to.ToString("O"));q.Parameters.AddWithValue("$search",search.Trim());q.Parameters.AddWithValue("$like",$"%{search.Trim()}%");q.Parameters.AddWithValue("$payment",payment);q.Parameters.AddWithValue("$status",status);
  await using var r=await q.ExecuteReaderAsync(ct);
  while(await r.ReadAsync(ct))list.Add(new(Guid.Parse(r.GetString(0)),r.GetInt64(1),DateTimeOffset.Parse(r.GetString(2)),r.GetString(3),r.GetString(4),r.GetInt32(5),r.GetDecimal(6),r.GetDecimal(7),r.GetDecimal(8),r.GetDecimal(9),FriendlyPayments(r.GetString(10)),r.GetDecimal(11),r.GetDecimal(12),r.GetString(13),FriendlySaleStatus(r.GetString(14))));
  return list;
 }
 public async Task<Sale?> SaleAsync(Guid id,CancellationToken ct=default)=>await new SqliteSaleRepository(db,new SystemClock()).GetAsync(id,ct);
 public async Task<IReadOnlyList<StockView>> StockAsync(bool belowMinimum=false,string search="",string stockStatus="Todos",CancellationToken ct=default)
 {
  var list=new List<StockView>();await using var c=db.Open();await using var q=c.CreateCommand();
  q.CommandText="""
  SELECT id,name,internal_code,barcode,category,brand,unit,stock,minimum_stock,cost_price,sale_price,
  stock*cost_price,stock*sale_price,
  CASE WHEN cost_price>0 THEN ((sale_price-cost_price)/cost_price)*100 ELSE 0 END,
  CASE WHEN stock<=0 THEN 'SEM ESTOQUE' WHEN stock<=minimum_stock THEN 'ESTOQUE BAIXO' ELSE 'OK' END
  FROM products WHERE active=1
  AND ($below=0 OR stock<=minimum_stock)
  AND ($status='Todos' OR ($status='Baixo' AND stock>0 AND stock<=minimum_stock) OR ($status='Sem estoque' AND stock<=0) OR ($status='Positivo' AND stock>minimum_stock))
  AND ($search='' OR name LIKE $like OR internal_code LIKE $like OR COALESCE(barcode,'') LIKE $like OR COALESCE(category,'') LIKE $like OR COALESCE(brand,'') LIKE $like)
  ORDER BY CASE WHEN stock<=0 THEN 0 WHEN stock<=minimum_stock THEN 1 ELSE 2 END,name LIMIT 2000
  """;
  q.Parameters.AddWithValue("$below",belowMinimum?1:0);q.Parameters.AddWithValue("$status",stockStatus);q.Parameters.AddWithValue("$search",search.Trim());q.Parameters.AddWithValue("$like",$"%{search.Trim()}%");
  await using var r=await q.ExecuteReaderAsync(ct);
  while(await r.ReadAsync(ct))list.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetString(3),r.IsDBNull(4)?null:r.GetString(4),r.IsDBNull(5)?null:r.GetString(5),r.GetString(6),r.GetDecimal(7),r.GetDecimal(8),r.GetDecimal(9),r.GetDecimal(10),r.GetDecimal(11),r.GetDecimal(12),r.GetDecimal(13),r.GetString(14)));
  return list;
 }
 public async Task<IReadOnlyList<StockMovementView>> StockMovementsAsync(Guid productId,int limit=200,CancellationToken ct=default)
 {
  var list=new List<StockMovementView>();await using var c=db.Open();await using var q=c.CreateCommand();
  q.CommandText="SELECT id,created_at,type,quantity,reason,origin_id FROM stock_movements WHERE product_id=$id ORDER BY created_at DESC LIMIT $limit";
  q.Parameters.AddWithValue("$id",productId.ToString());q.Parameters.AddWithValue("$limit",Math.Clamp(limit,1,1000));
  await using var r=await q.ExecuteReaderAsync(ct);
  while(await r.ReadAsync(ct))list.Add(new(Guid.Parse(r.GetString(0)),DateTimeOffset.Parse(r.GetString(1)),FriendlyStockType(r.GetString(2)),r.GetDecimal(3),r.GetString(4),r.GetString(5)));
  return list;
 }
 public async Task<decimal> AdjustStockAsync(Guid productId,decimal newQuantity,Guid operatorId,string reason,CancellationToken ct=default)
 {
  if(newQuantity<0)throw new DomainException("O estoque físico não pode ser negativo.");
  if(string.IsNullOrWhiteSpace(reason))throw new DomainException("Informe o motivo do ajuste de estoque.");
  await using var c=db.Open();await using var tx=await c.BeginTransactionAsync(ct);
  decimal current;
  await using(var read=c.CreateCommand()){read.Transaction=(SqliteTransaction)tx;read.CommandText="SELECT stock FROM products WHERE id=$id AND active=1";read.Parameters.AddWithValue("$id",productId.ToString());var value=await read.ExecuteScalarAsync(ct);if(value is null||value is DBNull)throw new DomainException("Produto não encontrado.");current=Convert.ToDecimal(value);}
  var delta=newQuantity-current;
  if(delta==0){await tx.CommitAsync(ct);return current;}
  await using(var update=c.CreateCommand()){update.Transaction=(SqliteTransaction)tx;update.CommandText="UPDATE products SET stock=$stock WHERE id=$id";update.Parameters.AddWithValue("$stock",newQuantity);update.Parameters.AddWithValue("$id",productId.ToString());await update.ExecuteNonQueryAsync(ct);}
  var movementId=Guid.NewGuid();
  await using(var movement=c.CreateCommand()){movement.Transaction=(SqliteTransaction)tx;movement.CommandText="INSERT INTO stock_movements(id,product_id,type,quantity,origin_id,reason,created_at) VALUES($mid,$product,'Adjustment',$delta,$origin,$reason,$at)";movement.Parameters.AddWithValue("$mid",movementId.ToString());movement.Parameters.AddWithValue("$product",productId.ToString());movement.Parameters.AddWithValue("$delta",delta);movement.Parameters.AddWithValue("$origin",operatorId.ToString());movement.Parameters.AddWithValue("$reason",reason.Trim());movement.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await movement.ExecuteNonQueryAsync(ct);}
  await using(var audit=c.CreateCommand()){audit.Transaction=(SqliteTransaction)tx;audit.CommandText="INSERT INTO audit_log(id,user_id,action,entity,entity_id,before_json,after_json,reason,created_at) VALUES($id,$user,'STOCK_ADJUSTMENT','Product',$product,$before,$after,$reason,$at)";audit.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());audit.Parameters.AddWithValue("$user",operatorId.ToString());audit.Parameters.AddWithValue("$product",productId.ToString());audit.Parameters.AddWithValue("$before",JsonSerializer.Serialize(new{Stock=current}));audit.Parameters.AddWithValue("$after",JsonSerializer.Serialize(new{Stock=newQuantity,Delta=delta,MovementId=movementId}));audit.Parameters.AddWithValue("$reason",reason.Trim());audit.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await audit.ExecuteNonQueryAsync(ct);}
  await tx.CommitAsync(ct);return newQuantity;
 }
 public async Task<decimal> LastClosedCashBalanceAsync(Guid operatorId,CancellationToken ct=default)
 {
  await using var c=db.Open();await using var q=c.CreateCommand();
  q.CommandText="SELECT COALESCE(informed_total,0) FROM cash_sessions WHERE operator_id=$op AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1";
  q.Parameters.AddWithValue("$op",operatorId.ToString());
  var value=await q.ExecuteScalarAsync(ct);
  return value is null || value is DBNull ? 0m : Convert.ToDecimal(value);
 }
 public async Task<CashSnapshot> OpenCashAsync(Guid operatorId,CancellationToken ct=default)
 {
  var last=await LastClosedCashBalanceAsync(operatorId,ct);
  await new SqliteCashSessionRepository(db,new SystemClock()).GetOrOpenAsync(operatorId,last,ct);
  return await CashSnapshotAsync(operatorId,ct);
 }
 public async Task<IReadOnlyList<CashSessionHistoryView>> CashSessionHistoryAsync(Guid operatorId,int count=10,CancellationToken ct=default)
 {
  var list=new List<CashSessionHistoryView>();await using var c=db.Open();await using var q=c.CreateCommand();
  q.CommandText="""
  SELECT cs.id,cs.opened_at,cs.closed_at,cs.opening_amount,
    cs.opening_amount
    + COALESCE((SELECT SUM(amount) FROM cash_movements m WHERE m.session_id=cs.id AND m.type='Sale' AND m.reason='Cash'),0)
    + COALESCE((SELECT SUM(amount) FROM cash_movements m WHERE m.session_id=cs.id AND m.type='StoreCreditReceipt'),0)
    + COALESCE((SELECT SUM(amount) FROM cash_movements m WHERE m.session_id=cs.id AND m.type='Supply'),0)
    - COALESCE((SELECT SUM(amount) FROM cash_movements m WHERE m.session_id=cs.id AND m.type='Withdrawal'),0) AS expected,
    COALESCE(cs.informed_total,0)
  FROM cash_sessions cs
  WHERE cs.operator_id=$op AND cs.closed_at IS NOT NULL
  ORDER BY cs.closed_at DESC LIMIT $count
  """;
  q.Parameters.AddWithValue("$op",operatorId.ToString());q.Parameters.AddWithValue("$count",Math.Clamp(count,1,100));
  await using var r=await q.ExecuteReaderAsync(ct);
  while(await r.ReadAsync(ct)){var expected=r.GetDecimal(4);var informed=r.GetDecimal(5);list.Add(new(Guid.Parse(r.GetString(0)),DateTimeOffset.Parse(r.GetString(1)),DateTimeOffset.Parse(r.GetString(2)),r.GetDecimal(3),expected,informed,informed-expected));}
  return list;
 }
 public async Task<CashSnapshot> CashSnapshotAsync(Guid operatorId,CancellationToken ct=default)
 {
  await using var c=db.Open();await using var q=c.CreateCommand();
  q.CommandText="SELECT id,opened_at,opening_amount FROM cash_sessions WHERE operator_id=$op AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1";q.Parameters.AddWithValue("$op",operatorId.ToString());
  await using var r=await q.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new InvalidOperationException("CAIXA NÃO ESTÁ ABERTO");
  var id=Guid.Parse(r.GetString(0));var opened=DateTimeOffset.Parse(r.GetString(1));var opening=r.GetDecimal(2);await r.DisposeAsync();
  async Task<decimal>M(string type,string? reason=null){await using var x=c.CreateCommand();x.CommandText="SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id=$id AND type=$type AND ($reason IS NULL OR reason=$reason)";x.Parameters.AddWithValue("$id",id.ToString());x.Parameters.AddWithValue("$type",type);x.Parameters.AddWithValue("$reason",(object?)reason??DBNull.Value);return Convert.ToDecimal(await x.ExecuteScalarAsync(ct));}
  var cash=await M("Sale","Cash");var pix=await M("Sale","Pix");var debit=await M("Sale","Debit");var credit=await M("Sale","Credit");var receipts=await M("StoreCreditReceipt");var supplies=await M("Supply");var withdrawals=await M("Withdrawal");
  var store=await Scalar(c,"SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.cash_session_id=$id AND s.status='Completed' AND p.method='StoreCredit'",id,ct);
  await using var count=c.CreateCommand();count.CommandText="SELECT COUNT(*) FROM sales WHERE cash_session_id=$id AND status='Completed'";count.Parameters.AddWithValue("$id",id.ToString());var salesCount=Convert.ToInt32(await count.ExecuteScalarAsync(ct));
  var expected=opening+cash+receipts+supplies-withdrawals;var totalSales=cash+pix+debit+credit+store;
  return new(id,opened,opening,cash,pix,debit,credit,store,receipts,withdrawals,supplies,expected,totalSales,salesCount);
 }
 public async Task<IReadOnlyList<CashMovementView>> CashMovementsAsync(Guid sessionId,CancellationToken ct=default)
 {
  var list=new List<CashMovementView>();await using var c=db.Open();await using var q=c.CreateCommand();
  q.CommandText="SELECT id,created_at,type,reason,amount FROM cash_movements WHERE session_id=$id ORDER BY created_at DESC LIMIT 300";q.Parameters.AddWithValue("$id",sessionId.ToString());
  await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(new(Guid.Parse(r.GetString(0)),DateTimeOffset.Parse(r.GetString(1)),r.GetString(2),r.GetString(3),r.GetDecimal(4)));return list;
 }
 public async Task RegisterCashMovementAsync(Guid operatorId,CashMovementType type,decimal amount,string reason,CancellationToken ct=default)
 {
  if(type is not(CashMovementType.Supply or CashMovementType.Withdrawal))throw new ArgumentException("Movimento de caixa inválido.");
  if(amount<=0)throw new DomainException("Informe um valor maior que zero.");
  var session=await new SqliteCashSessionRepository(db,new SystemClock()).GetOrOpenAsync(operatorId,0,ct);
  await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="INSERT INTO cash_movements(id,session_id,type,amount,origin_id,reason,created_at) VALUES($id,$session,$type,$amount,NULL,$reason,$at)";
  q.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());q.Parameters.AddWithValue("$session",session.Id.ToString());q.Parameters.AddWithValue("$type",type.ToString());q.Parameters.AddWithValue("$amount",amount);q.Parameters.AddWithValue("$reason",string.IsNullOrWhiteSpace(reason)?(type==CashMovementType.Supply?"SUPRIMENTO":"SANGRIA"):reason.Trim());q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await q.ExecuteNonQueryAsync(ct);
 }
 public async Task<CashClosing> CloseCashAsync(Guid operatorId,decimal informed,CancellationToken ct=default){await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT id,opening_amount FROM cash_sessions WHERE operator_id=$op AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1";q.Parameters.AddWithValue("$op",operatorId.ToString());await using var r=await q.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new InvalidOperationException("CAIXA NÃO ESTÁ ABERTO");var id=Guid.Parse(r.GetString(0));var opening=r.GetDecimal(1);await r.DisposeAsync();async Task<decimal>M(string type,string? reason=null){await using var x=c.CreateCommand();x.CommandText="SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id=$id AND type=$type AND ($reason IS NULL OR reason=$reason)";x.Parameters.AddWithValue("$id",id.ToString());x.Parameters.AddWithValue("$type",type);x.Parameters.AddWithValue("$reason",(object?)reason??DBNull.Value);return Convert.ToDecimal(await x.ExecuteScalarAsync(ct));}var cash=await M("Sale","Cash");var pix=await M("Sale","Pix");var debit=await M("Sale","Debit");var credit=await M("Sale","Credit");var receipts=await M("StoreCreditReceipt");var supply=await M("Supply");var withdrawal=await M("Withdrawal");var store=await Scalar(c,"SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.cash_session_id=$id AND p.method='StoreCredit'",id,ct);var expected=opening+cash+receipts+supply-withdrawal;await using var close=c.CreateCommand();close.CommandText="UPDATE cash_sessions SET closed_at=$at,informed_total=$v WHERE id=$id AND closed_at IS NULL";close.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));close.Parameters.AddWithValue("$v",informed);close.Parameters.AddWithValue("$id",id.ToString());await close.ExecuteNonQueryAsync(ct);return new(id,opening,cash,pix,debit,credit,store,receipts,withdrawal,supply,expected,informed,informed-expected);}
 public async Task<string> SalesCsvAsync(IReadOnlyList<SalesHistoryView> rows,DateTimeOffset from,DateTimeOffset to,CancellationToken ct=default)
 {
  paths.EnsureCreated();var file=Path.Combine(paths.Exports,$"historico-vendas-{DateTime.Now:yyyyMMdd-HHmmssfff}.csv");
  static string E(object? value){var s=Convert.ToString(value,CultureInfo.GetCultureInfo("pt-BR"))??string.Empty;return "\""+s.Replace("\"","\"\"")+"\"";}
  var sb=new StringBuilder();sb.AppendLine("Venda;DataHora;Cliente;Produtos;Status;Linhas;Quantidade;Bruto;Desconto;Total;Pagamentos;RecebidoDinheiro;Troco;Operador");
  foreach(var x in rows)sb.AppendLine(string.Join(";",new[]{E(x.Number.ToString("000000")),E(x.CreatedAt.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss")),E(x.Customer),E(x.Products),E(x.Status),E(x.ItemLines),E(x.ItemQuantity.ToString("N2")),E(x.Gross.ToString("N2")),E(x.Discount.ToString("N2")),E(x.Total.ToString("N2")),E(x.Payments),E(x.CashReceived.ToString("N2")),E(x.Change.ToString("N2")),E(x.Operator)}));
  await File.WriteAllTextAsync(file,"\uFEFF"+sb,Encoding.UTF8,ct);return file;
 }
 public async Task<string> SalePdfAsync(Sale sale,bool secondCopy=false,CancellationToken ct=default)=>await PdfAsync(secondCopy?"SEGUNDA VIA — VENDA":"RECIBO DE VENDA",[$"Venda: {sale.Number:000000}",$"Data: {sale.CreatedAt:dd/MM/yyyy HH:mm}",..sale.Items.Select(x=>$"{x.Name}  {x.Quantity:N2} x {x.UnitPrice:C} = {x.Subtotal:C}"),$"Desconto: {sale.Discount:C}",$"TOTAL: {sale.Total:C}",$"Pagamentos: {string.Join(" | ",sale.Payments.Select(x=>$"{x.Method}: {x.Amount:C}"))}"],ct);
 public Task<string> CreditPdfAsync(CreditView a,IReadOnlyList<CreditMovement> movements,CancellationToken ct=default)=>PdfAsync("EXTRATO DE CREDIÁRIO",[$"Cliente: {a.Customer}",$"Venda: {a.SaleNumber:000000}",$"Original: {a.Original:C}",$"Pago: {a.Paid:C}",$"Saldo: {a.Balance:C}",$"Vencimento: {a.DueAt:dd/MM/yyyy}",$"Status: {a.Status}","MOVIMENTOS",..movements.Select(x=>$"{x.CreatedAt:dd/MM/yyyy HH:mm}  {x.Method}  {x.Amount:C}")],ct);
 public Task<string> ReceiptPdfAsync(CreditView a,CreditReceipt receipt,CancellationToken ct=default)=>PdfAsync("COMPROVANTE DE RECEBIMENTO",[$"Cliente: {a.Customer}",$"Venda: {a.SaleNumber:000000}",$"Data: {receipt.CreatedAt:dd/MM/yyyy HH:mm}",$"Forma: {receipt.Method}",$"Valor recebido: {receipt.Amount:C}",$"Saldo anterior: {(a.Balance+receipt.Amount):C}",$"Saldo atual: {a.Balance:C}"],ct);
 public Task<string> ClosingPdfAsync(CashClosing x,CancellationToken ct=default)=>PdfAsync("FECHAMENTO DE CAIXA",[$"Saldo inicial: {x.Opening:C}",$"Vendas dinheiro: {x.CashSales:C}",$"PIX: {x.Pix:C}",$"Débito: {x.Debit:C}",$"Crédito: {x.Credit:C}",$"Crediário gerado: {x.StoreCreditGenerated:C}",$"Recebimentos crediário: {x.CreditReceipts:C}",$"Sangrias: {x.Withdrawals:C}",$"Suprimentos: {x.Supplies:C}",$"VALOR ESPERADO: {x.Expected:C}",$"VALOR INFORMADO: {x.Informed:C}",$"DIFERENÇA: {x.Difference:C}"],ct);
 public Task<string> SalesReportPdfAsync(SalesSummary x,DateTimeOffset from,DateTimeOffset to,CancellationToken ct=default)=>PdfAsync("RELATÓRIO DE VENDAS",[$"Período: {from:dd/MM/yyyy} a {to:dd/MM/yyyy}",$"Quantidade: {x.Quantity}",$"Bruto: {x.Gross:C}",$"Descontos: {x.Discounts:C}",$"Líquido: {x.Net:C}",$"Dinheiro: {x.Cash:C}",$"PIX: {x.Pix:C}",$"Débito: {x.Debit:C}",$"Crédito: {x.Credit:C}",$"Crediário: {x.StoreCredit:C}",$"Recebimentos de crediário (separados): {x.CreditReceipts:C}"],ct);
 private async Task<string> PdfAsync(string title,IEnumerable<string> lines,CancellationToken ct){paths.EnsureCreated();var file=Path.Combine(paths.Exports,$"{Slug(title)}-{DateTime.Now:yyyyMMdd-HHmmssfff}.pdf");await File.WriteAllBytesAsync(file,SimplePdf.Create(title,lines),ct);return file;}
 public async Task<string> CreateBackupAsync(int retention=30,CancellationToken ct=default){paths.EnsureCreated();var stamp=DateTime.Now.ToString("yyyyMMdd-HHmmssfff");var temp=Path.Combine(paths.Backups,$".{stamp}.tmp");Directory.CreateDirectory(temp);var dbFile=Path.Combine(temp,"database.db");await using(var source=db.Open()){await using var dest=new SqliteConnection($"Data Source={dbFile};Pooling=False");await dest.OpenAsync(ct);source.BackupDatabase(dest);}string checksum;await using(var input=File.Open(dbFile,FileMode.Open,FileAccess.Read,FileShare.Read))checksum=Convert.ToHexString(await SHA256.HashDataAsync(input,ct));var manifest=new BackupManifest(3,DateTimeOffset.Now,checksum,"database.db",new[]{"PHYSICAL_PRINTING=false","FISCAL=MOCK"});await File.WriteAllTextAsync(Path.Combine(temp,"manifest.json"),JsonSerializer.Serialize(manifest),ct);var target=Path.Combine(paths.Backups,$"onca-pdv-pro-{stamp}.zip");ZipFile.CreateFromDirectory(temp,target);Directory.Delete(temp,true);await ValidateBackupAsync(target,ct);foreach(var old in Directory.GetFiles(paths.Backups,"*.zip").OrderByDescending(File.GetCreationTimeUtc).Skip(retention))File.Delete(old);return target;}
 public async Task ValidateBackupAsync(string zip,CancellationToken ct=default){using var archive=ZipFile.OpenRead(zip);var me=archive.GetEntry("manifest.json")??throw new InvalidDataException("Manifesto ausente.");BackupManifest? manifest;await using(var s=me.Open())manifest=await JsonSerializer.DeserializeAsync<BackupManifest>(s,cancellationToken:ct);if(manifest is null||manifest.SchemaVersion<1||manifest.DatabaseFile!="database.db")throw new InvalidDataException("Manifesto inválido.");var de=archive.GetEntry(manifest.DatabaseFile)??throw new InvalidDataException("Banco ausente.");await using var ds=de.Open();var hash=Convert.ToHexString(await SHA256.HashDataAsync(ds,ct));if(!hash.Equals(manifest.Sha256,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Checksum inválido.");}
 public async Task<string> ImportBackupAsync(string source,CancellationToken ct=default){if(string.IsNullOrWhiteSpace(source)||!File.Exists(source))throw new FileNotFoundException("Arquivo de backup não encontrado.",source);if(!string.Equals(Path.GetExtension(source),".zip",StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Selecione um backup ONCA no formato ZIP.");await ValidateBackupAsync(source,ct);paths.EnsureCreated();var target=Path.Combine(paths.Backups,$"importado-{DateTime.Now:yyyyMMdd-HHmmssfff}-{Path.GetFileName(source)}");File.Copy(source,target,false);try{await ValidateBackupAsync(target,ct);return target;}catch{if(File.Exists(target))File.Delete(target);throw;}}
 public async Task RestoreAsync(string zip,CancellationToken ct=default){await ValidateBackupAsync(zip,ct);var safety=await CreateBackupAsync(30,ct);var temp=Path.Combine(Path.GetTempPath(),"onca-restore-"+Guid.NewGuid());Directory.CreateDirectory(temp);try{ZipFile.ExtractToDirectory(zip,temp);var candidate=Path.Combine(temp,"database.db");await using(var check=new SqliteConnection($"Data Source={candidate};Mode=ReadOnly")){await check.OpenAsync(ct);await using var q=check.CreateCommand();q.CommandText="PRAGMA integrity_check";if(!string.Equals(Convert.ToString(await q.ExecuteScalarAsync(ct)),"ok",StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Banco truncado ou corrompido.");}SqliteConnection.ClearAllPools();File.Copy(candidate,db.DatabasePath,true);db.Migrate();if(db.IntegrityCheck()!="ok")throw new InvalidDataException("Falha após migrations.");}catch{await ExtractDatabaseAsync(safety,db.DatabasePath);db.Migrate();throw;}finally{Directory.Delete(temp,true);}}
 private static async Task ExtractDatabaseAsync(string zip,string target){using var a=ZipFile.OpenRead(zip);var e=a.GetEntry("database.db")!;await using var input=e.Open();await using var output=File.Create(target);await input.CopyToAsync(output);}
 private static async Task<decimal> Scalar(SqliteConnection c,string sql,DateTimeOffset from,DateTimeOffset to,CancellationToken ct){await using var q=c.CreateCommand();q.CommandText=sql;q.Parameters.AddWithValue("$from",from.ToString("O"));q.Parameters.AddWithValue("$to",to.ToString("O"));return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));}
 private static async Task<decimal> Scalar(SqliteConnection c,string sql,Guid id,CancellationToken ct){await using var q=c.CreateCommand();q.CommandText=sql;q.Parameters.AddWithValue("$id",id.ToString());return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));}
 private static string FriendlyPayments(string value)=>value.Replace("Cash:","Dinheiro:",StringComparison.OrdinalIgnoreCase).Replace("Pix:","PIX:",StringComparison.OrdinalIgnoreCase).Replace("Debit:","Débito:",StringComparison.OrdinalIgnoreCase).Replace("Credit:","Crédito:",StringComparison.OrdinalIgnoreCase).Replace("StoreCredit:","Crediário:",StringComparison.OrdinalIgnoreCase);
 private static string FriendlySaleStatus(string value)=>value switch{"Completed"=>"CONCLUÍDA","Cancelled"=>"CANCELADA",_=>value.ToUpperInvariant()};
 private static string FriendlyStockType(string value)=>value switch{"Sale"=>"VENDA","Purchase"=>"COMPRA","Return"=>"DEVOLUÇÃO","Adjustment"=>"AJUSTE","Cancellation"=>"CANCELAMENTO","Inventory"=>"INVENTÁRIO",_=>value.ToUpperInvariant()};
 private static string Slug(string s)=>string.Concat(s.Normalize(NormalizationForm.FormD).Where(c=>char.IsLetterOrDigit(c)||c==' ').Select(c=>c==' '?'_':c)).ToLowerInvariant();
 private sealed record BackupManifest(int SchemaVersion,DateTimeOffset CreatedAt,string Sha256,string DatabaseFile,string[] Settings);
}
internal static class SimplePdf
{
 public static byte[] Create(string title,IEnumerable<string> lines){static string E(string s)=>s.Replace("\\","\\\\").Replace("(","\\(").Replace(")","\\)");var all=new[]{title,"ONÇA PDV PRO",$"Gerado em {DateTime.Now:dd/MM/yyyy HH:mm}",""}.Concat(lines).ToArray();var content=new StringBuilder("BT /F1 17 Tf 50 790 Td ");for(var i=0;i<all.Length;i++){if(i==1)content.Append("/F1 11 Tf ");content.Append($"({E(all[i])}) Tj 0 -22 Td ");}content.Append("ET");var latin=Encoding.Latin1;var stream=latin.GetBytes(content.ToString());var objects=new[]{"<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",$"<< /Length {stream.Length} >>\nstream\n{latin.GetString(stream)}\nendstream","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"};var ms=new MemoryStream();void W(string x){var b=latin.GetBytes(x);ms.Write(b);}W("%PDF-1.4\n");var offsets=new List<long>{0};for(var i=0;i<objects.Length;i++){offsets.Add(ms.Position);W($"{i+1} 0 obj\n{objects[i]}\nendobj\n");}var xref=ms.Position;W($"xref\n0 {objects.Length+1}\n0000000000 65535 f \n");foreach(var o in offsets.Skip(1))W($"{o:0000000000} 00000 n \n");W($"trailer << /Size {objects.Length+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF");return ms.ToArray();}
}
