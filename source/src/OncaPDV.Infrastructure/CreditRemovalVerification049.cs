using Microsoft.Data.Sqlite;

namespace OncaPDV.Infrastructure;

public sealed record CreditRemovalProof049(int Requested,int Archived,int Active,int Invalid,string Details)
{
    public bool Verified => Requested>0 && Archived==Requested && Active==0 && Invalid==0;
}

public sealed class CreditRemovalVerification049(OncaDatabase db)
{
    public async Task<CreditRemovalProof049> CheckAsync(IEnumerable<Guid> accounts,CancellationToken ct=default)
    {
        var ids=accounts.Distinct().ToArray();
        if(ids.Length==0)return new(0,0,0,0,"Nenhuma conta selecionada.");
        await using var c=db.Open();
        var archived=0;var active=0;var invalid=0;
        foreach(var id in ids)
        {
            await using var q=c.CreateCommand();
            q.CommandText=@"SELECT a.status,a.balance,CASE WHEN d.account_id IS NULL THEN 0 ELSE 1 END
FROM credit_accounts a LEFT JOIN credit_account_deletions_046 d ON d.account_id=a.id WHERE a.id=$id";
            q.Parameters.AddWithValue("$id",id.ToString());
            await using var r=await q.ExecuteReaderAsync(ct);
            if(!await r.ReadAsync(ct)){invalid++;continue;}
            var status=r.GetString(0);var balance=r.GetDecimal(1);var tombstone=r.GetInt32(2)!=0;
            if(tombstone)archived++;
            if(status!="Cancelled" || !tombstone || balance!=0)invalid++;
            if(status!="Cancelled" && !tombstone)active++;
        }
        return new(ids.Length,archived,active,invalid,
            $"Selecionadas={ids.Length}; registradas na auditoria={archived}; ainda ativas={active}; inconsistentes={invalid}.");
    }
}
