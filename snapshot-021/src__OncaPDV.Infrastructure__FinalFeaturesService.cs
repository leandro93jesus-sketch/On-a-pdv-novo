using System.Text.Json;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed record HeldSale(Guid Id,string Label,Guid? CustomerId,IReadOnlyList<CartItem> Items,decimal Discount,decimal Total,DateTimeOffset CreatedAt);
public sealed record ExpenseEntry(Guid Id,Guid SessionId,decimal Amount,string Description,DateTimeOffset CreatedAt);
public sealed record FinalSaleHistory(Guid Id,long Number,DateTimeOffset CreatedAt,string Customer,string Products,string Payments,decimal Total,string Status);
public sealed record FinalPeriodSummary(int Sales,decimal Revenue,decimal Cash,decimal Pix,decimal Debit,decimal Credit,decimal StoreCredit,decimal CreditReceipts,decimal Expenses,decimal Returns,decimal AverageTicket);

public sealed class FinalFeaturesService
{
    private readonly OncaDatabase _db;
    public FinalFeaturesService(OncaDatabase db){_db=db;EnsureSchema();}

    private void EnsureSchema()
    {
        using var c=_db.Open(); using var q=c.CreateCommand();
        q.CommandText="""
CREATE TABLE IF NOT EXISTS held_sales(id TEXT PRIMARY KEY,label TEXT NOT NULL,customer_id TEXT,items_json TEXT NOT NULL,discount NUMERIC NOT NULL,total NUMERIC NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS store_expenses(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,amount NUMERIC NOT NULL CHECK(amount>0),description TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(session_id) REFERENCES cash_sessions(id));
CREATE TABLE IF NOT EXISTS return_events(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,product_id TEXT NOT NULL,quantity NUMERIC NOT NULL,amount NUMERIC NOT NULL,reason TEXT NOT NULL,operator_id TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exchange_events(id TEXT PRIMARY KEY,sale_id TEXT NOT NULL,returned_product_id TEXT NOT NULL,new_product_id TEXT NOT NULL,returned_quantity NUMERIC NOT NULL,new_quantity NUMERIC NOT NULL,difference NUMERIC NOT NULL,reason TEXT NOT NULL,operator_id TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_held_sales_created ON held_sales(created_at);
CREATE INDEX IF NOT EXISTS ix_store_expenses_created ON store_expenses(created_at);
CREATE INDEX IF NOT EXISTS ix_return_events_sale ON return_events(sale_id);
CREATE INDEX IF NOT EXISTS ix_exchange_events_sale ON exchange_events(sale_id);
""";
        q.ExecuteNonQuery();
    }

    public async Task<HeldSale> HoldAsync(string label,Guid? customerId,IReadOnlyList<CartItem> items,decimal discount,CancellationToken ct=default)
    {
        if(items.Count==0) throw new InvalidOperationException("CARRINHO VAZIO");
        label=string.IsNullOrWhiteSpace(label)?$"Espera {DateTime.Now:HH:mm}":label.Trim();
        var id=Guid.NewGuid(); var at=DateTimeOffset.Now; var total=items.Sum(x=>x.Subtotal)-discount;
        var dto=items.Select(x=>new ItemDto(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitPrice)).ToArray();
        await using var c=_db.Open(); await using var q=c.CreateCommand();
        q.CommandText="INSERT INTO held_sales VALUES($id,$label,$customer,$json,$discount,$total,$at)";
        q.Parameters.AddWithValue("$id",id.ToString());q.Parameters.AddWithValue("$label",label);q.Parameters.AddWithValue("$customer",(object?)customerId?.ToString()??DBNull.Value);q.Parameters.AddWithValue("$json",JsonSerializer.Serialize(dto));q.Parameters.AddWithValue("$discount",discount);q.Parameters.AddWithValue("$total",total);q.Parameters.AddWithValue("$at",at.ToString("O"));
        await q.ExecuteNonQueryAsync(ct); return new(id,label,customerId,items,discount,total,at);
    }

    public async Task<IReadOnlyList<HeldSale>> HoldsAsync(CancellationToken ct=default)
    {
        var list=new List<HeldSale>();await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT id,label,customer_id,items_json,discount,total,created_at FROM held_sales ORDER BY created_at DESC";await using var r=await q.ExecuteReaderAsync(ct);
        while(await r.ReadAsync(ct)){var dto=JsonSerializer.Deserialize<ItemDto[]>(r.GetString(3))??[];var items=dto.Select(x=>new CartItem(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitPrice)).ToArray();list.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.IsDBNull(2)?null:Guid.Parse(r.GetString(2)),items,r.GetDecimal(4),r.GetDecimal(5),DateTimeOffset.Parse(r.GetString(6))));}return list;
    }

    public async Task DeleteHoldAsync(Guid id,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="DELETE FROM held_sales WHERE id=$id";q.Parameters.AddWithValue("$id",id.ToString());await q.ExecuteNonQueryAsync(ct);}

    public async Task<ExpenseEntry> AddExpenseAsync(Guid operatorId,decimal amount,string description,CancellationToken ct=default)
    {
        if(amount<=0)throw new InvalidOperationException("VALOR DA DESPESA DEVE SER MAIOR QUE ZERO");description=(description??"").Trim();if(description.Length<2)throw new InvalidOperationException("INFORME A DESCRIÇÃO DA DESPESA");
        await using var c=_db.Open();await using var tx=await c.BeginTransactionAsync(ct);var session=await OpenSession(c,(SqliteTransaction)tx,operatorId,ct);var id=Guid.NewGuid();var at=DateTimeOffset.Now;
        await Exec(c,(SqliteTransaction)tx,"INSERT INTO store_expenses VALUES($id,$session,$amount,$description,$at)",ct,("$id",id),("$session",session),("$amount",amount),("$description",description),("$at",at.ToString("O")));
        await Exec(c,(SqliteTransaction)tx,"INSERT INTO cash_movements VALUES($id,$session,'Expense',$amount,$origin,$reason,$at)",ct,("$id",Guid.NewGuid()),("$session",session),("$amount",-amount),("$origin",id),("$reason",description),("$at",at.ToString("O")));
        await tx.CommitAsync(ct);return new(id,session,amount,description,at);
    }

    public async Task ReturnItemAsync(Guid saleId,Guid productId,decimal quantity,string reason,Guid operatorId,CancellationToken ct=default)
    {
        if(quantity<=0)throw new InvalidOperationException("QUANTIDADE INVÁLIDA");reason=string.IsNullOrWhiteSpace(reason)?"DEVOLUÇÃO":reason.Trim();
        await using var c=_db.Open();await using var tx=await c.BeginTransactionAsync(ct);
        decimal sold,price;await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="SELECT quantity,unit_price FROM sale_items WHERE sale_id=$sale AND product_id=$product LIMIT 1";q.Parameters.AddWithValue("$sale",saleId.ToString());q.Parameters.AddWithValue("$product",productId.ToString());await using var r=await q.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new InvalidOperationException("ITEM NÃO ENCONTRADO NA VENDA");sold=r.GetDecimal(0);price=r.GetDecimal(1);}        
        decimal already=0;await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="SELECT COALESCE(SUM(quantity),0) FROM return_events WHERE sale_id=$sale AND product_id=$product";q.Parameters.AddWithValue("$sale",saleId.ToString());q.Parameters.AddWithValue("$product",productId.ToString());already=Convert.ToDecimal(await q.ExecuteScalarAsync(ct));}
        if(already+quantity>sold)throw new InvalidOperationException("DEVOLUÇÃO MAIOR QUE A QUANTIDADE VENDIDA");var amount=decimal.Round(quantity*price,2);var id=Guid.NewGuid();var at=DateTimeOffset.Now;
        await Exec(c,(SqliteTransaction)tx,"UPDATE products SET stock=stock+$q WHERE id=$id",ct,("$q",quantity),("$id",productId));
        await Exec(c,(SqliteTransaction)tx,"INSERT INTO stock_movements VALUES($id,$product,'Return',$q,$origin,$reason,$at)",ct,("$id",Guid.NewGuid()),("$product",productId),("$q",quantity),("$origin",saleId),("$reason",reason),("$at",at.ToString("O")));
        await Exec(c,(SqliteTransaction)tx,"INSERT INTO return_events VALUES($id,$sale,$product,$q,$amount,$reason,$op,$at)",ct,("$id",id),("$sale",saleId),("$product",productId),("$q",quantity),("$amount",amount),("$reason",reason),("$op",operatorId),("$at",at.ToString("O")));
        await AdjustRefund(c,(SqliteTransaction)tx,saleId,amount,reason,at,ct);await tx.CommitAsync(ct);
    }

    public async Task ExchangeItemAsync(Guid saleId,Guid returnedProductId,decimal returnedQty,Guid newProductId,decimal newQty,string reason,Guid operatorId,CancellationToken ct=default)
    {
        if(returnedQty<=0||newQty<=0)throw new InvalidOperationException("QUANTIDADE INVÁLIDA");reason=string.IsNullOrWhiteSpace(reason)?"TROCA":reason.Trim();
        await using var c=_db.Open();await using var tx=await c.BeginTransactionAsync(ct);decimal oldPrice,newPrice,newStock,sold;
        await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="SELECT quantity,unit_price FROM sale_items WHERE sale_id=$sale AND product_id=$product LIMIT 1";q.Parameters.AddWithValue("$sale",saleId.ToString());q.Parameters.AddWithValue("$product",returnedProductId.ToString());await using var r=await q.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new InvalidOperationException("ITEM ORIGINAL NÃO ENCONTRADO");sold=r.GetDecimal(0);oldPrice=r.GetDecimal(1);}if(returnedQty>sold)throw new InvalidOperationException("QUANTIDADE DE TROCA MAIOR QUE A VENDIDA");
        await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="SELECT sale_price,stock FROM products WHERE id=$id";q.Parameters.AddWithValue("$id",newProductId.ToString());await using var r=await q.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new InvalidOperationException("NOVO PRODUTO NÃO ENCONTRADO");newPrice=r.GetDecimal(0);newStock=r.GetDecimal(1);}if(newStock<newQty)throw new InvalidOperationException("ESTOQUE INSUFICIENTE PARA TROCA");
        var oldValue=decimal.Round(oldPrice*returnedQty,2);var newValue=decimal.Round(newPrice*newQty,2);var diff=newValue-oldValue;var id=Guid.NewGuid();var at=DateTimeOffset.Now;
        await Exec(c,(SqliteTransaction)tx,"UPDATE products SET stock=stock+$q WHERE id=$id",ct,("$q",returnedQty),("$id",returnedProductId));
        await Exec(c,(SqliteTransaction)tx,"UPDATE products SET stock=stock-$q WHERE id=$id",ct,("$q",newQty),("$id",newProductId));
        await Exec(c,(SqliteTransaction)tx,"INSERT INTO stock_movements VALUES($id,$product,'ExchangeReturn',$q,$origin,$reason,$at)",ct,("$id",Guid.NewGuid()),("$product",returnedProductId),("$q",returnedQty),("$origin",saleId),("$reason",reason),("$at",at.ToString("O")));
        await Exec(c,(SqliteTransaction)tx,"INSERT INTO stock_movements VALUES($id,$product,'ExchangeOut',$q,$origin,$reason,$at)",ct,("$id",Guid.NewGuid()),("$product",newProductId),("$q",-newQty),("$origin",saleId),("$reason",reason),("$at",at.ToString("O")));
        await Exec(c,(SqliteTransaction)tx,"INSERT INTO exchange_events VALUES($id,$sale,$old,$new,$oq,$nq,$diff,$reason,$op,$at)",ct,("$id",id),("$sale",saleId),("$old",returnedProductId),("$new",newProductId),("$oq",returnedQty),("$nq",newQty),("$diff",diff),("$reason",reason),("$op",operatorId),("$at",at.ToString("O")));
        var session=await SaleSession(c,(SqliteTransaction)tx,saleId,ct);if(diff!=0)await Exec(c,(SqliteTransaction)tx,"INSERT INTO cash_movements VALUES($id,$session,'ExchangeDifference',$amount,$origin,$reason,$at)",ct,("$id",Guid.NewGuid()),("$session",session),("$amount",diff),("$origin",saleId),("$reason",reason),("$at",at.ToString("O")));await tx.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<FinalSaleHistory>> HistoryAsync(DateTimeOffset from,DateTimeOffset to,string? search=null,CancellationToken ct=default)
    {
        search=(search??"").Trim();var list=new List<FinalSaleHistory>();await using var c=_db.Open();await using var q=c.CreateCommand();
        q.CommandText="""SELECT s.id,s.number,s.created_at,COALESCE(c.name,'CONSUMIDOR'),COALESCE((SELECT group_concat(i.name || ' x' || i.quantity,' | ') FROM sale_items i WHERE i.sale_id=s.id),''),COALESCE((SELECT group_concat(p.method || ' ' || printf('%.2f',p.amount),' + ') FROM payments p WHERE p.sale_id=s.id),''),s.total,s.status FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.created_at >= $from AND s.created_at < $to AND ($search='' OR CAST(s.number AS TEXT) LIKE '%'||$search||'%' OR COALESCE(c.name,'') LIKE '%'||$search||'%' OR EXISTS(SELECT 1 FROM sale_items x WHERE x.sale_id=s.id AND x.name LIKE '%'||$search||'%') OR EXISTS(SELECT 1 FROM payments p WHERE p.sale_id=s.id AND p.method LIKE '%'||$search||'%')) ORDER BY s.created_at DESC LIMIT 2000""";
        q.Parameters.AddWithValue("$from",from.ToString("O"));q.Parameters.AddWithValue("$to",to.ToString("O"));q.Parameters.AddWithValue("$search",search);await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(new(Guid.Parse(r.GetString(0)),r.GetInt64(1),DateTimeOffset.Parse(r.GetString(2)),r.GetString(3),r.GetString(4),r.GetString(5),r.GetDecimal(6),r.GetString(7)));return list;
    }

    public async Task<FinalPeriodSummary> SummaryAsync(DateTimeOffset from,DateTimeOffset to,CancellationToken ct=default)
    {
        await using var c=_db.Open();async Task<decimal>S(string sql){await using var q=c.CreateCommand();q.CommandText=sql;q.Parameters.AddWithValue("$from",from.ToString("O"));q.Parameters.AddWithValue("$to",to.ToString("O"));return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));}
        var sales=(int)await S("SELECT COUNT(*) FROM sales WHERE status='Completed' AND created_at >= $from AND created_at < $to");var revenue=await S("SELECT COALESCE(SUM(total),0) FROM sales WHERE status='Completed' AND created_at >= $from AND created_at < $to");
        async Task<decimal>P(string m){await using var q=c.CreateCommand();q.CommandText="SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.status='Completed' AND s.created_at >= $from AND s.created_at < $to AND p.method=$m";q.Parameters.AddWithValue("$from",from.ToString("O"));q.Parameters.AddWithValue("$to",to.ToString("O"));q.Parameters.AddWithValue("$m",m);return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));}
        var cash=await P("Cash");var pix=await P("Pix");var debit=await P("Debit");var credit=await P("Credit");var store=await P("StoreCredit");var receipts=await S("SELECT COALESCE(SUM(amount),0) FROM credit_receipts WHERE created_at >= $from AND created_at < $to");var expenses=await S("SELECT COALESCE(SUM(amount),0) FROM store_expenses WHERE created_at >= $from AND created_at < $to");var returns=await S("SELECT COALESCE(SUM(amount),0) FROM return_events WHERE created_at >= $from AND created_at < $to");return new(sales,revenue,cash,pix,debit,credit,store,receipts,expenses,returns,sales==0?0:decimal.Round(revenue/sales,2));
    }

    private static async Task<Guid> OpenSession(SqliteConnection c,SqliteTransaction tx,Guid op,CancellationToken ct){await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT id FROM cash_sessions WHERE operator_id=$op AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1";q.Parameters.AddWithValue("$op",op.ToString());var v=await q.ExecuteScalarAsync(ct);if(v is null)throw new InvalidOperationException("ABRA O CAIXA ANTES DE REGISTRAR DESPESA");return Guid.Parse(Convert.ToString(v)!);}
    private static async Task<Guid> SaleSession(SqliteConnection c,SqliteTransaction tx,Guid sale,CancellationToken ct){await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT cash_session_id FROM sales WHERE id=$id";q.Parameters.AddWithValue("$id",sale.ToString());var v=await q.ExecuteScalarAsync(ct)??throw new InvalidOperationException("VENDA NÃO ENCONTRADA");return Guid.Parse(Convert.ToString(v)!);}
    private static async Task AdjustRefund(SqliteConnection c,SqliteTransaction tx,Guid sale,decimal amount,string reason,DateTimeOffset at,CancellationToken ct){var session=await SaleSession(c,tx,sale,ct);string method="Cash";await using(var q=c.CreateCommand()){q.Transaction=tx;q.CommandText="SELECT method FROM payments WHERE sale_id=$id ORDER BY rowid LIMIT 1";q.Parameters.AddWithValue("$id",sale.ToString());method=Convert.ToString(await q.ExecuteScalarAsync(ct))??"Cash";}if(method=="StoreCredit"){await Exec(c,tx,"UPDATE credit_accounts SET balance=MAX(0,balance-$amount),status=CASE WHEN balance-$amount<=0 THEN 'Paid' ELSE 'Partial' END WHERE sale_id=$sale",ct,("$amount",amount),("$sale",sale));}else await Exec(c,tx,"INSERT INTO cash_movements VALUES($id,$session,'Return',$amount,$origin,$reason,$at)",ct,("$id",Guid.NewGuid()),("$session",session),("$amount",-amount),("$origin",sale),("$reason",reason),("$at",at.ToString("O")));}
    private static async Task Exec(SqliteConnection c,SqliteTransaction tx,string sql,CancellationToken ct,params (string,object?)[] p){await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=sql;foreach(var x in p)q.Parameters.AddWithValue(x.Item1,x.Item2 is Guid g?g.ToString():x.Item2??DBNull.Value);await q.ExecuteNonQueryAsync(ct);}
    private sealed record ItemDto(Guid ProductId,string Code,string Name,decimal Quantity,decimal UnitPrice);
}
