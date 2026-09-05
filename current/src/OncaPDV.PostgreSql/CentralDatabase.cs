using System.Data;
using Npgsql;
using OncaPDV.Domain;

namespace OncaPDV.PostgreSql;

public sealed record CentralDatabaseOptions(string ConnectionString,string TerminalId,int CommandTimeoutSeconds=15)
{
 public void Validate(){if(string.IsNullOrWhiteSpace(TerminalId))throw new ArgumentException("TerminalId obrigatório.");var b=new NpgsqlConnectionStringBuilder(ConnectionString);if(string.IsNullOrWhiteSpace(b.Host)||string.IsNullOrWhiteSpace(b.Database))throw new ArgumentException("PostgreSQL central inválido.");if(b.Host is "." or "(localdb)"||b.ConnectionString.Contains("Data Source=",StringComparison.OrdinalIgnoreCase))throw new ArgumentException("Arquivo SQLite/rede não é permitido no modo central.");}
}
public sealed class CentralDatabaseUnavailableException(string message,Exception inner):Exception(message,inner);
public sealed record CentralSaleRequest(Guid OperationId,string TerminalId,Guid OperatorId,Guid? CustomerId,IReadOnlyList<CartItem> Items,IReadOnlyList<Payment> Payments,decimal Discount,decimal Total);
public sealed record CentralSaleResult(Guid SaleId,long Number,string TerminalId,Guid OperatorId,decimal Total);

public sealed class PostgresCentralDatabase:IDisposable,IAsyncDisposable
{
 private readonly NpgsqlDataSource _source;private readonly CentralDatabaseOptions _options;
 public PostgresCentralDatabase(CentralDatabaseOptions options){options.Validate();_options=options;var builder=new NpgsqlDataSourceBuilder(options.ConnectionString);_source=builder.Build();}
 public async Task EnsureAvailableAsync(CancellationToken ct=default){try{await using var c=await _source.OpenConnectionAsync(ct);await using var q=new NpgsqlCommand("SELECT 1",c){CommandTimeout=_options.CommandTimeoutSeconds};await q.ExecuteScalarAsync(ct);}catch(Exception ex)when(ex is NpgsqlException or TimeoutException){throw new CentralDatabaseUnavailableException("Banco central indisponível. Operação bloqueada; nenhum fallback local foi criado.",ex);}}
 public async Task MigrateAsync(CancellationToken ct=default){await EnsureAvailableAsync(ct);await using var c=await _source.OpenConnectionAsync(ct);await using var q=new NpgsqlCommand(PostgresSchema.Sql,c){CommandTimeout=_options.CommandTimeoutSeconds};await q.ExecuteNonQueryAsync(ct);}
 public async Task<CentralSaleResult> CompleteSaleAsync(CentralSaleRequest request,CancellationToken ct=default)
 {
  if(request.TerminalId!=_options.TerminalId)throw new InvalidOperationException("TerminalId da operação diverge da configuração local.");if(request.Items.Count==0||request.Payments.Count==0||request.Payments.Sum(x=>x.Amount)!=request.Total)throw new DomainException("Venda/pagamentos inválidos.");
  for(var attempt=1;;attempt++)try{return await CompleteOnce(request,ct);}catch(PostgresException ex)when((ex.SqlState is PostgresErrorCodes.SerializationFailure or PostgresErrorCodes.DeadlockDetected)&&attempt<4){await Task.Delay(TimeSpan.FromMilliseconds(25*attempt),ct);}catch(Exception ex)when(ex is NpgsqlException or TimeoutException){throw new CentralDatabaseUnavailableException("Banco central indisponível. Venda não confirmada; reconecte e consulte pelo OperationId antes de repetir.",ex);}
 }
 private async Task<CentralSaleResult> CompleteOnce(CentralSaleRequest r,CancellationToken ct)
 {
  await using var c=await _source.OpenConnectionAsync(ct);await using var tx=await c.BeginTransactionAsync(IsolationLevel.Serializable,ct);
  await using(var existingCommand=new NpgsqlCommand("SELECT id,number,total FROM sales WHERE operation_id=@operation",c)){existingCommand.Parameters.AddWithValue("operation",r.OperationId);await using var existing=await existingCommand.ExecuteReaderAsync(ct);if(await existing.ReadAsync(ct)){var result=new CentralSaleResult(existing.GetGuid(0),existing.GetInt64(1),r.TerminalId,r.OperatorId,existing.GetDecimal(2));await existing.DisposeAsync();await tx.CommitAsync(ct);return result;}}
  var session=await Scalar<Guid?>(c,"SELECT id FROM cash_sessions WHERE terminal_id=@terminal AND operator_id=@operator AND closed_at IS NULL FOR UPDATE",ct,("terminal",r.TerminalId),("operator",r.OperatorId));if(session is null){session=Guid.NewGuid();await Exec(c,"INSERT INTO cash_sessions(id,terminal_id,operator_id,opened_at,opening_amount) VALUES(@id,@terminal,@operator,now(),0)",ct,("id",session.Value),("terminal",r.TerminalId),("operator",r.OperatorId));}
  var number=(await Scalar<long>(c,"SELECT nextval('sale_number_seq')",ct))!;var saleId=Guid.NewGuid();await Exec(c,"INSERT INTO sales(id,operation_id,number,terminal_id,operator_id,customer_id,cash_session_id,created_at,discount,total) VALUES(@id,@operation,@number,@terminal,@operator,@customer,@session,now(),@discount,@total)",ct,("id",saleId),("operation",r.OperationId),("number",number),("terminal",r.TerminalId),("operator",r.OperatorId),("customer",(object?)r.CustomerId??DBNull.Value),("session",session.Value),("discount",r.Discount),("total",r.Total));
  foreach(var item in r.Items){var left=await Scalar<decimal?>(c,"UPDATE products SET stock=stock-@quantity WHERE id=@product AND active=true AND stock>=@quantity RETURNING stock",ct,("quantity",item.Quantity),("product",item.ProductId));if(left is null)throw new DomainException($"Estoque insuficiente para {item.Name}.");await Exec(c,"INSERT INTO sale_items(id,sale_id,product_id,code,name,quantity,unit_price,subtotal) VALUES(@id,@sale,@product,@code,@name,@quantity,@price,@subtotal)",ct,("id",Guid.NewGuid()),("sale",saleId),("product",item.ProductId),("code",item.Code),("name",item.Name),("quantity",item.Quantity),("price",item.UnitPrice),("subtotal",item.Subtotal));await Exec(c,"INSERT INTO stock_movements(id,product_id,type,quantity,origin_id,terminal_id,created_at) VALUES(@id,@product,'Sale',@quantity,@sale,@terminal,now())",ct,("id",Guid.NewGuid()),("product",item.ProductId),("quantity",-item.Quantity),("sale",saleId),("terminal",r.TerminalId));}
  foreach(var p in r.Payments){await Exec(c,"INSERT INTO payments(id,sale_id,method,amount,received,change_amount) VALUES(@id,@sale,@method,@amount,@received,@change)",ct,("id",Guid.NewGuid()),("sale",saleId),("method",p.Method.ToString()),("amount",p.Amount),("received",(object?)p.Received??DBNull.Value),("change",p.Change));if(p.Method==PaymentMethod.StoreCredit){if(r.CustomerId is null)throw new DomainException("Crediário exige cliente.");await Exec(c,"INSERT INTO credit_accounts(id,customer_id,sale_id,original_amount,balance,status) VALUES(@id,@customer,@sale,@amount,@amount,'Open')",ct,("id",Guid.NewGuid()),("customer",r.CustomerId.Value),("sale",saleId),("amount",p.Amount));}else await Exec(c,"INSERT INTO cash_movements(id,session_id,terminal_id,type,amount,origin_id,reason,created_at) VALUES(@id,@session,@terminal,'Sale',@amount,@sale,@reason,now())",ct,("id",Guid.NewGuid()),("session",session.Value),("terminal",r.TerminalId),("amount",p.Amount),("sale",saleId),("reason",p.Method.ToString()));}
  await tx.CommitAsync(ct);return new(saleId,number,r.TerminalId,r.OperatorId,r.Total);
 }
 private static async Task Exec(NpgsqlConnection c,string sql,CancellationToken ct,params(string,object)[] values){await using var q=new NpgsqlCommand(sql,c);foreach(var x in values)q.Parameters.AddWithValue(x.Item1,x.Item2);await q.ExecuteNonQueryAsync(ct);}
 private static async Task<T?> Scalar<T>(NpgsqlConnection c,string sql,CancellationToken ct,params(string,object)[] values){await using var q=new NpgsqlCommand(sql,c);foreach(var x in values)q.Parameters.AddWithValue(x.Item1,x.Item2);var value=await q.ExecuteScalarAsync(ct);if(value is null or DBNull)return default;if(value is T typed)return typed;var target=Nullable.GetUnderlyingType(typeof(T))??typeof(T);return (T)Convert.ChangeType(value,target);}
 public void Dispose()=>_source.Dispose();public ValueTask DisposeAsync()=>_source.DisposeAsync();
}

public static class PostgresSchema
{
 public const string Sql="""
CREATE SEQUENCE IF NOT EXISTS sale_number_seq;
CREATE TABLE IF NOT EXISTS terminals(id text PRIMARY KEY,description text,active boolean NOT NULL DEFAULT true);
INSERT INTO terminals(id,description) VALUES('CAIXA-01','Caixa 01'),('CAIXA-02','Caixa 02'),('CAIXA-03','Caixa 03'),('ADMIN','Administração') ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS products(id uuid PRIMARY KEY,internal_code text NOT NULL UNIQUE,barcode text UNIQUE,name text NOT NULL,cost_price numeric NOT NULL,sale_price numeric NOT NULL,stock numeric NOT NULL,active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS customers(id uuid PRIMARY KEY,name text NOT NULL,tax_id text,active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS suppliers(id uuid PRIMARY KEY,name text NOT NULL,tax_id text,active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS cash_sessions(id uuid PRIMARY KEY,terminal_id text NOT NULL REFERENCES terminals(id),operator_id uuid NOT NULL,opened_at timestamptz NOT NULL,opening_amount numeric NOT NULL,closed_at timestamptz,informed_total numeric);
CREATE UNIQUE INDEX IF NOT EXISTS ux_open_cash_terminal_operator ON cash_sessions(terminal_id,operator_id) WHERE closed_at IS NULL;
CREATE TABLE IF NOT EXISTS sales(id uuid PRIMARY KEY,operation_id uuid NOT NULL UNIQUE,number bigint NOT NULL UNIQUE,terminal_id text NOT NULL REFERENCES terminals(id),operator_id uuid NOT NULL,customer_id uuid REFERENCES customers(id),cash_session_id uuid NOT NULL REFERENCES cash_sessions(id),created_at timestamptz NOT NULL,discount numeric NOT NULL,total numeric NOT NULL);
CREATE TABLE IF NOT EXISTS sale_items(id uuid PRIMARY KEY,sale_id uuid NOT NULL REFERENCES sales(id),product_id uuid NOT NULL REFERENCES products(id),code text NOT NULL,name text NOT NULL,quantity numeric NOT NULL,unit_price numeric NOT NULL,subtotal numeric NOT NULL);
CREATE TABLE IF NOT EXISTS payments(id uuid PRIMARY KEY,sale_id uuid NOT NULL REFERENCES sales(id),method text NOT NULL,amount numeric NOT NULL,received numeric,change_amount numeric NOT NULL);
CREATE TABLE IF NOT EXISTS cash_movements(id uuid PRIMARY KEY,session_id uuid NOT NULL REFERENCES cash_sessions(id),terminal_id text NOT NULL REFERENCES terminals(id),type text NOT NULL,amount numeric NOT NULL,origin_id uuid,reason text NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS stock_movements(id uuid PRIMARY KEY,product_id uuid NOT NULL REFERENCES products(id),type text NOT NULL,quantity numeric NOT NULL,origin_id uuid NOT NULL,terminal_id text NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS credit_accounts(id uuid PRIMARY KEY,customer_id uuid NOT NULL REFERENCES customers(id),sale_id uuid NOT NULL REFERENCES sales(id),original_amount numeric NOT NULL,balance numeric NOT NULL,status text NOT NULL);
CREATE TABLE IF NOT EXISTS credit_receipts(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES credit_accounts(id),amount numeric NOT NULL,operator_id uuid NOT NULL,terminal_id text NOT NULL,created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS purchases(id uuid PRIMARY KEY,number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,supplier_id uuid NOT NULL REFERENCES suppliers(id),terminal_id text NOT NULL,operator_id uuid NOT NULL,created_at timestamptz NOT NULL,total numeric NOT NULL);
CREATE TABLE IF NOT EXISTS purchase_items(id uuid PRIMARY KEY,purchase_id uuid NOT NULL REFERENCES purchases(id),product_id uuid NOT NULL REFERENCES products(id),quantity numeric NOT NULL,unit_cost numeric NOT NULL,subtotal numeric NOT NULL);
""";
}
