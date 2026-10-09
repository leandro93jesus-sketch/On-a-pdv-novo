using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using OncaPDV.Application;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;
using Xunit;

namespace OncaPDV.Tests;

public sealed class CreditIntegrity045Tests
{
    private static AppPaths Paths(string root)=>new(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));
    private static async Task<(OncaDatabase Db,Guid Customer,Guid Product,Guid Session1,Guid Session2,Guid Operator)> Fixture(string root)
    {
        var db=new OncaDatabase(Paths(root));db.Migrate();
        var customer=Guid.NewGuid();var product=Guid.NewGuid();var session1=Guid.NewGuid();var session2=Guid.NewGuid();var op=Guid.NewGuid();
        await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText=@"INSERT INTO customers(id,name,active) VALUES($customer,'TESTE CREDIARIO 045',1);
INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active)
VALUES($product,'CREDIT045','ITEM TESTE',5,100,20,0,'UN',1);
INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES($session1,$op,$at,0);
INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES($session2,$op,$at,0)";
        q.Parameters.AddWithValue("$customer",customer.ToString());q.Parameters.AddWithValue("$product",product.ToString());
        q.Parameters.AddWithValue("$session1",session1.ToString());q.Parameters.AddWithValue("$session2",session2.ToString());
        q.Parameters.AddWithValue("$op",op.ToString());q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));
        await q.ExecuteNonQueryAsync();
        return(db,customer,product,session1,session2,op);
    }
    private static Cart CartFor(Guid customer,Guid product)
    {
        var c=new Cart{CustomerId=customer};c.AddCustom(product,"CREDIT045","ITEM TESTE",1,100);return c;
    }
    private static async Task<decimal> Value(OncaDatabase db,string sql)
    {
        await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText=sql;
        return Convert.ToDecimal(await q.ExecuteScalarAsync());
    }
    private static async Task<(Guid Sale,Guid Account)> CreateCredit((OncaDatabase Db,Guid Customer,Guid Product,Guid Session1,Guid Session2,Guid Operator) f)
    {
        var s=await new SqliteSaleRepository(f.Db,new SystemClock()).CompleteAsync(CartFor(f.Customer,f.Product),
            new[]{new Payment(PaymentMethod.StoreCredit,100)},f.Operator,f.Session1);
        await using var c=f.Db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT id FROM credit_accounts WHERE sale_id=$sale";
        q.Parameters.AddWithValue("$sale",s.Id.ToString());var account=Guid.Parse(Convert.ToString(await q.ExecuteScalarAsync())!);
        return(s.Id,account);
    }

    [Fact]
    public async Task SameSaleRetryCreatesOnlyOneDebtAndOneStockMovement()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-credit045-sale-"+Guid.NewGuid().ToString("N"));
        try{
            var f=await Fixture(root);var cart=CartFor(f.Customer,f.Product);
            var repo=new SqliteSaleRepository(f.Db,new SystemClock());var payments=new[]{new Payment(PaymentMethod.StoreCredit,100)};
            var first=await repo.CompleteAsync(cart,payments,f.Operator,f.Session1);
            var same=await repo.CompleteAsync(cart,payments,f.Operator,f.Session1);
            Assert.Equal(first.Id,same.Id);
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM sales"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_accounts"));
            Assert.Equal(100m,await Value(f.Db,"SELECT COALESCE(SUM(balance),0) FROM credit_accounts"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_entries WHERE type='Debit'"));
            Assert.Equal(19m,await Value(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COALESCE(SUM(amount),0) FROM cash_movements"));
        }finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task TwoStoreCreditTenderRowsOfOneSaleCreateOneConsolidatedAccount()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-credit045-tenders-"+Guid.NewGuid().ToString("N"));
        try{
            var f=await Fixture(root);var cart=CartFor(f.Customer,f.Product);
            var sale=await new SqliteSaleRepository(f.Db,new SystemClock()).CompleteAsync(cart,new[]{
                new Payment(PaymentMethod.StoreCredit,40),new Payment(PaymentMethod.StoreCredit,60)},f.Operator,f.Session1);
            Assert.Equal(1m,await Value(f.Db,$"SELECT COUNT(*) FROM credit_accounts WHERE sale_id='{sale.Id}'"));
            Assert.Equal(100m,await Value(f.Db,$"SELECT SUM(original_amount) FROM credit_accounts WHERE sale_id='{sale.Id}'"));
            Assert.Equal(100m,await Value(f.Db,$"SELECT SUM(amount) FROM credit_entries WHERE sale_id='{sale.Id}' AND type='Debit'"));
            Assert.Equal(2m,await Value(f.Db,$"SELECT COUNT(*) FROM payments WHERE sale_id='{sale.Id}'"));
        }finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task SameReceiptRequestCannotDuplicatePartialPaymentEvenAfterRestart()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-credit045-receipt-"+Guid.NewGuid().ToString("N"));
        try{
            var f=await Fixture(root);var account=(await CreateCredit(f)).Account;var request=Guid.NewGuid();
            var first=await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(account,40,PaymentMethod.Pix,f.Operator,f.Session1,"Parcial",request);
            var repeated=await new SqliteCreditRepository(new OncaDatabase(Paths(root)),new SystemClock())
                .ReceiveOnceAsync(account,40,PaymentMethod.Pix,f.Operator,f.Session1,"Parcial",request);
            Assert.Equal(first.Id,repeated.Id);
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipt_cash_links_045"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipt_requests_045"));
            Assert.Equal(60m,await Value(f.Db,$"SELECT balance FROM credit_accounts WHERE id='{account}'"));
            Assert.Equal(40m,await Value(f.Db,$"SELECT SUM(amount) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            await Assert.ThrowsAsync<DomainException>(()=>new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(account,50,PaymentMethod.Pix,f.Operator,f.Session1,"wrong reuse",request));
            var second=await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(account,60,PaymentMethod.Cash,f.Operator,f.Session2,"Quitação",Guid.NewGuid());
            Assert.NotEqual(first.Id,second.Id);
            Assert.Equal(0m,await Value(f.Db,$"SELECT balance FROM credit_accounts WHERE id='{account}'"));
            Assert.Equal(2m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(100m,await Value(f.Db,"SELECT SUM(amount) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            await Assert.ThrowsAsync<DomainException>(()=>new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(account,1,PaymentMethod.Cash,f.Operator,f.Session2,"after paid",Guid.NewGuid()));
        }finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task ReceiptReversalTargetsOriginalSessionAndUpdatesNetReports()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-credit045-reverse-"+Guid.NewGuid().ToString("N"));
        try{
            var f=await Fixture(root);var account=(await CreateCredit(f)).Account;
            var credits=new SqliteCreditRepository(f.Db,new SystemClock());
            var first=await credits.ReceiveOnceAsync(account,40,PaymentMethod.Pix,f.Operator,f.Session1,null,Guid.NewGuid());
            var second=await credits.ReceiveOnceAsync(account,60,PaymentMethod.Cash,f.Operator,f.Session2,null,Guid.NewGuid());
            var svc=new AdvancedOperationsService(f.Db);
            await svc.ReverseCreditReceiptAsync(first.Id,f.Operator,"Estornar a primeira parcela");
            Assert.Equal(0m,await Value(f.Db,$"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id='{f.Session1}' AND type='StoreCreditReceipt'"));
            Assert.Equal(60m,await Value(f.Db,$"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id='{f.Session2}' AND type='StoreCreditReceipt'"));
            Assert.Equal(40m,await Value(f.Db,$"SELECT balance FROM credit_accounts WHERE id='{account}'"));
            await Assert.ThrowsAsync<DomainException>(()=>svc.ReverseCreditReceiptAsync(first.Id,f.Operator,"Não repetir"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipt_reversals"));
            var from=DateTimeOffset.Now.AddDays(-1);var to=DateTimeOffset.Now.AddDays(1);
            var report=await new OperationalService(f.Db,Paths(root)).SalesSummaryAsync(from,to);
            Assert.Equal(60m,report.CreditReceipts);
            var detailed=await new OperationalService(f.Db,Paths(root)).CreditMovementsAsync(account);
            Assert.Contains(detailed,x=>x.Id==first.Id && x.Notes is not null && x.Notes.Contains("ESTORNADO"));
        }finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task DeleteCreditSaleReversesReceiptsAcrossTheirExactSessions()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-credit045-delete-"+Guid.NewGuid().ToString("N"));
        try{
            var f=await Fixture(root);var ids=await CreateCredit(f);var credits=new SqliteCreditRepository(f.Db,new SystemClock());
            var first=await credits.ReceiveOnceAsync(ids.Account,40,PaymentMethod.Pix,f.Operator,f.Session1,null,Guid.NewGuid());
            var second=await credits.ReceiveOnceAsync(ids.Account,60,PaymentMethod.Cash,f.Operator,f.Session2,null,Guid.NewGuid());
            await new AdvancedOperationsService(f.Db).DeleteSaleAsync(ids.Sale,f.Operator,"Exclusão do teste");
            Assert.Equal(0m,await Value(f.Db,$"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id='{f.Session1}' AND type='StoreCreditReceipt'"));
            Assert.Equal(0m,await Value(f.Db,$"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id='{f.Session2}' AND type='StoreCreditReceipt'"));
            Assert.Equal(2m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipt_reversals"));
            Assert.Equal(0m,await Value(f.Db,$"SELECT balance FROM credit_accounts WHERE id='{ids.Account}'"));
            Assert.Equal(1m,await Value(f.Db,$"SELECT COUNT(*) FROM sales WHERE id='{ids.Sale}' AND status='Deleted'"));
            Assert.Equal(20m,await Value(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COALESCE(SUM(amount),0) FROM cash_movements"));
            var from=DateTimeOffset.Now.AddDays(-1);var to=DateTimeOffset.Now.AddDays(1);
            Assert.Equal(0m,(await new OperationalService(f.Db,Paths(root)).SalesSummaryAsync(from,to)).CreditReceipts);
        }finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task ExistingCancelledAccountDoesNotAppearAsAnActiveNewDebt()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-credit045-view-"+Guid.NewGuid().ToString("N"));
        try{
            var f=await Fixture(root);var ids=await CreateCredit(f);
            await new AdvancedOperationsService(f.Db).CancelSaleAsync(ids.Sale,f.Operator,"Duplicada");
            var svc=new OperationalService(f.Db,Paths(root));
            Assert.DoesNotContain(await svc.CreditsAsync("Todos",f.Customer),a=>a.Id==ids.Account);
            Assert.Contains(await svc.CreditsAsync("Cancelled",f.Customer),a=>a.Id==ids.Account && a.Status==CreditStatus.Cancelled);
        }finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }
}
