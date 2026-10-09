using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed record StockMovement026(Guid Id, string Type, decimal Quantity, string Reason, DateTimeOffset CreatedAt);
public sealed class InventoryService026
{
    private readonly OncaDatabase _db;
    public InventoryService026(OncaDatabase db) => _db=db;

    public async Task<IReadOnlyList<Product>> SearchAsync(string term, CancellationToken ct=default)
    {
        var repo=new SqliteProductRepository(_db);
        if(!string.IsNullOrWhiteSpace(term)) return await repo.SearchAsync(term.Trim(),ct);
        var all=new List<Product>();
        foreach(var prefix in new[]{"","0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"})
            foreach(var p in await repo.SearchAsync(prefix,ct))
                if(!all.Any(x=>x.Id==p.Id)) all.Add(p);
        return all.OrderBy(x=>x.Name,StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    public Task SaveProductAsync(Product product, CancellationToken ct=default)
        => new SqliteProductRepository(_db).SaveAsync(product, ct);

    public async Task<decimal> MoveAsync(Guid productId, decimal quantity, string type, string reason, CancellationToken ct=default)
    {
        if (quantity == 0) throw new DomainException("INFORME UMA QUANTIDADE DIFERENTE DE ZERO.");
        reason=(reason??"").Trim();
        if (reason.Length < 2) throw new DomainException("INFORME O MOTIVO DO AJUSTE.");
        await using var c=_db.Open();
        await using var tx=await c.BeginTransactionAsync(ct);
        decimal before;
        await using(var q=c.CreateCommand()){
            q.Transaction=(SqliteTransaction)tx;
            q.CommandText="SELECT stock FROM products WHERE id=$id";
            q.Parameters.AddWithValue("$id",productId.ToString());
            var value=await q.ExecuteScalarAsync(ct);
            if(value is null) throw new DomainException("PRODUTO NÃO ENCONTRADO.");
            before=Convert.ToDecimal(value);
        }
        var after=before+quantity;
        await using(var q=c.CreateCommand()){
            q.Transaction=(SqliteTransaction)tx;
            q.CommandText="UPDATE products SET stock=$stock WHERE id=$id";
            q.Parameters.AddWithValue("$stock",after);
            q.Parameters.AddWithValue("$id",productId.ToString());
            if(await q.ExecuteNonQueryAsync(ct)!=1) throw new DomainException("NÃO FOI POSSÍVEL ATUALIZAR O ESTOQUE.");
        }
        await using(var q=c.CreateCommand()){
            q.Transaction=(SqliteTransaction)tx;
            q.CommandText="INSERT INTO stock_movements(id,product_id,type,quantity,origin_id,reason,created_at) VALUES($mid,$pid,$type,$qty,$origin,$reason,$at)";
            q.Parameters.AddWithValue("$mid",Guid.NewGuid().ToString());
            q.Parameters.AddWithValue("$pid",productId.ToString());
            q.Parameters.AddWithValue("$type",type);
            q.Parameters.AddWithValue("$qty",quantity);
            q.Parameters.AddWithValue("$origin",productId.ToString());
            q.Parameters.AddWithValue("$reason",reason);
            q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));
            await q.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
        return after;
    }

    public async Task<decimal> SetBalanceAsync(Guid productId, decimal newBalance, string reason, CancellationToken ct=default)
    {
        await using var c=_db.Open();
        await using var q=c.CreateCommand();
        q.CommandText="SELECT stock FROM products WHERE id=$id";
        q.Parameters.AddWithValue("$id",productId.ToString());
        var value=await q.ExecuteScalarAsync(ct);
        if(value is null) throw new DomainException("PRODUTO NÃO ENCONTRADO.");
        var before=Convert.ToDecimal(value);
        var diff=newBalance-before;
        if(diff==0) return before;
        return await MoveAsync(productId,diff,"Inventory","INVENTÁRIO / AJUSTE DE SALDO: "+reason,ct);
    }

    public async Task<IReadOnlyList<StockMovement026>> HistoryAsync(Guid productId,CancellationToken ct=default)
    {
        var list=new List<StockMovement026>();
        await using var c=_db.Open(); await using var q=c.CreateCommand();
        q.CommandText="SELECT id,type,quantity,reason,created_at FROM stock_movements WHERE product_id=$id ORDER BY created_at DESC LIMIT 100";
        q.Parameters.AddWithValue("$id",productId.ToString());
        await using var r=await q.ExecuteReaderAsync(ct);
        while(await r.ReadAsync(ct)) list.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.GetDecimal(2),r.GetString(3),DateTimeOffset.Parse(r.GetString(4))));
        return list;
    }
}
