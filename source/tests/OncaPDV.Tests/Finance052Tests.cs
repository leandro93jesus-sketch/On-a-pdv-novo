using Microsoft.Data.Sqlite;
using OncaPDV.Infrastructure;
namespace OncaPDV.Tests;

public sealed class Finance052Tests:IDisposable
{
    private readonly string _root=Path.Combine(Path.GetTempPath(),"onca-finance052-"+Guid.NewGuid());private readonly AppPaths _paths;private readonly OncaDatabase _db;private readonly Finance052 _svc;private readonly Guid _op=Guid.NewGuid();
    public Finance052Tests(){_paths=new(_root,Path.Combine(_root,"data"),Path.Combine(_root,"backups"),Path.Combine(_root,"logs"),Path.Combine(_root,"exports"),Path.Combine(_root,"print"));_db=new(_paths);_db.Migrate();_svc=new(_db);}

    [Fact]
    public async Task Installments_preserve_total_and_monthly_due_dates()
    {
        var due=new DateTimeOffset(2026,10,10,0,0,0,TimeSpan.FromHours(-3));var rows=await _svc.CreateInstallmentsAsync("Fornecedor A","Compra produtos","Fornecedores",100,due,3,"NF-1",null,_op);
        Assert.Equal(3,rows.Count);Assert.Equal(100m,rows.Sum(x=>x.Amount));Assert.Equal(new[]{1,2,3},rows.Select(x=>x.InstallmentNumber));Assert.Equal(new[]{10,11,12},rows.Select(x=>x.DueAt.Month));Assert.All(rows,x=>Assert.Equal("Pendente",x.Status));
    }

    [Fact]
    public async Task Cash_expense_requires_open_cash_and_posts_once_with_idempotent_request()
    {
        var req=Guid.NewGuid();await Assert.ThrowsAsync<InvalidOperationException>(()=>_svc.AddExpenseAsync("Energia","Conta energia",20,"Dinheiro",DateTimeOffset.Now,null,null,null,_op,req));await OpenCash();
        var first=await _svc.AddExpenseAsync("Energia","Conta energia",20,"Dinheiro",DateTimeOffset.Now,null,null,null,_op,req);var again=await _svc.AddExpenseAsync("Energia","Conta energia",20,"Dinheiro",DateTimeOffset.Now,null,null,null,_op,req);Assert.Equal(first.Id,again.Id);
        await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT COUNT(*) FROM expense_entries_052 WHERE request_id=$id";q.Parameters.AddWithValue("$id",req.ToString());Assert.Equal(1L,Convert.ToInt64(await q.ExecuteScalarAsync()));await using var m=c.CreateCommand();m.CommandText="SELECT amount FROM cash_movements WHERE origin_id=$id AND type='Expense052'";m.Parameters.AddWithValue("$id",first.Id.ToString());Assert.Equal(-20m,Convert.ToDecimal(await m.ExecuteScalarAsync()));
    }

    [Fact]
    public async Task Non_cash_expense_does_not_require_cash_and_old_summary_includes_it()
    {
        await _svc.AddExpenseAsync("Internet / Telefone","Internet",35,"PIX",DateTimeOffset.Now,"Operadora",null,null,_op,Guid.NewGuid());var final=new FinalFeaturesService(_db);var summary=await final.SummaryAsync(DateTimeOffset.Now.AddHours(-1),DateTimeOffset.Now.AddHours(1));Assert.Equal(35m,summary.Expenses);
        await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT COUNT(*) FROM cash_movements WHERE type='Expense052'";Assert.Equal(0L,Convert.ToInt64(await q.ExecuteScalarAsync()));
    }

    [Fact]
    public async Task Payable_supports_partial_then_full_payment_and_summary()
    {
        var p=Assert.Single(await _svc.CreateInstallmentsAsync("Fornecedor B","Compra","Fornecedores",90,DateTimeOffset.Now.AddDays(-2),1,null,null,_op));var a=await _svc.PayAsync(p.Id,40,"PIX","parcial",_op,Guid.NewGuid());Assert.Equal(40m,a.Amount);var partial=Assert.Single(await _svc.PayablesAsync("Todos"),x=>x.Id==p.Id);Assert.Equal(50m,partial.Remaining);Assert.Contains("Parcial",partial.Status);
        await _svc.PayAsync(p.Id,50,"Transferência","quitação",_op,Guid.NewGuid());var paid=Assert.Single(await _svc.PayablesAsync("Pagos"),x=>x.Id==p.Id);Assert.Equal(0m,paid.Remaining);Assert.Equal("Pago",paid.Status);var s=await _svc.SummaryAsync();Assert.Equal(0m,s.OpenPayables);Assert.True(s.PaidThisMonth>=90m);
    }

    [Fact]
    public async Task Cancel_unpaid_payable_is_audited_but_paid_payable_is_preserved()
    {
        var rows=await _svc.CreateInstallmentsAsync("Fornecedor C","Serviço","Manutenção",60,DateTimeOffset.Now.AddDays(5),2,null,null,_op);await _svc.CancelPayableAsync(rows[0].Id,_op,"lançamento incorreto");var cancelled=Assert.Single(await _svc.PayablesAsync("Cancelados"),x=>x.Id==rows[0].Id);Assert.Equal("Cancelado",cancelled.Status);await _svc.PayAsync(rows[1].Id,10,"PIX",null,_op,Guid.NewGuid());await Assert.ThrowsAsync<InvalidOperationException>(()=>_svc.CancelPayableAsync(rows[1].Id,_op,"não apagar pagamento"));
        await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT COUNT(*) FROM audit_log WHERE action='PayableCancelled'";Assert.Equal(1L,Convert.ToInt64(await q.ExecuteScalarAsync()));
    }

    [Fact]
    public async Task Migration_v6_is_idempotent_and_keeps_financial_rows()
    {
        await _svc.AddExpenseAsync("Outros","Teste migração",12,"PIX",DateTimeOffset.Now,null,null,null,_op,Guid.NewGuid());_db.Migrate();await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT COUNT(*) FROM expense_entries_052";Assert.Equal(1L,Convert.ToInt64(await q.ExecuteScalarAsync()));await using var v=c.CreateCommand();v.CommandText="SELECT COUNT(*) FROM schema_versions WHERE version=6";Assert.Equal(1L,Convert.ToInt64(await v.ExecuteScalarAsync()));
    }

    private async Task OpenCash(){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES($id,$op,$at,100)";q.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());q.Parameters.AddWithValue("$op",_op.ToString());q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));await q.ExecuteNonQueryAsync();}
    public void Dispose(){SqliteConnection.ClearAllPools();try{if(Directory.Exists(_root))Directory.Delete(_root,true);}catch{}}
}
