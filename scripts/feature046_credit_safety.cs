using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed record CreditIntent046(Guid RequestId,Guid AccountId,decimal Amount,PaymentMethod Method,
    Guid OperatorId,Guid SessionId,string? Notes,Guid? ReceiptId);
public sealed record CreditCashAudit046(Guid ReceiptId,Guid CashMovementId,decimal Amount,Guid SessionId);
public sealed record CreditCashSummary046(decimal ActiveReceipts,decimal CashNet,int Receipts,int LinkedReceipts,bool Matches)
{
    public bool AllIndividuallyLinked=>Receipts==LinkedReceipts;
}
public sealed record CreditDeletion046(Guid AccountId,Guid SaleId,decimal Forgiven,decimal Paid,Guid OperatorId,string Reason);

/// <summary>
/// One durable pending payment per credit account. A successful receipt remains pending
/// until the user sees its exact linked cash movement. On restart, do not issue a fresh
/// payment while an earlier operation is unresolved.
/// </summary>
public sealed class CreditSafety046(OncaDatabase db)
{
    private static void Add(SqliteCommand q,string name,object? value)
        =>q.Parameters.AddWithValue(name,value is Guid id?id.ToString():value??DBNull.Value);

    public async Task<CreditIntent046?> PendingAsync(Guid account,CancellationToken ct=default)
    {
        await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText=@"SELECT i.request_id,i.account_id,i.amount,i.method,i.operator_id,i.session_id,i.notes,
k.receipt_id FROM credit_receipt_intents_046 i
LEFT JOIN credit_receipt_requests_045 k ON k.request_id=i.request_id
WHERE i.account_id=$account AND i.acknowledged_at IS NULL ORDER BY i.created_at LIMIT 1";
        Add(q,"$account",account);await using var r=await q.ExecuteReaderAsync(ct);
        if(!await r.ReadAsync(ct))return null;
        return new(Guid.Parse(r.GetString(0)),Guid.Parse(r.GetString(1)),r.GetDecimal(2),
            Enum.Parse<PaymentMethod>(r.GetString(3)),Guid.Parse(r.GetString(4)),Guid.Parse(r.GetString(5)),
            r.IsDBNull(6)?null:r.GetString(6),r.IsDBNull(7)?null:Guid.Parse(r.GetString(7)));
    }

    public async Task<CreditIntent046> PrepareAsync(Guid account,decimal amount,PaymentMethod method,
        Guid op,Guid session,string? notes,CancellationToken ct=default)
    {
        if(amount<=0 || method==PaymentMethod.StoreCredit)throw new InvalidOperationException("Pagamento inválido.");
        await using var c=db.Open();await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);
        await using(var check=c.CreateCommand())
        {
            check.Transaction=tx;
            check.CommandText="SELECT request_id FROM credit_receipt_intents_046 WHERE account_id=$account AND acknowledged_at IS NULL";
            Add(check,"$account",account);
            if(await check.ExecuteScalarAsync(ct) is not null)
                throw new InvalidOperationException("Há um recebimento anterior aguardando conferência. Verifique antes de lançar novamente.");
        }
        var id=Guid.NewGuid();
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"INSERT INTO credit_receipt_intents_046
(request_id,account_id,amount,method,operator_id,session_id,notes,created_at)
VALUES($id,$account,$amount,$method,$op,$session,$notes,$at)";
            Add(q,"$id",id);Add(q,"$account",account);Add(q,"$amount",amount);
            Add(q,"$method",method.ToString());Add(q,"$op",op);Add(q,"$session",session);
            Add(q,"$notes",notes);Add(q,"$at",DateTimeOffset.UtcNow.ToString("O"));
            if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException("Não foi possível guardar a operação.");
        }
        await tx.CommitAsync(ct);
        return new(id,account,amount,method,op,session,notes,null);
    }

    public async Task<CreditCashAudit046?> CheckAsync(CreditIntent046 intent,CancellationToken ct=default)
    {
        await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText=@"SELECT r.id,r.account_id,r.amount,r.method,k.session_id,l.cash_movement_id,
m.session_id,m.type,m.amount
FROM credit_receipt_requests_045 k
JOIN credit_receipts r ON r.id=k.receipt_id
LEFT JOIN credit_receipt_cash_links_045 l ON l.receipt_id=r.id
LEFT JOIN cash_movements m ON m.id=l.cash_movement_id
WHERE k.request_id=$id";
        Add(q,"$id",intent.RequestId);
        await using var r=await q.ExecuteReaderAsync(ct);
        if(!await r.ReadAsync(ct))return null; // intent exists but no receipt committed
        if(r.IsDBNull(5)||r.IsDBNull(6)||r.IsDBNull(7)||r.IsDBNull(8))
            throw new InvalidOperationException("Recebimento gravado sem vínculo completo com caixa. Não faça nova baixa; revise o histórico.");
        var receipt=Guid.Parse(r.GetString(0));
        var movement=Guid.Parse(r.GetString(5));
        var session=Guid.Parse(r.GetString(6));
        if(r.GetString(1)!=intent.AccountId.ToString() || r.GetDecimal(2)!=intent.Amount ||
            r.GetString(3)!=intent.Method.ToString() || r.GetString(4)!=intent.SessionId.ToString() ||
            session!=intent.SessionId || r.GetString(7)!="StoreCreditReceipt" || r.GetDecimal(8)!=intent.Amount)
            throw new InvalidOperationException("Divergência entre recebimento e caixa; operação bloqueada para revisão.");
        return new(receipt,movement,intent.Amount,session);
    }

    public async Task AcknowledgeAsync(CreditIntent046 intent,CancellationToken ct=default)
    {
        if(await CheckAsync(intent,ct) is null)
            throw new InvalidOperationException("Ainda não há recebimento no caixa para confirmar.");
        await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText="UPDATE credit_receipt_intents_046 SET acknowledged_at=$at WHERE request_id=$id AND acknowledged_at IS NULL";
        Add(q,"$at",DateTimeOffset.UtcNow.ToString("O"));Add(q,"$id",intent.RequestId);
        await q.ExecuteNonQueryAsync(ct);
    }

    public async Task AbandonUncommittedAsync(CreditIntent046 intent,CancellationToken ct=default)
    {
        // A commit from another terminal cannot race across a write transaction.
        await using var c=db.Open();await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);
        await using(var check=c.CreateCommand())
        {
            check.Transaction=tx;
            check.CommandText="SELECT COUNT(*) FROM credit_receipt_requests_045 WHERE request_id=$id";
            Add(check,"$id",intent.RequestId);
            if(Convert.ToInt32(await check.ExecuteScalarAsync(ct))!=0)
                throw new InvalidOperationException("O recebimento já foi lançado: confira o caixa em vez de descartá-lo.");
        }
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText="UPDATE credit_receipt_intents_046 SET acknowledged_at=$at WHERE request_id=$id AND acknowledged_at IS NULL";
            Add(q,"$at",DateTimeOffset.UtcNow.ToString("O"));Add(q,"$id",intent.RequestId);
            await q.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
    }

    public async Task<bool> SessionOpenAsync(Guid session,CancellationToken ct=default)
    {
        await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText="SELECT closed_at FROM cash_sessions WHERE id=$id";
        Add(q,"$id",session);var v=await q.ExecuteScalarAsync(ct);
        return v is DBNull;
    }

    public async Task<CreditCashSummary046> ReconcileAsync(Guid account,CancellationToken ct=default)
    {
        await using var c=db.Open();
        async Task<decimal> Value(string sql)
        {
            await using var q=c.CreateCommand();q.CommandText=sql;Add(q,"$account",account);
            return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));
        }
        var due=await Value(@"SELECT COALESCE(SUM(r.amount),0) FROM credit_receipts r
LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id
WHERE r.account_id=$account AND x.id IS NULL");
        var ledger=await Value(@"SELECT COALESCE(SUM(amount),0) FROM cash_movements
WHERE origin_id=$account AND type='StoreCreditReceipt'");
        var count=(int)await Value("SELECT COUNT(*) FROM credit_receipts WHERE account_id=$account");
        var linked=(int)await Value(@"SELECT COUNT(*) FROM credit_receipts r
JOIN credit_receipt_cash_links_045 l ON l.receipt_id=r.id
JOIN cash_movements m ON m.id=l.cash_movement_id
WHERE r.account_id=$account AND m.type='StoreCreditReceipt'
AND m.origin_id=$account AND m.amount=r.amount");
        return new(due,ledger,count,linked,due==ledger);
    }

    public async Task<CreditDeletion046> DeleteCreditAsync(Guid account,Guid operatorId,string reason,CancellationToken ct=default)
    {
        reason=(reason??"").Trim();
        if(reason.Length<4)throw new InvalidOperationException("Informe o motivo obrigatório da exclusão.");
        await using var c=db.Open();await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);
        Guid customer,sale;decimal balance,original;string status,saleStatus;
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"SELECT a.customer_id,a.sale_id,a.original_amount,a.balance,a.status,s.status
FROM credit_accounts a JOIN sales s ON s.id=a.sale_id WHERE a.id=$id";
            Add(q,"$id",account);
            await using var r=await q.ExecuteReaderAsync(ct);
            if(!await r.ReadAsync(ct))throw new InvalidOperationException("Crediário não encontrado.");
            customer=Guid.Parse(r.GetString(0));sale=Guid.Parse(r.GetString(1));
            original=r.GetDecimal(2);balance=r.GetDecimal(3);status=r.GetString(4);saleStatus=r.GetString(5);
        }
        if(status=="Cancelled"||saleStatus!="Completed")
            throw new InvalidOperationException("Conta já excluída/cancelada ou venda não concluída.");
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText="SELECT COUNT(*) FROM credit_receipt_intents_046 WHERE account_id=$id AND acknowledged_at IS NULL";
            Add(q,"$id",account);
            if(Convert.ToInt32(await q.ExecuteScalarAsync(ct))>0)
                throw new InvalidOperationException("Existe recebimento pendente de conferência. Resolva-o antes de excluir o crediário.");
        }
        decimal paid,cash;
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"SELECT COALESCE(SUM(r.amount),0) FROM credit_receipts r
LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id WHERE r.account_id=$id AND x.id IS NULL";
            Add(q,"$id",account);paid=Convert.ToDecimal(await q.ExecuteScalarAsync(ct));
        }
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;q.CommandText="SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE origin_id=$id AND type='StoreCreditReceipt'";
            Add(q,"$id",account);cash=Convert.ToDecimal(await q.ExecuteScalarAsync(ct));
        }
        if(paid!=cash)
            throw new InvalidOperationException("O caixa e os recebimentos divergem. A exclusão foi bloqueada para conferência, sem modificar dados.");
        var now=DateTimeOffset.UtcNow.ToString("O");
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"INSERT INTO credit_account_deletions_046
(account_id,sale_id,removed_balance,net_paid,operator_id,reason,created_at)
VALUES($account,$sale,$balance,$paid,$op,$reason,$at)";
            Add(q,"$account",account);Add(q,"$sale",sale);Add(q,"$balance",balance);
            Add(q,"$paid",paid);Add(q,"$op",operatorId);Add(q,"$reason",reason);Add(q,"$at",now);
            await q.ExecuteNonQueryAsync(ct);
        }
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"UPDATE credit_accounts SET balance=0,status='Cancelled',
notes=COALESCE(notes,'')||$note WHERE id=$account AND status<>'Cancelled'";
            Add(q,"$note",$" | EXCLUÍDO ADMINISTRATIVAMENTE: {reason}");Add(q,"$account",account);
            if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException("A conta foi alterada por outro terminal.");
        }
        if(balance>0)
        {
            await using var q=c.CreateCommand();q.Transaction=tx;
            q.CommandText=@"INSERT INTO credit_entries
(id,customer_id,sale_id,type,amount,due_at,created_at,reason)
VALUES($id,$customer,$sale,'Credit',$amount,NULL,$at,'EXCLUSÃO ADMINISTRATIVA DE CREDIÁRIO')";
            Add(q,"$id",Guid.NewGuid());Add(q,"$customer",customer);Add(q,"$sale",sale);
            Add(q,"$amount",balance);Add(q,"$at",now);await q.ExecuteNonQueryAsync(ct);
        }
        await using(var q=c.CreateCommand())
        {
            q.Transaction=tx;
            q.CommandText=@"INSERT INTO sale_events(id,sale_id,event_type,operator_id,reason,details,created_at)
VALUES($id,$sale,'CreditAccountDeleted',$op,$reason,$details,$at)";
            Add(q,"$id",Guid.NewGuid());Add(q,"$sale",sale);Add(q,"$op",operatorId);
            Add(q,"$reason",reason);Add(q,"$details",$"Conta {account}; saldo baixado {balance}; recebimentos preservados {paid}");
            Add(q,"$at",now);await q.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
        return new(account,sale,balance,paid,operatorId,reason);
    }
}
