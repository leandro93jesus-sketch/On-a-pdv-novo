using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using OncaPDV.Application;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;
using Xunit;

namespace OncaPDV.Tests;

public sealed class CreditSafety046Tests
{
    private static AppPaths Paths(string root)=>new(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));
    private static async Task<(OncaDatabase Db,Guid Customer,Guid Product,Guid Session,Guid Operator,Guid Sale,Guid Account)> Fixture(string root)
    {
        var db=new OncaDatabase(Paths(root));db.Migrate();
        var customer=Guid.NewGuid();var product=Guid.NewGuid();var session=Guid.NewGuid();var op=Guid.NewGuid();
        await using(var c=db.Open())await using(var q=c.CreateCommand())
        {
            q.CommandText=@"INSERT INTO customers(id,name,active) VALUES($customer,'CREDIARIO SEGURANCA',1);
INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active)
VALUES($product,'CREDIT046','ITEM TESTE',5,100,20,0,'UN',1);
INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount) VALUES($session,$op,$at,0)";
            q.Parameters.AddWithValue("$customer",customer.ToString());
            q.Parameters.AddWithValue("$product",product.ToString());
            q.Parameters.AddWithValue("$session",session.ToString());
            q.Parameters.AddWithValue("$op",op.ToString());
            q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));
            await q.ExecuteNonQueryAsync();
        }
        var cart=new Cart{CustomerId=customer};cart.AddCustom(product,"CREDIT046","ITEM TESTE",1,100);
        var sale=await new SqliteSaleRepository(db,new SystemClock()).CompleteAsync(cart,
            new[]{new Payment(PaymentMethod.StoreCredit,100)},op,session);
        await using var cx=db.Open();await using var find=cx.CreateCommand();
        find.CommandText="SELECT id FROM credit_accounts WHERE sale_id=$sale";
        find.Parameters.AddWithValue("$sale",sale.Id.ToString());
        var account=Guid.Parse(Convert.ToString(await find.ExecuteScalarAsync())!);
        return(db,customer,product,session,op,sale.Id,account);
    }
    private static async Task<decimal> Value(OncaDatabase db,string sql)
    {
        await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText=sql;
        return Convert.ToDecimal(await q.ExecuteScalarAsync());
    }

    [Fact]
    public async Task PendingPaymentSurvivesRestart_RetryIsOneReceiptAndOneCashMovement()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca046-intent-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            var guard=new CreditSafety046(f.Db);
            var intent=await guard.PrepareAsync(f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,"Parcial");
            var first=await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,"Parcial",intent.RequestId);
            var restart=new CreditSafety046(new OncaDatabase(Paths(root)));
            var pending=await restart.PendingAsync(f.Account);
            Assert.NotNull(pending);
            Assert.Equal(intent.RequestId,pending!.RequestId);
            var checkedCash=await restart.CheckAsync(pending);
            Assert.NotNull(checkedCash);
            Assert.Equal(first.Id,checkedCash!.ReceiptId);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>restart.PrepareAsync(f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,"duplicate"));
            var again=await new SqliteCreditRepository(new OncaDatabase(Paths(root)),new SystemClock()).ReceiveOnceAsync(
                f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,"Parcial",pending.RequestId);
            Assert.Equal(first.Id,again.Id);
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipt_cash_links_045"));
            Assert.Equal(60m,await Value(f.Db,$"SELECT balance FROM credit_accounts WHERE id='{f.Account}'"));
            var audit=await guard.ReconcileAsync(f.Account);
            Assert.True(audit.Matches);Assert.True(audit.AllIndividuallyLinked);
            Assert.Equal(40m,audit.ActiveReceipts);Assert.Equal(40m,audit.CashNet);
            await restart.AcknowledgeAsync(pending);
            Assert.Null(await guard.PendingAsync(f.Account));
            var next=await guard.PrepareAsync(f.Account,60,PaymentMethod.Cash,f.Operator,f.Session,"Quitacao");
            Assert.NotEqual(intent.RequestId,next.RequestId);
            await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                f.Account,60,PaymentMethod.Cash,f.Operator,f.Session,"Quitacao",next.RequestId);
            await guard.AcknowledgeAsync(next);
            Assert.Equal(2m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(100m,await Value(f.Db,"SELECT SUM(amount) FROM cash_movements WHERE type='StoreCreditReceipt'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task UncommittedIntentCanBeDiscardedButCommittedReceiptCannotBeDiscarded()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca046-abandon-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var guard=new CreditSafety046(f.Db);
            var pending=await guard.PrepareAsync(f.Account,30,PaymentMethod.Cash,f.Operator,f.Session,null);
            Assert.Null(await guard.CheckAsync(pending));
            await guard.AbandonUncommittedAsync(pending);
            Assert.Null(await guard.PendingAsync(f.Account));
            var next=await guard.PrepareAsync(f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,null);
            await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,null,next.RequestId);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>guard.AbandonUncommittedAsync(next));
            Assert.NotNull(await guard.PendingAsync(f.Account));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task DeletePartialCreditKeepsSaleAndLegitimatePaymentButForgivesOnlyOutstandingBalance()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca046-delete-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var guard=new CreditSafety046(f.Db);
            var intent=await guard.PrepareAsync(f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,null);
            await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,null,intent.RequestId);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>guard.DeleteCreditAsync(f.Account,f.Operator,"Excluir por duplicidade"));
            await guard.AcknowledgeAsync(intent);
            var deleted=await guard.DeleteCreditAsync(f.Account,f.Operator,"ADMIN: Leandro | MOTIVO: credito indevido");
            Assert.Equal(60m,deleted.Forgiven);Assert.Equal(40m,deleted.Paid);
            Assert.Equal(0m,await Value(f.Db,$"SELECT balance FROM credit_accounts WHERE id='{f.Account}'"));
            Assert.Equal(1m,await Value(f.Db,$"SELECT COUNT(*) FROM credit_accounts WHERE id='{f.Account}' AND status='Cancelled'"));
            Assert.Equal(1m,await Value(f.Db,$"SELECT COUNT(*) FROM sales WHERE id='{f.Sale}' AND status='Completed'"));
            Assert.Equal(19m,await Value(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(40m,await Value(f.Db,"SELECT SUM(amount) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Equal(60m,await Value(f.Db,$"SELECT SUM(amount) FROM credit_entries WHERE sale_id='{f.Sale}' AND reason='EXCLUSÃO ADMINISTRATIVA DE CREDIÁRIO'"));
            Assert.Equal(1m,await Value(f.Db,$"SELECT COUNT(*) FROM sale_events WHERE sale_id='{f.Sale}' AND event_type='CreditAccountDeleted'"));
            var ops=new OperationalService(f.Db,Paths(root));
            Assert.DoesNotContain(await ops.CreditsAsync(),x=>x.Id==f.Account);
            var audit=await ops.CreditsAsync("Excluídos");
            Assert.Contains(audit,x=>x.Id==f.Account && x.Paid==40 && x.Balance==0);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>guard.DeleteCreditAsync(f.Account,f.Operator,"again"));
            await Assert.ThrowsAsync<DomainException>(()=>new SqliteCreditRepository(f.Db,new SystemClock())
                .ReceiveOnceAsync(f.Account,10,PaymentMethod.Cash,f.Operator,f.Session,null,Guid.NewGuid()));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task ExcludedCreditThenCancelledSaleDoesNotCreateDoubleWriteoffAndReversesRealPayment()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca046-sale-cancel-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var guard=new CreditSafety046(f.Db);
            var intent=await guard.PrepareAsync(f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,null);
            await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,null,intent.RequestId);
            await guard.AcknowledgeAsync(intent);
            await guard.DeleteCreditAsync(f.Account,f.Operator,"ADMIN: Leandro | MOTIVO: credito incorreto");
            await new AdvancedOperationsService(f.Db).CancelSaleAsync(f.Sale,f.Operator,"VENDA CANCELADA");
            Assert.Equal(20m,await Value(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
            Assert.Equal(0m,await Value(f.Db,$"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Equal(100m,await Value(f.Db,$"SELECT SUM(amount) FROM credit_entries WHERE sale_id='{f.Sale}' AND type='Credit'"));
            Assert.Equal(1m,await Value(f.Db,$"SELECT COUNT(*) FROM credit_receipt_reversals"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task CashMismatchBlocksCreditExclusionWithoutMutatingAccount()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca046-mismatch-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            await using(var c=f.Db.Open())await using(var q=c.CreateCommand())
            {
                q.CommandText=@"INSERT INTO cash_movements
(id,session_id,type,amount,origin_id,reason,created_at)
VALUES($id,$session,'StoreCreditReceipt',15,$account,'SIMULACAO ERRO ANTIGO',$at)";
                q.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());
                q.Parameters.AddWithValue("$session",f.Session.ToString());
                q.Parameters.AddWithValue("$account",f.Account.ToString());
                q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));
                await q.ExecuteNonQueryAsync();
            }
            var guard=new CreditSafety046(f.Db);
            var report=await guard.ReconcileAsync(f.Account);
            Assert.False(report.Matches);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>guard.DeleteCreditAsync(f.Account,f.Operator,"Excluir indevido"));
            Assert.Equal(100m,await Value(f.Db,$"SELECT balance FROM credit_accounts WHERE id='{f.Account}'"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task FullyPaidCreditCanBeArchivedWithoutReversingCash()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca046-paid-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var guard=new CreditSafety046(f.Db);
            var intent=await guard.PrepareAsync(f.Account,100,PaymentMethod.Cash,f.Operator,f.Session,null);
            await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                f.Account,100,PaymentMethod.Cash,f.Operator,f.Session,null,intent.RequestId);
            await guard.AcknowledgeAsync(intent);
            var removed=await guard.DeleteCreditAsync(f.Account,f.Operator,"ADMIN: Leandro | MOTIVO: arquivar conta paga");
            Assert.Equal(0m,removed.Forgiven);
            Assert.Equal(100m,removed.Paid);
            Assert.Equal(100m,await Value(f.Db,"SELECT SUM(amount) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Equal(0m,await Value(f.Db,$"SELECT COALESCE(SUM(amount),0) FROM credit_entries WHERE sale_id='{f.Sale}' AND reason='EXCLUSÃO ADMINISTRATIVA DE CREDIÁRIO'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }
}
