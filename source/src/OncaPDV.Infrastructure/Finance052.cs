using Microsoft.Data.Sqlite;

namespace OncaPDV.Infrastructure;

public sealed record PayableView052(Guid Id,string Supplier,string Description,string Category,string? DocumentNumber,
    int InstallmentNumber,int InstallmentCount,decimal Amount,decimal Paid,decimal Remaining,DateTimeOffset DueAt,
    string Status,string? Notes,DateTimeOffset CreatedAt);
public sealed record ExpenseView052(Guid Id,string Source,string Category,string Description,string? Supplier,string? DocumentNumber,
    decimal Amount,string Method,DateTimeOffset OccurredAt,string? Notes);
public sealed record FinanceSummary052(decimal OpenPayables,decimal OverduePayables,decimal PaidThisMonth,decimal ExpensesThisMonth,
    decimal CashExpensesThisMonth,int OpenCount,int OverdueCount);
public sealed record ExpenseResult052(Guid Id,decimal Amount,string Method,Guid? SessionId,Guid? PayableId);

/// <summary>Accounts payable and categorized expense control introduced in 0.1.52.</summary>
public sealed class Finance052(OncaDatabase db)
{
    private static void Add(SqliteCommand q,string name,object? value)=>q.Parameters.AddWithValue(name,value is Guid g?g.ToString():value??DBNull.Value);
    private static string Clean(string? value,string label,int min=2)
    {var x=(value??"").Trim();if(x.Length<min)throw new InvalidOperationException($"Informe {label}.");return x;}

    public async Task<IReadOnlyList<PayableView052>> CreateInstallmentsAsync(string supplier,string description,string category,
        decimal total,DateTimeOffset firstDue,int installments,string? document,string? notes,Guid operatorId,CancellationToken ct=default)
    {
        supplier=Clean(supplier,"o fornecedor");description=Clean(description,"a descrição");category=Clean(category,"a categoria");
        if(total<=0)throw new InvalidOperationException("O valor total deve ser maior que zero.");if(installments<1||installments>60)throw new InvalidOperationException("Use entre 1 e 60 parcelas.");
        var due=new DateTimeOffset(firstDue.Year,firstDue.Month,firstDue.Day,0,0,0,firstDue.Offset);var now=DateTimeOffset.Now;var ids=new List<Guid>();
        await using var c=db.Open();await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);decimal allocated=0;
        for(var i=1;i<=installments;i++)
        {
            var amount=i==installments?total-allocated:decimal.Round(total/installments,2,MidpointRounding.AwayFromZero);allocated+=amount;var id=Guid.NewGuid();ids.Add(id);
            await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=@"INSERT INTO payable_accounts_052
(id,supplier,description,category,document_number,installment_number,installment_count,amount,due_at,status,notes,operator_id,created_at,updated_at)
VALUES($id,$supplier,$description,$category,$document,$n,$count,$amount,$due,'Pending',$notes,$op,$now,$now)";
            Add(q,"$id",id);Add(q,"$supplier",supplier);Add(q,"$description",description);Add(q,"$category",category);Add(q,"$document",string.IsNullOrWhiteSpace(document)?null:document.Trim());
            Add(q,"$n",i);Add(q,"$count",installments);Add(q,"$amount",amount);Add(q,"$due",due.AddMonths(i-1).ToString("O"));Add(q,"$notes",string.IsNullOrWhiteSpace(notes)?null:notes.Trim());Add(q,"$op",operatorId);Add(q,"$now",now.ToString("O"));await q.ExecuteNonQueryAsync(ct);
            await Audit(c,tx,operatorId,"PayableCreated","payable_accounts_052",id,$"Parcela {i}/{installments}; {supplier}; {amount:C}; vence {due.AddMonths(i-1):dd/MM/yyyy}",ct);
        }
        await tx.CommitAsync(ct);var all=await PayablesAsync("Todos",ct);return all.Where(x=>ids.Contains(x.Id)).OrderBy(x=>x.InstallmentNumber).ToArray();
    }

    public async Task<IReadOnlyList<PayableView052>> PayablesAsync(string filter="Todos",CancellationToken ct=default)
    {
        var list=new List<PayableView052>();await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText=@"
SELECT p.id,p.supplier,p.description,p.category,p.document_number,p.installment_number,p.installment_count,p.amount,p.due_at,p.status,p.notes,p.created_at,
COALESCE((SELECT SUM(e.amount) FROM expense_entries_052 e WHERE e.payable_id=p.id),0) paid
FROM payable_accounts_052 p ORDER BY CASE WHEN p.status='Paid' THEN 2 WHEN p.status='Cancelled' THEN 3 ELSE 0 END,p.due_at,p.created_at";
        await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))
        {
            var amount=r.GetDecimal(7);var due=DateTimeOffset.Parse(r.GetString(8));var raw=r.GetString(9);var paid=r.GetDecimal(12);var remaining=Math.Max(0,amount-paid);
            var status=raw=="Cancelled"?"Cancelado":remaining<=0?"Pago":paid>0?(due.Date<DateTimeOffset.Now.Date?"Parcial vencido":"Parcial"):(due.Date<DateTimeOffset.Now.Date?"Vencido":"Pendente");
            if(!MatchFilter(status,filter))continue;
            list.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.GetString(2),r.GetString(3),r.IsDBNull(4)?null:r.GetString(4),r.GetInt32(5),r.GetInt32(6),amount,paid,remaining,due,status,r.IsDBNull(10)?null:r.GetString(10),DateTimeOffset.Parse(r.GetString(11))));
        }
        return list;
    }

    public async Task<ExpenseResult052> PayAsync(Guid payableId,decimal amount,string method,string? notes,Guid operatorId,Guid requestId,CancellationToken ct=default)
    {
        if(amount<=0)throw new InvalidOperationException("Informe um valor de pagamento maior que zero.");method=Clean(method,"a forma de pagamento");
        await using var c=db.Open();await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);
        var existing=await ExistingRequest(c,tx,requestId,ct);if(existing is not null){await tx.CommitAsync(ct);return existing;}
        string supplier,description,category;string? document;decimal total,paid;string status;
        await using(var q=c.CreateCommand())
        {q.Transaction=tx;q.CommandText=@"SELECT supplier,description,category,document_number,amount,status,
COALESCE((SELECT SUM(e.amount) FROM expense_entries_052 e WHERE e.payable_id=p.id),0) FROM payable_accounts_052 p WHERE id=$id";Add(q,"$id",payableId);await using var r=await q.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new InvalidOperationException("Conta a pagar não encontrada.");supplier=r.GetString(0);description=r.GetString(1);category=r.GetString(2);document=r.IsDBNull(3)?null:r.GetString(3);total=r.GetDecimal(4);status=r.GetString(5);paid=r.GetDecimal(6);}
        if(status=="Cancelled")throw new InvalidOperationException("Esta conta foi cancelada.");var remaining=total-paid;if(remaining<=0)throw new InvalidOperationException("Esta conta já está paga.");if(amount>remaining)throw new InvalidOperationException($"O valor informado supera o saldo de {remaining:C}.");
        var result=await InsertExpense(c,tx,requestId,payableId,category,description,supplier,document,amount,method,DateTimeOffset.Now,notes,operatorId,ct);
        var newPaid=paid+amount;if(newPaid>=total){await using var u=c.CreateCommand();u.Transaction=tx;u.CommandText="UPDATE payable_accounts_052 SET status='Paid',paid_at=$at,updated_at=$at WHERE id=$id";Add(u,"$at",DateTimeOffset.Now.ToString("O"));Add(u,"$id",payableId);await u.ExecuteNonQueryAsync(ct);}else{await using var u=c.CreateCommand();u.Transaction=tx;u.CommandText="UPDATE payable_accounts_052 SET updated_at=$at WHERE id=$id";Add(u,"$at",DateTimeOffset.Now.ToString("O"));Add(u,"$id",payableId);await u.ExecuteNonQueryAsync(ct);}
        await Audit(c,tx,operatorId,"PayablePayment","payable_accounts_052",payableId,$"Pagamento {amount:C} via {method}; saldo anterior {remaining:C}",ct);await tx.CommitAsync(ct);return result;
    }

    public async Task<ExpenseResult052> AddExpenseAsync(string category,string description,decimal amount,string method,DateTimeOffset occurredAt,
        string? supplier,string? document,string? notes,Guid operatorId,Guid requestId,CancellationToken ct=default)
    {
        category=Clean(category,"a categoria");description=Clean(description,"a descrição");method=Clean(method,"a forma de pagamento");if(amount<=0)throw new InvalidOperationException("O valor da despesa deve ser maior que zero.");
        await using var c=db.Open();await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);var existing=await ExistingRequest(c,tx,requestId,ct);if(existing is not null){await tx.CommitAsync(ct);return existing;}
        var result=await InsertExpense(c,tx,requestId,null,category,description,string.IsNullOrWhiteSpace(supplier)?null:supplier.Trim(),string.IsNullOrWhiteSpace(document)?null:document.Trim(),amount,method,occurredAt,notes,operatorId,ct);
        await Audit(c,tx,operatorId,"ExpenseCreated","expense_entries_052",result.Id,$"{category}; {description}; {amount:C}; {method}",ct);await tx.CommitAsync(ct);return result;
    }

    public async Task CancelPayableAsync(Guid id,Guid operatorId,string reason,CancellationToken ct=default)
    {
        reason=Clean(reason,"o motivo do cancelamento",4);await using var c=db.Open();await using var tx=(SqliteTransaction)await c.BeginTransactionAsync(ct);decimal paid;string status;
        await using(var q=c.CreateCommand()){q.Transaction=tx;q.CommandText=@"SELECT status,COALESCE((SELECT SUM(e.amount) FROM expense_entries_052 e WHERE e.payable_id=p.id),0) FROM payable_accounts_052 p WHERE id=$id";Add(q,"$id",id);await using var r=await q.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))throw new InvalidOperationException("Conta não encontrada.");status=r.GetString(0);paid=r.GetDecimal(1);}
        if(status=="Cancelled")return;if(paid>0)throw new InvalidOperationException("Conta com pagamento não pode ser cancelada. Preserve o histórico financeiro e faça a correção administrativa adequada.");
        await using(var q=c.CreateCommand()){q.Transaction=tx;q.CommandText="UPDATE payable_accounts_052 SET status='Cancelled',notes=COALESCE(notes,'')||$note,updated_at=$at WHERE id=$id";Add(q,"$note",$" | CANCELADA: {reason}");Add(q,"$at",DateTimeOffset.Now.ToString("O"));Add(q,"$id",id);await q.ExecuteNonQueryAsync(ct);}await Audit(c,tx,operatorId,"PayableCancelled","payable_accounts_052",id,reason,ct);await tx.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<ExpenseView052>> ExpensesAsync(DateTimeOffset from,DateTimeOffset to,CancellationToken ct=default)
    {
        var list=new List<ExpenseView052>();await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText=@"
SELECT id,'Atual',category,description,supplier,document_number,amount,method,occurred_at,notes FROM expense_entries_052 WHERE occurred_at >= $from AND occurred_at < $to
UNION ALL
SELECT id,'Legado','LEGADO',description,NULL,NULL,amount,'Dinheiro/Caixa',created_at,NULL FROM store_expenses WHERE created_at >= $from AND created_at < $to
ORDER BY occurred_at DESC";Add(q,"$from",from.ToString("O"));Add(q,"$to",to.ToString("O"));await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.GetString(2),r.GetString(3),r.IsDBNull(4)?null:r.GetString(4),r.IsDBNull(5)?null:r.GetString(5),r.GetDecimal(6),r.GetString(7),DateTimeOffset.Parse(r.GetString(8)),r.IsDBNull(9)?null:r.GetString(9)));return list;
    }

    public async Task<FinanceSummary052> SummaryAsync(CancellationToken ct=default)
    {
        var now=DateTimeOffset.Now;var month=new DateTimeOffset(now.Year,now.Month,1,0,0,0,now.Offset);var next=month.AddMonths(1);var all=await PayablesAsync("Todos",ct);var active=all.Where(x=>x.Status is not "Pago" and not "Cancelado").ToArray();var overdue=active.Where(x=>x.DueAt.Date<now.Date).ToArray();await using var c=db.Open();
        async Task<decimal> Sum(string sql){await using var q=c.CreateCommand();q.CommandText=sql;Add(q,"$from",month.ToString("O"));Add(q,"$to",next.ToString("O"));return Convert.ToDecimal(await q.ExecuteScalarAsync(ct));}
        var exp=await Sum("SELECT COALESCE((SELECT SUM(amount) FROM expense_entries_052 WHERE occurred_at >= $from AND occurred_at < $to),0)+COALESCE((SELECT SUM(amount) FROM store_expenses WHERE created_at >= $from AND created_at < $to),0)");
        var cash=await Sum("SELECT COALESCE(SUM(amount),0) FROM expense_entries_052 WHERE occurred_at >= $from AND occurred_at < $to AND method='Dinheiro'");
        var paid=await Sum("SELECT COALESCE(SUM(amount),0) FROM expense_entries_052 WHERE payable_id IS NOT NULL AND occurred_at >= $from AND occurred_at < $to");
        return new(active.Sum(x=>x.Remaining),overdue.Sum(x=>x.Remaining),paid,exp,cash,active.Length,overdue.Length);
    }

    private static bool MatchFilter(string status,string filter)=>filter switch{"Pendentes"=>status is "Pendente" or "Parcial","Vencidos"=>status.Contains("Vencido",StringComparison.OrdinalIgnoreCase),"Pagos"=>status=="Pago","Cancelados"=>status=="Cancelado",_=>true};
    private static async Task<ExpenseResult052?> ExistingRequest(SqliteConnection c,SqliteTransaction tx,Guid request,CancellationToken ct)
    {await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT id,amount,method,session_id,payable_id FROM expense_entries_052 WHERE request_id=$r";Add(q,"$r",request);await using var r=await q.ExecuteReaderAsync(ct);if(!await r.ReadAsync(ct))return null;return new(Guid.Parse(r.GetString(0)),r.GetDecimal(1),r.GetString(2),r.IsDBNull(3)?null:Guid.Parse(r.GetString(3)),r.IsDBNull(4)?null:Guid.Parse(r.GetString(4)));}

    private static async Task<ExpenseResult052> InsertExpense(SqliteConnection c,SqliteTransaction tx,Guid request,Guid? payable,string category,string description,string? supplier,string? document,decimal amount,string method,DateTimeOffset occurred,string? notes,Guid operatorId,CancellationToken ct)
    {
        Guid? session=null;if(method.Equals("Dinheiro",StringComparison.OrdinalIgnoreCase))
        {await using var s=c.CreateCommand();s.Transaction=tx;s.CommandText="SELECT id FROM cash_sessions WHERE operator_id=$op AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1";Add(s,"$op",operatorId);var v=await s.ExecuteScalarAsync(ct);if(v is null)throw new InvalidOperationException("Abra o caixa antes de registrar uma despesa em dinheiro.");session=Guid.Parse(Convert.ToString(v)!);}
        var id=Guid.NewGuid();var now=DateTimeOffset.Now;await using(var q=c.CreateCommand()){q.Transaction=tx;q.CommandText=@"INSERT INTO expense_entries_052
(id,request_id,payable_id,category,description,supplier,document_number,amount,method,occurred_at,session_id,operator_id,notes,created_at)
VALUES($id,$request,$payable,$category,$description,$supplier,$document,$amount,$method,$occurred,$session,$op,$notes,$created)";Add(q,"$id",id);Add(q,"$request",request);Add(q,"$payable",payable);Add(q,"$category",category);Add(q,"$description",description);Add(q,"$supplier",supplier);Add(q,"$document",document);Add(q,"$amount",amount);Add(q,"$method",method);Add(q,"$occurred",occurred.ToString("O"));Add(q,"$session",session);Add(q,"$op",operatorId);Add(q,"$notes",string.IsNullOrWhiteSpace(notes)?null:notes.Trim());Add(q,"$created",now.ToString("O"));await q.ExecuteNonQueryAsync(ct);}
        if(session is Guid cashSession){await using var m=c.CreateCommand();m.Transaction=tx;m.CommandText="INSERT INTO cash_movements(id,session_id,type,amount,origin_id,reason,created_at) VALUES($id,$session,'Expense052',$amount,$origin,$reason,$at)";Add(m,"$id",Guid.NewGuid());Add(m,"$session",cashSession);Add(m,"$amount",-amount);Add(m,"$origin",id);Add(m,"$reason",$"{category}: {description}");Add(m,"$at",now.ToString("O"));await m.ExecuteNonQueryAsync(ct);}
        return new(id,amount,method,session,payable);
    }
    private static async Task Audit(SqliteConnection c,SqliteTransaction tx,Guid op,string action,string entity,Guid id,string reason,CancellationToken ct)
    {await using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="INSERT INTO audit_log(id,user_id,action,entity,entity_id,reason,created_at) VALUES($id,$user,$action,$entity,$entityId,$reason,$at)";Add(q,"$id",Guid.NewGuid());Add(q,"$user",op);Add(q,"$action",action);Add(q,"$entity",entity);Add(q,"$entityId",id);Add(q,"$reason",reason);Add(q,"$at",DateTimeOffset.Now.ToString("O"));await q.ExecuteNonQueryAsync(ct);}
}
