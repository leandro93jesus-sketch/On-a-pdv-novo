using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace OncaPDV.Infrastructure;

public sealed record CreditArchiveItem050(Guid Id, Guid CustomerId, Guid SaleId, long SaleNumber,
    string Customer, decimal Original, decimal Balance, decimal Paid, decimal Cash,
    string Status, string SaleStatus, bool AlreadyArchived, int PendingUnposted,
    int PendingPosted, int UnlinkedReceipts, string? Blocker, IReadOnlyList<string> Alerts)
{
    public bool NeedsExplicitConsent => Alerts.Count > 0;
    public bool CanArchive => Blocker is null;
    public string Label => $"Venda {SaleNumber:000000} — {Customer}";
}

public sealed record CreditArchivePreview050(IReadOnlyList<CreditArchiveItem050> Items)
{
    public int Total => Items.Count;
    public int NewCount => Items.Count(x=>!x.AlreadyArchived);
    public int WarningCount => Items.Count(x=>x.NeedsExplicitConsent);
    public int BlockedCount => Items.Count(x=>!x.CanArchive);
    public decimal Balance => Items.Where(x=>!x.AlreadyArchived).Sum(x=>Math.Max(0m,x.Balance));
    public decimal Paid => Items.Sum(x=>x.Paid);
    public string Details => string.Join("\n",Items.Where(x=>x.Blocker is not null || x.NeedsExplicitConsent)
        .Select(x=>$"{x.Label}: {x.Blocker ?? string.Join("; ",x.Alerts)}"));
}

public sealed record CreditArchiveResult050(Guid BatchId,int Archived,int AlreadyArchived,
    decimal WrittenOff,decimal Paid,int WithAlerts,IReadOnlyList<Guid> AccountIds);

/// <summary>
/// Administrative archival of legacy and current credit accounts. This does not delete
/// sales, receipts or cash movements. An old discrepancy is allowed ONLY with explicit
/// administrator consent and is stored for later reconciliation, never silently repaired.
/// </summary>
public sealed class CreditArchive050(OncaDatabase db)
{
    private static void Add(SqliteCommand q,string name,object? value) =>
        q.Parameters.AddWithValue(name,value is Guid g?g.ToString():value??DBNull.Value);

    private static async Task<decimal> Amount(SqliteConnection c,SqliteTransaction? tx,
        string sql,Guid account,CancellationToken ct)
    {
        await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=sql;Add(q,"$id",account);
        return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));
    }

    private static async Task<CreditArchiveItem050> InspectOne(SqliteConnection c,
        SqliteTransaction? tx,Guid id,CancellationToken ct)
    {
        Guid customerId,saleId;string customer,status,saleStatus;long saleNumber;
        decimal original,balance;bool archived;
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"SELECT a.customer_id,a.sale_id,c.name,s.number,a.original_amount,
 a.balance,a.status,s.status,d.account_id
FROM credit_accounts a LEFT JOIN customers c ON c.id=a.customer_id
LEFT JOIN sales s ON s.id=a.sale_id
LEFT JOIN credit_account_deletions_046 d ON d.account_id=a.id WHERE a.id=$id";
            Add(q,"$id",id);
            await using var r=await q.ExecuteReaderAsync(ct);
            if(!await r.ReadAsync(ct))
                throw new InvalidOperationException($"Conta {id} não localizada no banco. Nenhuma exclusão foi realizada.");
            customerId=Guid.Parse(r.GetString(0));saleId=Guid.Parse(r.GetString(1));
            customer=r.IsDBNull(2)?"CLIENTE NÃO ENCONTRADO":r.GetString(2);
            saleNumber=r.IsDBNull(3)?0:r.GetInt64(3);
            original=r.GetDecimal(4);balance=r.GetDecimal(5);status=r.GetString(6);
            saleStatus=r.IsDBNull(7)?"VENDA NÃO ENCONTRADA":r.GetString(7);
            archived=!r.IsDBNull(8);
        }
        var alerts=new List<string>();string? blocker=null;
        if(customer=="CLIENTE NÃO ENCONTRADO" || saleNumber==0 || saleStatus=="VENDA NÃO ENCONTRADA")
            blocker="Venda ou cliente ausente. Necessária correção do vínculo antes da exclusão, sem apagar lançamentos.";
        var paid=await Amount(c,tx,@"SELECT COALESCE(SUM(r.amount),0) FROM credit_receipts r
LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id
WHERE r.account_id=$id AND x.id IS NULL",id,ct);
        var cash=await Amount(c,tx,@"SELECT COALESCE(SUM(m.amount),0) FROM cash_movements m
WHERE m.origin_id=$id AND m.type='StoreCreditReceipt'",id,ct);
        var unlinked=(int)await Amount(c,tx,@"SELECT COUNT(*) FROM credit_receipts r
LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id
LEFT JOIN credit_receipt_cash_links_045 l ON l.receipt_id=r.id
LEFT JOIN cash_movements m ON m.id=l.cash_movement_id
WHERE r.account_id=$id AND x.id IS NULL
AND (m.id IS NULL OR m.origin_id<>r.account_id OR m.type<>'StoreCreditReceipt' OR m.amount<>r.amount)",id,ct);
        int pendingUnposted=0,pendingPosted=0;
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"SELECT i.account_id,i.amount,i.method,i.session_id,
 k.receipt_id,r.account_id,r.amount,r.method,k.session_id,
 m.id,m.session_id,m.type,m.amount,m.origin_id
FROM credit_receipt_intents_046 i
LEFT JOIN credit_receipt_requests_045 k ON k.request_id=i.request_id
LEFT JOIN credit_receipts r ON r.id=k.receipt_id
LEFT JOIN credit_receipt_cash_links_045 l ON l.receipt_id=r.id
LEFT JOIN cash_movements m ON m.id=l.cash_movement_id
WHERE i.account_id=$id AND i.acknowledged_at IS NULL";
            Add(q,"$id",id);
            await using var r=await q.ExecuteReaderAsync(ct);
            while(await r.ReadAsync(ct))
            {
                if(r.IsDBNull(4)){pendingUnposted++;continue;}
                pendingPosted++;
                if(r.IsDBNull(5)||r.IsDBNull(6)||r.IsDBNull(7)||r.IsDBNull(8)||
                    r.IsDBNull(9)||r.IsDBNull(10)||r.IsDBNull(11)||r.IsDBNull(12)||r.IsDBNull(13)||
                    r.GetString(0)!=id.ToString()||r.GetString(5)!=id.ToString()||
                    r.GetDecimal(1)!=r.GetDecimal(6)||r.GetString(2)!=r.GetString(7)||
                    r.GetString(3)!=r.GetString(8)||r.GetString(3)!=r.GetString(10)||
                    r.GetString(11)!="StoreCreditReceipt"||r.GetDecimal(1)!=r.GetDecimal(12)||
                    r.GetString(13)!=id.ToString())
                    blocker="Há baixa pendente com recibo/caixa sem vínculo consistente. Não é seguro encerrá-la automaticamente; confira esse lançamento.";
            }
        }
        if(paid!=cash)alerts.Add($"recibos {paid:C}, caixa {cash:C} (diferença {cash-paid:C}); valores não serão alterados");
        if(unlinked>0)alerts.Add($"{unlinked} recibo(s) sem vínculo individual íntegro com o caixa");
        if(pendingUnposted>0)alerts.Add($"{pendingUnposted} operação(ões) preparada(s), mas sem recibo; serão encerradas sem lançamento financeiro");
        if(pendingPosted>0)alerts.Add($"{pendingPosted} recibo(s) gravado(s) aguardando confirmação, já vinculado(s) ao caixa");
        if(saleStatus!="Completed")alerts.Add($"venda em situação {saleStatus}; não será lançado novo estorno");
        if(status=="Cancelled")alerts.Add("conta já cancelada no legado; será apenas retirada da lista e auditada");
        if(status=="Paid"&&balance!=0)alerts.Add("conta marcada paga com saldo diferente de zero; sem novo estorno financeiro");
        if(balance<0 || balance>original)alerts.Add($"saldo legado inconsistente ({balance:C} de {original:C}); sem lançamento financeiro automático");
        return new(id,customerId,saleId,saleNumber,customer,original,balance,paid,cash,
            status,saleStatus,archived,pendingUnposted,pendingPosted,unlinked,blocker,alerts);
    }

    public async Task<CreditArchivePreview050> InspectAsync(IEnumerable<Guid> accountIds,CancellationToken ct=default)
    {
        ArgumentNullException.ThrowIfNull(accountIds);
        var ids=accountIds.Distinct().ToArray();
        if(ids.Length==0||ids.Length>500)throw new InvalidOperationException("Selecione entre 1 e 500 contas.");
        await using var c=db.Open();var rows=new List<CreditArchiveItem050>(ids.Length);
        foreach(var id in ids)rows.Add(await InspectOne(c,null,id,ct));
        return new(rows);
    }

    public async Task<CreditArchiveResult050> ArchiveAsync(IEnumerable<Guid> accountIds,
        Guid operatorId,string reason,bool consentToDifferences=false,CancellationToken ct=default)
    {
        ArgumentNullException.ThrowIfNull(accountIds);
        var ids=accountIds.Distinct().ToArray();reason=(reason??"").Trim();
        if(ids.Length==0||ids.Length>500)throw new InvalidOperationException("Selecione entre 1 e 500 contas.");
        if(reason.Length<4)throw new InvalidOperationException("Informe o motivo obrigatório (mínimo de 4 caracteres).");
        await using var c=db.Open();
        await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);
        var rows=new List<CreditArchiveItem050>(ids.Length);
        foreach(var id in ids)rows.Add(await InspectOne(c,tx,id,ct));
        var preview=new CreditArchivePreview050(rows);
        if(preview.BlockedCount!=0)
            throw new InvalidOperationException("Exclusão interrompida para preservar dados:\n"+preview.Details);
        if(rows.Any(x=>!x.AlreadyArchived&&x.NeedsExplicitConsent) && !consentToDifferences)
            throw new InvalidOperationException("Há contas antigas que exigem confirmação específica. Nenhum dado alterado:\n"+preview.Details);
        var batch=Guid.NewGuid();var now=DateTimeOffset.UtcNow.ToString("O");
        var archived=0;var old=0;var forgiven=0m;var warning=0;
        foreach(var item in rows)
        {
            if(item.AlreadyArchived){old++;continue;}
            // A receipt cannot be committed concurrently with this same SQLite write transaction.
            // InspectOne rejected a posted intent lacking a consistent receipt/cash link.
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText=@"UPDATE credit_receipt_intents_046
SET acknowledged_at=$at,notes=COALESCE(notes,'') || $message
WHERE account_id=$id AND acknowledged_at IS NULL";
                Add(q,"$id",item.Id);Add(q,"$at",now);
                Add(q,"$message"," | ENCERRADO NA EXCLUSÃO ADMINISTRATIVA 0.1.50; conferência original preservada");
                await q.ExecuteNonQueryAsync(ct);
            }
            var allowedWriteoff=item.SaleStatus=="Completed" &&
                (item.Status is "Open" or "Partial" or "Overdue") &&
                item.Balance>0 && item.Balance<=item.Original;
            var writeoff=allowedWriteoff?item.Balance:0m;
            var note=item.Alerts.Count==0?"": " | PENDÊNCIAS: "+string.Join("; ",item.Alerts);
            var auditReason=$"{reason} | LOTE 050: {batch}"+note;
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText=@"INSERT INTO credit_account_deletions_046
(account_id,sale_id,removed_balance,net_paid,operator_id,reason,created_at)
VALUES($id,$sale,$forgiven,$paid,$op,$reason,$at)";
                Add(q,"$id",item.Id);Add(q,"$sale",item.SaleId);Add(q,"$forgiven",writeoff);
                Add(q,"$paid",item.Paid);Add(q,"$op",operatorId);Add(q,"$reason",auditReason);Add(q,"$at",now);
                await q.ExecuteNonQueryAsync(ct);
            }
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText=@"UPDATE credit_accounts SET status='Cancelled',balance=0,
notes=COALESCE(notes,'') || $note
WHERE id=$id";
                Add(q,"$id",item.Id);Add(q,"$op",operatorId);
                Add(q,"$note"," | ARQUIVADO ADMINISTRATIVAMENTE 0.1.50: "+reason);
                if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException($"{item.Label}: conta alterada por outro terminal. O lote foi desfeito.");
            }
            if(writeoff>0)
            {
                await using var q=c.CreateCommand();q.Transaction=tx;
                q.CommandText=@"INSERT INTO credit_entries
(id,customer_id,sale_id,type,amount,due_at,created_at,reason)
VALUES($id,$customer,$sale,'Credit',$amount,NULL,$at,'EXCLUSÃO ADMINISTRATIVA DE CREDIÁRIO')";
                Add(q,"$id",Guid.NewGuid());Add(q,"$customer",item.CustomerId);Add(q,"$sale",item.SaleId);
                Add(q,"$amount",writeoff);Add(q,"$at",now);await q.ExecuteNonQueryAsync(ct);
            }
            if(item.Alerts.Count>0)
            {
                warning++;
                await using var q=c.CreateCommand();q.Transaction=tx;
                q.CommandText=@"INSERT INTO credit_archive_exceptions_050
(account_id,receipt_total,cash_total,unlinked_receipts,previous_status,sale_status,
 previous_balance,details,operator_id,created_at)
VALUES($id,$paid,$cash,$unlinked,$status,$sale,$balance,$details,$op,$at)";
                Add(q,"$id",item.Id);Add(q,"$paid",item.Paid);Add(q,"$cash",item.Cash);
                Add(q,"$unlinked",item.UnlinkedReceipts);Add(q,"$status",item.Status);
                Add(q,"$sale",item.SaleStatus);Add(q,"$balance",item.Balance);
                Add(q,"$details",string.Join("; ",item.Alerts));Add(q,"$op",operatorId);Add(q,"$at",now);
                await q.ExecuteNonQueryAsync(ct);
            }
            await using(var q=c.CreateCommand())
            {
                q.Transaction=tx;
                q.CommandText=@"INSERT INTO sale_events(id,sale_id,event_type,operator_id,reason,details,created_at)
VALUES($id,$sale,'CreditAccountDeleted',$op,$reason,$details,$at)";
                Add(q,"$id",Guid.NewGuid());Add(q,"$sale",item.SaleId);Add(q,"$op",operatorId);
                Add(q,"$reason",auditReason);
                Add(q,"$details",$"Conta {item.Id}; saldo anterior {item.Balance:C}; baixa contábil {writeoff:C}; " +
                    $"recibos preservados {item.Paid:C}; caixa preservado {item.Cash:C}; alertas: {note}");
                Add(q,"$at",now);await q.ExecuteNonQueryAsync(ct);
            }
            forgiven+=writeoff;archived++;
        }
        await tx.CommitAsync(ct);
        var proof=await new CreditRemovalVerification049(db).CheckAsync(ids,ct);
        if(!proof.Verified)throw new InvalidOperationException("Operação registrada, mas conferência do banco inconclusiva. Não execute novamente: "+proof.Details);
        return new(batch,archived,old,forgiven,rows.Sum(x=>x.Paid),warning,ids);
    }
}
