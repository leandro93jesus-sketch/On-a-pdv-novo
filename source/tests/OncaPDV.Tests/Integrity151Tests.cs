using Microsoft.Data.Sqlite;
using OncaPDV.Infrastructure;
namespace OncaPDV.Tests;

public sealed class Integrity151Tests:IDisposable
{
    private readonly string _root=Path.Combine(Path.GetTempPath(),"onca-integrity151-"+Guid.NewGuid());
    private readonly AppPaths _paths;private readonly OncaDatabase _db;
    public Integrity151Tests(){_paths=new(_root,Path.Combine(_root,"data"),Path.Combine(_root,"backups"),Path.Combine(_root,"logs"),Path.Combine(_root,"exports"),Path.Combine(_root,"print"));_db=new(_paths);_db.Migrate();}

    [Fact]
    public async Task Center_detects_duplicate_phone_and_credit_cash_difference_without_mutating_data()
    {
        var c1=Guid.NewGuid();var c2=Guid.NewGuid();var session=Guid.NewGuid();var sale=Guid.NewGuid();var account=Guid.NewGuid();var receipt=Guid.NewGuid();
        await using(var c=_db.Open())await using(var q=c.CreateCommand())
        {
            q.CommandText=@"INSERT INTO customers(id,name,phone,active) VALUES($c1,'Cliente Um','(15) 99999-9999',1);
INSERT INTO customers(id,name,phone,active) VALUES($c2,'Cliente Dois','15 99999-9999',1);
INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES($session,'op',$at,0);
INSERT INTO sales(id,number,created_at,operator_id,customer_id,cash_session_id,discount,total,status,fiscal_status) VALUES($sale,151001,$at,'op',$c1,$session,0,100,'Completed','NotRequested');
INSERT INTO credit_accounts(id,customer_id,sale_id,original_amount,balance,created_at,due_at,status,installments) VALUES($account,$c1,$sale,100,60,$at,$due,'Partial',1);
INSERT INTO credit_receipts(id,account_id,amount,method,operator_id,created_at,notes) VALUES($receipt,$account,40,'Pix','op',$at,'teste');";
            q.Parameters.AddWithValue("$c1",c1.ToString());q.Parameters.AddWithValue("$c2",c2.ToString());q.Parameters.AddWithValue("$session",session.ToString());q.Parameters.AddWithValue("$sale",sale.ToString());q.Parameters.AddWithValue("$account",account.ToString());q.Parameters.AddWithValue("$receipt",receipt.ToString());q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$due",DateTimeOffset.Now.AddDays(10).ToString("O"));await q.ExecuteNonQueryAsync();
        }
        var svc=new IntegrityCenter151(_db,_paths);var report=await svc.RunAsync();
        Assert.Equal("ok",report.DatabaseIntegrity,StringComparer.OrdinalIgnoreCase);
        Assert.Contains(report.Duplicates,x=>x.Entity=="Cliente"&&x.Field=="Telefone"&&x.Count==2);
        Assert.Contains(report.Checks,x=>x.Code=="CREDIT-CASH-DIFF"&&x.Count==1&&x.Level=="ATENÇÃO");
        var credit=Assert.Single(report.Credits,x=>x.AccountId==account);Assert.Equal("CONFIRMAÇÃO ADMIN",credit.Diagnosis);Assert.Equal(40m,credit.Receipts);Assert.Equal(0m,credit.Cash);
        await using var verify=_db.Open();await using var qq=verify.CreateCommand();qq.CommandText="SELECT balance FROM credit_accounts WHERE id=$id";qq.Parameters.AddWithValue("$id",account.ToString());Assert.Equal(60m,Convert.ToDecimal(await qq.ExecuteScalarAsync()));
    }

    [Fact]
    public async Task Center_exports_readable_report_and_warns_when_no_backup_exists()
    {
        var svc=new IntegrityCenter151(_db,_paths);var r=await svc.RunAsync();Assert.Contains(r.Checks,x=>x.Code=="BACKUP-AGE"&&x.Level=="ATENÇÃO");var file=await svc.ExportAsync();Assert.True(File.Exists(file));var text=await File.ReadAllTextAsync(file);Assert.Contains("CENTRO DE INTEGRIDADE",text);Assert.Contains("VERIFICAÇÕES",text);
    }

    public void Dispose(){SqliteConnection.ClearAllPools();try{if(Directory.Exists(_root))Directory.Delete(_root,true);}catch{}}
}
