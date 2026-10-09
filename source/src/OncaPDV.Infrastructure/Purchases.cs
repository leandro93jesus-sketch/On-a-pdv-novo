using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed class SupplierService(OncaDatabase db)
{
    public async Task SaveAsync(Supplier supplier,CancellationToken ct=default)
    {
        if(string.IsNullOrWhiteSpace(supplier.Name))throw new DomainException("Nome do fornecedor é obrigatório.");
        await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="""INSERT INTO suppliers(id,name,tax_id,phone,notes,active) VALUES($id,$name,$tax,$phone,$notes,$active) ON CONFLICT(id) DO UPDATE SET name=excluded.name,tax_id=excluded.tax_id,phone=excluded.phone,notes=excluded.notes,active=excluded.active""";q.Parameters.AddWithValue("$id",supplier.Id.ToString());q.Parameters.AddWithValue("$name",supplier.Name.Trim());q.Parameters.AddWithValue("$tax",(object?)supplier.TaxId??DBNull.Value);q.Parameters.AddWithValue("$phone",(object?)supplier.Phone??DBNull.Value);q.Parameters.AddWithValue("$notes",(object?)supplier.Notes??DBNull.Value);q.Parameters.AddWithValue("$active",supplier.Active?1:0);await q.ExecuteNonQueryAsync(ct);
    }
    public async Task<IReadOnlyList<Supplier>> SearchAsync(string term="",CancellationToken ct=default)
    {
        var list=new List<Supplier>();await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT id,name,tax_id,phone,notes,active FROM suppliers WHERE name LIKE $term OR tax_id LIKE $term OR phone LIKE $term ORDER BY name LIMIT 200";q.Parameters.AddWithValue("$term",$"%{term.Trim()}%");await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.IsDBNull(2)?null:r.GetString(2),r.IsDBNull(3)?null:r.GetString(3),r.IsDBNull(4)?null:r.GetString(4),r.GetInt32(5)==1));return list;
    }
}

public sealed class PurchaseService(OncaDatabase db)
{
    public async Task<Purchase> CompleteAsync(Guid supplierId,IReadOnlyList<PurchaseItem> items,string? documentNumber=null,string? notes=null,CancellationToken ct=default)
    {
        if(items.Count==0||items.Any(x=>x.Quantity<=0||x.UnitCost<0))throw new DomainException("Compra deve possuir itens válidos.");
        await using var c=db.Open();await using var tx=await c.BeginTransactionAsync(ct);try
        {
            await using(var exists=c.CreateCommand()){exists.Transaction=(SqliteTransaction)tx;exists.CommandText="SELECT COUNT(*) FROM suppliers WHERE id=$id AND active=1";exists.Parameters.AddWithValue("$id",supplierId.ToString());if(Convert.ToInt64(await exists.ExecuteScalarAsync(ct))!=1)throw new DomainException("Fornecedor não encontrado ou inativo.");}
            long number;await using(var next=c.CreateCommand()){next.Transaction=(SqliteTransaction)tx;next.CommandText="SELECT COALESCE(MAX(number),0)+1 FROM purchases";number=Convert.ToInt64(await next.ExecuteScalarAsync(ct));}
            var purchase=new Purchase(Guid.NewGuid(),number,supplierId,DateTimeOffset.Now,items.ToArray(),items.Sum(x=>x.Subtotal),documentNumber,notes);
            await Exec(c,(SqliteTransaction)tx,"INSERT INTO purchases VALUES($id,$number,$supplier,$at,$total,$document,$notes)",ct,("$id",purchase.Id),("$number",number),("$supplier",supplierId),("$at",purchase.CreatedAt.ToString("O")),("$total",purchase.Total),("$document",(object?)documentNumber??DBNull.Value),("$notes",(object?)notes??DBNull.Value));
            foreach(var item in items){var changed=await Exec(c,(SqliteTransaction)tx,"UPDATE products SET stock=stock+$q,cost_price=$cost WHERE id=$product AND active=1",ct,("$q",item.Quantity),("$cost",item.UnitCost),("$product",item.ProductId));if(changed!=1)throw new DomainException($"Produto não encontrado: {item.Name}.");await Exec(c,(SqliteTransaction)tx,"INSERT INTO purchase_items VALUES($id,$purchase,$product,$code,$name,$q,$cost,$subtotal)",ct,("$id",Guid.NewGuid()),("$purchase",purchase.Id),("$product",item.ProductId),("$code",item.Code),("$name",item.Name),("$q",item.Quantity),("$cost",item.UnitCost),("$subtotal",item.Subtotal));await Exec(c,(SqliteTransaction)tx,"INSERT INTO stock_movements VALUES($id,$product,'Purchase',$q,$purchase,'ENTRADA DE COMPRA',$at)",ct,("$id",Guid.NewGuid()),("$product",item.ProductId),("$q",item.Quantity),("$purchase",purchase.Id),("$at",purchase.CreatedAt.ToString("O")));}
            await tx.CommitAsync(ct);return purchase;
        }catch{await tx.RollbackAsync(ct);throw;}
    }
    private static async Task<int> Exec(SqliteConnection c,SqliteTransaction tx,string sql,CancellationToken ct,params(string,object)[] ps){await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=sql;foreach(var p in ps)q.Parameters.AddWithValue(p.Item1,p.Item2 is Guid id?id.ToString():p.Item2);return await q.ExecuteNonQueryAsync(ct);}
}
