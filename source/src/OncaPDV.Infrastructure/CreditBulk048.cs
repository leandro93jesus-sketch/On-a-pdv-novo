using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace OncaPDV.Infrastructure;

public sealed record CreditBulkResult048(Guid BatchId,IReadOnlyList<CreditDeletion046> Items)
{
    public int Count => Items.Count;
    public decimal Forgiven => Items.Sum(x => x.Forgiven);
    public decimal Paid => Items.Sum(x => x.Paid);
}

/// <summary>
/// Removes several selected credit accounts atomically. An invalid account, pending
/// receipt or cash mismatch cancels the ENTIRE batch; original sales and payments stay.
/// </summary>
public sealed class CreditBulk048(OncaDatabase db)
{
    private sealed record Row(Guid Account,Guid Customer,Guid Sale,decimal Balance,decimal Paid);
    private static void Add(SqliteCommand q,string name,object? value)
        => q.Parameters.AddWithValue(name,value is Guid id?id.ToString():value??DBNull.Value);

    public async Task<CreditBulkResult048> DeleteManyAsync(IEnumerable<Guid> accountIds,
        Guid operatorId,string reason,CancellationToken ct=default)
    {
        ArgumentNullException.ThrowIfNull(accountIds);
        var ids=accountIds.Distinct().ToArray();
        reason=(reason??"").Trim();
        if(ids.Length==0)throw new InvalidOperationException("Marque pelo menos uma conta.");
        if(ids.Length>500)throw new InvalidOperationException("Selecione até 500 contas por lote.");
        if(reason.Length<4)throw new InvalidOperationException("Informe o motivo da exclusão (mínimo 4 caracteres).");

        await using var c=db.Open();
        await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);
        var checkedRows=new List<Row>(ids.Length);
        // Validate every account under the same write transaction before changing any row.
        foreach(var id in ids)
        {
            Guid customer,sale;decimal balance;string accountStatus,saleStatus;
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText=@"SELECT a.customer_id,a.sale_id,a.balance,a.status,s.status
FROM credit_accounts a JOIN sales s ON s.id=a.sale_id WHERE a.id=$id";
                Add(q,"$id",id);
                await using var r=await q.ExecuteReaderAsync(ct);
                if(!await r.ReadAsync(ct))throw new InvalidOperationException($"Conta {id} não encontrada. Nenhuma conta foi excluída.");
                customer=Guid.Parse(r.GetString(0));sale=Guid.Parse(r.GetString(1));
                balance=r.GetDecimal(2);accountStatus=r.GetString(3);saleStatus=r.GetString(4);
            }
            if(accountStatus=="Cancelled"||saleStatus!="Completed")
                throw new InvalidOperationException("Há conta já excluída/cancelada ou venda não concluída no lote. Nenhuma conta foi excluída.");
            if(balance<0)throw new InvalidOperationException("Saldo inválido no lote. Nenhuma conta foi excluída.");
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText="SELECT COUNT(*) FROM credit_receipt_intents_046 WHERE account_id=$id AND acknowledged_at IS NULL";
                Add(q,"$id",id);
                if(Convert.ToInt32(await q.ExecuteScalarAsync(ct))!=0)
                    throw new InvalidOperationException("Há recebimento pendente de conferência em uma das contas. Nenhuma conta foi excluída.");
            }
            decimal paid,cash;
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText=@"SELECT COALESCE(SUM(r.amount),0) FROM credit_receipts r
LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id
WHERE r.account_id=$id AND x.id IS NULL";
                Add(q,"$id",id);paid=Convert.ToDecimal(await q.ExecuteScalarAsync(ct));
            }
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText="SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE origin_id=$id AND type='StoreCreditReceipt'";
                Add(q,"$id",id);cash=Convert.ToDecimal(await q.ExecuteScalarAsync(ct));
            }
            if(paid!=cash)
                throw new InvalidOperationException("Divergência entre caixa e recebimento em uma das contas. Nenhuma conta foi excluída; confira os lançamentos.");
            checkedRows.Add(new(id,customer,sale,balance,paid));
        }

        var batch=Guid.NewGuid();var now=DateTimeOffset.UtcNow.ToString("O");
        var auditReason=$"{reason} | LOTE 048: {batch}";
        foreach(var row in checkedRows)
        {
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText=@"INSERT INTO credit_account_deletions_046
(account_id,sale_id,removed_balance,net_paid,operator_id,reason,created_at)
VALUES($account,$sale,$balance,$paid,$op,$reason,$at)";
                Add(q,"$account",row.Account);Add(q,"$sale",row.Sale);Add(q,"$balance",row.Balance);
                Add(q,"$paid",row.Paid);Add(q,"$op",operatorId);Add(q,"$reason",auditReason);Add(q,"$at",now);
                await q.ExecuteNonQueryAsync(ct);
            }
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText=@"UPDATE credit_accounts SET balance=0,status='Cancelled',
notes=COALESCE(notes,'')||$note WHERE id=$account AND status<>'Cancelled'";
                Add(q,"$note",$" | EXCLUÍDO ADMINISTRATIVAMENTE: {auditReason}");Add(q,"$account",row.Account);
                if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException("Conta alterada durante exclusão. Todo o lote foi desfeito.");
            }
            if(row.Balance>0)
            {
                await using var q=c.CreateCommand();q.Transaction=tx;
                q.CommandText=@"INSERT INTO credit_entries
(id,customer_id,sale_id,type,amount,due_at,created_at,reason)
VALUES($id,$customer,$sale,'Credit',$amount,NULL,$at,'EXCLUSÃO ADMINISTRATIVA DE CREDIÁRIO')";
                Add(q,"$id",Guid.NewGuid());Add(q,"$customer",row.Customer);Add(q,"$sale",row.Sale);
                Add(q,"$amount",row.Balance);Add(q,"$at",now);await q.ExecuteNonQueryAsync(ct);
            }
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText=@"INSERT INTO sale_events(id,sale_id,event_type,operator_id,reason,details,created_at)
VALUES($id,$sale,'CreditAccountDeleted',$op,$reason,$details,$at)";
                Add(q,"$id",Guid.NewGuid());Add(q,"$sale",row.Sale);Add(q,"$op",operatorId);
                Add(q,"$reason",auditReason);
                Add(q,"$details",$"Lote {batch}; conta {row.Account}; saldo baixado {row.Balance}; pagamentos preservados {row.Paid}");
                Add(q,"$at",now);await q.ExecuteNonQueryAsync(ct);
            }
        }
        await tx.CommitAsync(ct);
        var verification=await new CreditRemovalVerification049(db).CheckAsync(ids,ct);
        if(!verification.Verified)
            throw new InvalidOperationException("Lote gravado, mas a conferência no banco não foi conclusiva. Não repita a operação: "+verification.Details);
        return new(batch,checkedRows.Select(row=>new CreditDeletion046(
            row.Account,row.Sale,row.Balance,row.Paid,operatorId,auditReason)).ToArray());
    }
}
