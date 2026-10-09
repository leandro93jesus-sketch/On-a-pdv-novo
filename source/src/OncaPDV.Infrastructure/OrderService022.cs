using System.Text.Json;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed record Order022(Guid Id,long Number,Guid? CustomerId,string Customer,string Phone,IReadOnlyList<CartItem> Items,decimal Discount,decimal Total,string Status,string Notes,DateTimeOffset CreatedAt,DateTimeOffset UpdatedAt,long? SaleNumber);

public sealed class OrderService022
{
    private readonly OncaDatabase _db;
    public OrderService022(OncaDatabase db){_db=db;EnsureSchema();}
    private void EnsureSchema(){using var c=_db.Open();using var q=c.CreateCommand();q.CommandText="""
CREATE TABLE IF NOT EXISTS orders_022(
 id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, customer_id TEXT, customer_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
 items_json TEXT NOT NULL, discount NUMERIC NOT NULL, total NUMERIC NOT NULL, status TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sale_id TEXT, sale_number INTEGER);
CREATE INDEX IF NOT EXISTS ix_orders022_number ON orders_022(number);
CREATE INDEX IF NOT EXISTS ix_orders022_status ON orders_022(status);
CREATE INDEX IF NOT EXISTS ix_orders022_customer ON orders_022(customer_name);
""";q.ExecuteNonQuery();}

    public async Task<Order022> CreateAsync(Guid? customerId,string customer,string phone,string notes,IReadOnlyList<CartItem> items,decimal discount,CancellationToken ct=default)
    {
        if(items.Count==0)throw new InvalidOperationException("CARRINHO VAZIO");customer=(customer??"").Trim();if(customer.Length<2)throw new InvalidOperationException("INFORME O NOME DO CLIENTE");phone=(phone??"").Trim();notes=(notes??"").Trim();
        var id=Guid.NewGuid();var now=DateTimeOffset.Now;var total=items.Sum(x=>x.Subtotal)-discount;var json=JsonSerializer.Serialize(items.Select(x=>new ItemDto(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitPrice)).ToArray());
        await using var c=_db.Open();await using var tx=await c.BeginTransactionAsync(ct);long number;await using(var n=c.CreateCommand()){n.Transaction=(SqliteTransaction)tx;n.CommandText="SELECT COALESCE(MAX(number),0)+1 FROM orders_022";number=Convert.ToInt64(await n.ExecuteScalarAsync(ct));}
        await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="INSERT INTO orders_022(id,number,customer_id,customer_name,phone,items_json,discount,total,status,notes,created_at,updated_at) VALUES($id,$n,$cid,$c,$p,$j,$d,$t,'AwaitingPayment',$o,$at,$at)";q.Parameters.AddWithValue("$id",id.ToString());q.Parameters.AddWithValue("$n",number);q.Parameters.AddWithValue("$cid",(object?)customerId?.ToString()??DBNull.Value);q.Parameters.AddWithValue("$c",customer);q.Parameters.AddWithValue("$p",phone);q.Parameters.AddWithValue("$j",json);q.Parameters.AddWithValue("$d",discount);q.Parameters.AddWithValue("$t",total);q.Parameters.AddWithValue("$o",notes);q.Parameters.AddWithValue("$at",now.ToString("O"));await q.ExecuteNonQueryAsync(ct);}await tx.CommitAsync(ct);return new(id,number,customerId,customer,phone,items,discount,total,"AwaitingPayment",notes,now,now,null);
    }

    public async Task<Order022?> GetAsync(Guid id,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT id,number,customer_id,customer_name,phone,items_json,discount,total,status,notes,created_at,updated_at,sale_number FROM orders_022 WHERE id=$id";q.Parameters.AddWithValue("$id",id.ToString());await using var r=await q.ExecuteReaderAsync(ct);return await r.ReadAsync(ct)?Read(r):null;}

    public async Task<IReadOnlyList<Order022>> SearchAsync(string? search=null,string status="AwaitingPayment",CancellationToken ct=default){search=(search??"").Trim();var list=new List<Order022>();await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT id,number,customer_id,customer_name,phone,items_json,discount,total,status,notes,created_at,updated_at,sale_number FROM orders_022 WHERE ($status='Todos' OR status=$status) AND ($s='' OR CAST(number AS TEXT) LIKE '%'||$s||'%' OR customer_name LIKE '%'||$s||'%' OR phone LIKE '%'||$s||'%' OR substr(created_at,1,10) LIKE '%'||$s||'%') ORDER BY created_at DESC LIMIT 1000";q.Parameters.AddWithValue("$status",status);q.Parameters.AddWithValue("$s",search);await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(Read(r));return list;}

    public async Task UpdateAsync(Guid id,Guid? customerId,string customer,string phone,string notes,IReadOnlyList<CartItem> items,decimal discount,CancellationToken ct=default){if(items.Count==0)throw new InvalidOperationException("CARRINHO VAZIO");customer=(customer??"").Trim();if(customer.Length<2)throw new InvalidOperationException("INFORME O NOME DO CLIENTE");var total=items.Sum(x=>x.Subtotal)-discount;var json=JsonSerializer.Serialize(items.Select(x=>new ItemDto(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitPrice)).ToArray());await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET customer_id=$cid,customer_name=$c,phone=$p,notes=$o,items_json=$j,discount=$d,total=$t,updated_at=$at WHERE id=$id AND status='AwaitingPayment'";q.Parameters.AddWithValue("$cid",(object?)customerId?.ToString()??DBNull.Value);q.Parameters.AddWithValue("$c",customer);q.Parameters.AddWithValue("$p",phone??"");q.Parameters.AddWithValue("$o",notes??"");q.Parameters.AddWithValue("$j",json);q.Parameters.AddWithValue("$d",discount);q.Parameters.AddWithValue("$t",total);q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException("PEDIDO NÃO ESTÁ MAIS AGUARDANDO PAGAMENTO");}

    public async Task CancelAsync(Guid id,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET status='Cancelled',updated_at=$at WHERE id=$id AND status='AwaitingPayment'";q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException("SOMENTE PEDIDO AGUARDANDO PAGAMENTO PODE SER CANCELADO");}

    public async Task<bool> TryClaimForPaymentAsync(Guid id,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET status='Processing',updated_at=$at WHERE id=$id AND status='AwaitingPayment'";q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());return await q.ExecuteNonQueryAsync(ct)==1;}
    public async Task ReleaseClaimAsync(Guid id,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET status='AwaitingPayment',updated_at=$at WHERE id=$id AND status='Processing'";q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());await q.ExecuteNonQueryAsync(ct);}
    public async Task MarkPaidAsync(Guid id,Guid saleId,long saleNumber,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET status='Paid',sale_id=$sale,sale_number=$number,updated_at=$at WHERE id=$id AND status='Processing'";q.Parameters.AddWithValue("$sale",saleId.ToString());q.Parameters.AddWithValue("$number",saleNumber);q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException("PEDIDO JÁ FOI PAGO OU ALTERADO EM OUTRO TERMINAL");}

    public async Task<int> CountPaidAsync(DateTimeOffset from,DateTimeOffset to,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT COUNT(*) FROM orders_022 WHERE status='Paid' AND updated_at >= $f AND updated_at < $t";q.Parameters.AddWithValue("$f",from.ToString("O"));q.Parameters.AddWithValue("$t",to.ToString("O"));return Convert.ToInt32(await q.ExecuteScalarAsync(ct));}

    private static Order022 Read(SqliteDataReader r){var dto=JsonSerializer.Deserialize<ItemDto[]>(r.GetString(5))??[];var items=dto.Select(x=>new CartItem(x.ProductId ?? Guid.Empty,x.Code,x.Name,x.Quantity,x.UnitPrice)).ToArray();return new(Guid.Parse(r.GetString(0)),r.GetInt64(1),r.IsDBNull(2)?null:Guid.Parse(r.GetString(2)),r.GetString(3),r.GetString(4),items,r.GetDecimal(6),r.GetDecimal(7),r.GetString(8),r.GetString(9),DateTimeOffset.Parse(r.GetString(10)),DateTimeOffset.Parse(r.GetString(11)),r.IsDBNull(12)?null:r.GetInt64(12));}
    private sealed record ItemDto(Guid? ProductId,string Code,string Name,decimal Quantity,decimal UnitPrice);
}
