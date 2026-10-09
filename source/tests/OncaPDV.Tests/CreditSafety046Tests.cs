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
    private static async Task<Guid> AnotherAccount(OncaDatabase db,Guid customer,Guid product,Guid op,Guid session)
    {
        var cart=new Cart{CustomerId=customer};
        cart.AddCustom(product,"CREDIT046","OUTRA VENDA",1,100);
        var sale=await new SqliteSaleRepository(db,new SystemClock()).CompleteAsync(cart,
            new[]{new Payment(PaymentMethod.StoreCredit,100)},op,session);
        await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText="SELECT id FROM credit_accounts WHERE sale_id=$sale";
        q.Parameters.AddWithValue("$sale",sale.Id.ToString());
        return Guid.Parse(Convert.ToString(await q.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task BulkRemovesTwoAccountsAtomicallyAndKeepsReceiptsCashSalesAndStock()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca048-bulk-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            var other=await AnotherAccount(f.Db,f.Customer,f.Product,f.Operator,f.Session);
            var guard=new CreditSafety046(f.Db);
            var intent=await guard.PrepareAsync(f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,"Parcial");
            await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,"Parcial",intent.RequestId);
            await guard.AcknowledgeAsync(intent);
            var bulk=new CreditBulk048(f.Db);
            var result=await bulk.DeleteManyAsync(new[]{f.Account,other},f.Operator,"ADMIN: teste | MOTIVO: baixa de contas");
            Assert.Equal(2,result.Count);Assert.Equal(160m,result.Forgiven);Assert.Equal(40m,result.Paid);
            Assert.Equal(2m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
            Assert.Equal(2m,await Value(f.Db,"SELECT COUNT(*) FROM credit_accounts WHERE status='Cancelled' AND balance=0"));
            Assert.Equal(2m,await Value(f.Db,"SELECT COUNT(*) FROM sales WHERE status='Completed'"));
            Assert.Equal(18m,await Value(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(40m,await Value(f.Db,"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Equal(160m,await Value(f.Db,"SELECT COALESCE(SUM(amount),0) FROM credit_entries WHERE reason='EXCLUSÃO ADMINISTRATIVA DE CREDIÁRIO'"));
            Assert.Equal(2m,await Value(f.Db,"SELECT COUNT(*) FROM sale_events WHERE event_type='CreditAccountDeleted'"));
            var ops=new OperationalService(f.Db,Paths(root));
            Assert.Empty(await ops.CreditsAsync());
            Assert.Equal(2,(await ops.CreditsAsync("Excluídos")).Count);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>bulk.DeleteManyAsync(new[]{f.Account,other},f.Operator,"Repetição"));
            Assert.Equal(2m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task BulkWithPendingReceiptRollsBackAllAccounts()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca048-pending-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            var other=await AnotherAccount(f.Db,f.Customer,f.Product,f.Operator,f.Session);
            await new CreditSafety046(f.Db).PrepareAsync(other,20,PaymentMethod.Pix,f.Operator,f.Session,null);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>new CreditBulk048(f.Db)
                .DeleteManyAsync(new[]{f.Account,other},f.Operator,"Motivo registrado"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
            Assert.Equal(200m,await Value(f.Db,"SELECT SUM(balance) FROM credit_accounts"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM sale_events WHERE event_type='CreditAccountDeleted'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task BulkWithCashDifferenceRollsBackAllAccounts()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca048-cash-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            var other=await AnotherAccount(f.Db,f.Customer,f.Product,f.Operator,f.Session);
            await using(var c=f.Db.Open())await using(var q=c.CreateCommand())
            {
                q.CommandText=@"INSERT INTO cash_movements
(id,session_id,type,amount,origin_id,reason,created_at)
VALUES($id,$session,'StoreCreditReceipt',9,$account,'SIMULADO',$at)";
                q.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());
                q.Parameters.AddWithValue("$session",f.Session.ToString());
                q.Parameters.AddWithValue("$account",other.ToString());
                q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));
                await q.ExecuteNonQueryAsync();
            }
            await Assert.ThrowsAsync<InvalidOperationException>(()=>new CreditBulk048(f.Db)
                .DeleteManyAsync(new[]{f.Account,other},f.Operator,"Motivo registrado"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
            Assert.Equal(200m,await Value(f.Db,"SELECT SUM(balance) FROM credit_accounts"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task BulkDeduplicatesIdsAndRejectsEmptySelection()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca048-ids-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var bulk=new CreditBulk048(f.Db);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>bulk.DeleteManyAsync(Array.Empty<Guid>(),f.Operator,"Motivo registrado"));
            var result=await bulk.DeleteManyAsync(new[]{f.Account,f.Account},f.Operator,"Motivo registrado");
            Assert.Equal(1,result.Count);
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }


    [Fact]
    public async Task Version049_BulkRemovalDisappearsFromAllActiveQueriesAndCustomerAccountsOnRestart()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca049-visibility-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            var removed2=await AnotherAccount(f.Db,f.Customer,f.Product,f.Operator,f.Session);
            var retained=await AnotherAccount(f.Db,f.Customer,f.Product,f.Operator,f.Session);
            var guard=new CreditSafety046(f.Db);
            var pending=await guard.PrepareAsync(f.Account,25,PaymentMethod.Pix,f.Operator,f.Session,null);
            await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                f.Account,25,PaymentMethod.Pix,f.Operator,f.Session,null,pending.RequestId);
            await guard.AcknowledgeAsync(pending);
            var removed=new[]{f.Account,removed2};
            var result=await new CreditBulk048(f.Db).DeleteManyAsync(removed,f.Operator,
                "ADMIN: teste | MOTIVO: contas indevidas");
            Assert.Equal(2,result.Count);
            var reopened=new OncaDatabase(Paths(root));
            var proof=await new CreditRemovalVerification049(reopened).CheckAsync(removed);
            Assert.True(proof.Verified,proof.Details);
            Assert.Equal(2,proof.Archived);
            Assert.Equal(0,proof.Active);
            Assert.Equal(0,proof.Invalid);
            var ops=new OperationalService(reopened,Paths(root));
            foreach(var filter in new[]{"Todos","Open","Partial","Paid","Overdue"})
            {
                var visible=await ops.CreditsAsync(filter,f.Customer);
                Assert.DoesNotContain(visible,a=>removed.Contains(a.Id));
            }
            var customerAccounts=await new SqliteCreditRepository(reopened,new SystemClock())
                .ByCustomerAsync(f.Customer);
            Assert.DoesNotContain(customerAccounts,a=>removed.Contains(a.Id));
            Assert.Contains(customerAccounts,a=>a.Id==retained);
            Assert.DoesNotContain(await ops.CreditsAsync(),a=>removed.Contains(a.Id));
            Assert.Equal(2,(await ops.CreditsAsync("Excluídos")).Count);
            Assert.Equal(1m,await Value(reopened,"SELECT COUNT(*) FROM credit_accounts WHERE status='Open' AND balance>0"));
            Assert.Equal(25m,await Value(reopened,"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Equal(3m,await Value(reopened,"SELECT COUNT(*) FROM sales WHERE status='Completed'"));
            Assert.Equal(17m,await Value(reopened,$"SELECT stock FROM products WHERE id='{f.Product}'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version049_TombstoneBlocksStaleStatusFromReappearingOrAcceptingPayment()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca049-tombstone-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            await new CreditSafety046(f.Db).DeleteCreditAsync(f.Account,f.Operator,
                "ADMIN: teste | MOTIVO: conta removida");
            Assert.True((await new CreditRemovalVerification049(f.Db).CheckAsync(new[]{f.Account})).Verified);
            // Simulate a stale importer changing only status/balance but retaining audit.
            await using(var c=f.Db.Open())await using(var q=c.CreateCommand())
            {
                q.CommandText="UPDATE credit_accounts SET status='Open',balance=100 WHERE id=$id";
                q.Parameters.AddWithValue("$id",f.Account.ToString());
                await q.ExecuteNonQueryAsync();
            }
            var reopened=new OncaDatabase(Paths(root));
            var ops=new OperationalService(reopened,Paths(root));
            Assert.DoesNotContain(await ops.CreditsAsync("Todos"),a=>a.Id==f.Account);
            Assert.DoesNotContain(await ops.CreditsAsync("Open"),a=>a.Id==f.Account);
            Assert.DoesNotContain(await new SqliteCreditRepository(reopened,new SystemClock())
                .ByCustomerAsync(f.Customer),a=>a.Id==f.Account);
            await Assert.ThrowsAsync<DomainException>(()=>new SqliteCreditRepository(reopened,new SystemClock())
                .ReceiveOnceAsync(f.Account,5,PaymentMethod.Pix,f.Operator,f.Session,null,Guid.NewGuid()));
            var proof=await new CreditRemovalVerification049(reopened).CheckAsync(new[]{f.Account});
            Assert.False(proof.Verified);
            Assert.True(proof.Invalid>0);
            Assert.Single(await ops.CreditsAsync("Excluídos"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version049_SingleRemovalVerifiedOnFreshConnectionAndHiddenFromCustomer()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca049-single-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            await new CreditSafety046(f.Db).DeleteCreditAsync(f.Account,f.Operator,
                "ADMIN: teste | MOTIVO: retirada administrativa");
            var reopened=new OncaDatabase(Paths(root));
            var result=await new CreditRemovalVerification049(reopened).CheckAsync(new[]{f.Account});
            Assert.True(result.Verified,result.Details);
            Assert.Empty(await new SqliteCreditRepository(reopened,new SystemClock()).ByCustomerAsync(f.Customer));
            Assert.Empty(await new OperationalService(reopened,Paths(root)).CreditsAsync());
            Assert.Equal(1m,await Value(reopened,$"SELECT COUNT(*) FROM credit_account_deletions_046 WHERE account_id='{f.Account}'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }


    [Fact]
    public async Task Version050_LegacyCashDifferenceRequiresExplicitAdminConsentAndKeepsAllMoney()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca050-legacy-cash-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            await using(var c=f.Db.Open())await using(var q=c.CreateCommand())
            {
                q.CommandText=@"INSERT INTO cash_movements(id,session_id,type,amount,origin_id,reason,created_at)
VALUES($id,$session,'StoreCreditReceipt',9,$account,'LANÇAMENTO LEGADO',$at)";
                q.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());
                q.Parameters.AddWithValue("$session",f.Session.ToString());
                q.Parameters.AddWithValue("$account",f.Account.ToString());
                q.Parameters.AddWithValue("$at",DateTimeOffset.UtcNow.ToString("O"));
                await q.ExecuteNonQueryAsync();
            }
            var archive=new CreditArchive050(f.Db);
            var preview=await archive.InspectAsync(new[]{f.Account});
            Assert.Equal(1,preview.WarningCount);Assert.Equal(0,preview.BlockedCount);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>archive.ArchiveAsync(new[]{f.Account},f.Operator,"ADMIN: teste | motivo legado"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
            var result=await archive.ArchiveAsync(new[]{f.Account},f.Operator,"ADMIN: teste | motivo legado",true);
            Assert.Equal(1,result.Archived);Assert.Equal(1,result.WithAlerts);
            Assert.Equal(9m,await Value(f.Db,"SELECT SUM(amount) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_archive_exceptions_050"));
            Assert.True((await new CreditRemovalVerification049(f.Db).CheckAsync(new[]{f.Account})).Verified);
            Assert.Empty(await new OperationalService(f.Db,Paths(root)).CreditsAsync());
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version050_UnpostedIntentIsClosedWithoutCreatingReceiptOrCashMovement()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca050-unposted-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var guard=new CreditSafety046(f.Db);
            await guard.PrepareAsync(f.Account,35,PaymentMethod.Pix,f.Operator,f.Session,null);
            var preview=await new CreditArchive050(f.Db).InspectAsync(new[]{f.Account});
            Assert.Equal(1,preview.Items.Single().PendingUnposted);
            await new CreditArchive050(f.Db).ArchiveAsync(new[]{f.Account},f.Operator,"ADMIN: teste | preparo interrompido",true);
            Assert.Null(await guard.PendingAsync(f.Account));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM cash_movements"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_archive_exceptions_050"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version050_PostedPendingReceiptIsReconciledThenArchivedExactlyOnce()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca050-posted-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var guard=new CreditSafety046(f.Db);
            var pending=await guard.PrepareAsync(f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,null);
            await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                f.Account,40,PaymentMethod.Pix,f.Operator,f.Session,null,pending.RequestId);
            var preview=await new CreditArchive050(f.Db).InspectAsync(new[]{f.Account});
            Assert.Equal(1,preview.Items.Single().PendingPosted);
            var result=await new CreditArchive050(f.Db).ArchiveAsync(new[]{f.Account},f.Operator,"ADMIN: teste | pendencia lançada",true);
            Assert.Equal(60m,result.WrittenOff);
            Assert.Null(await guard.PendingAsync(f.Account));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(40m,await Value(f.Db,"SELECT SUM(amount) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Equal(60m,await Value(f.Db,"SELECT SUM(amount) FROM credit_entries WHERE reason='EXCLUSÃO ADMINISTRATIVA DE CREDIÁRIO'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version050_LegacyCancelledSaleCanBeArchivedWithoutSecondWriteoff()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca050-cancelled-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            await new AdvancedOperationsService(f.Db).CancelSaleAsync(f.Sale,f.Operator,"VENDA CANCELADA");
            var existing=await Value(f.Db,"SELECT COALESCE(SUM(amount),0) FROM credit_entries WHERE type='Credit'");
            var view=await new OperationalService(f.Db,Paths(root)).CreditsAsync("Cancelled",f.Customer);
            Assert.Contains(view,x=>x.Id==f.Account);
            var archive=new CreditArchive050(f.Db);
            var preview=await archive.InspectAsync(new[]{f.Account});
            Assert.True(preview.WarningCount>0);
            var result=await archive.ArchiveAsync(new[]{f.Account},f.Operator,"ADMIN: teste | cancelada antiga",true);
            Assert.Equal(0m,result.WrittenOff);
            Assert.Equal(existing,await Value(f.Db,"SELECT COALESCE(SUM(amount),0) FROM credit_entries WHERE type='Credit'"));
            Assert.Equal(0m,await Value(f.Db,"SELECT SUM(removed_balance) FROM credit_account_deletions_046"));
            Assert.DoesNotContain(await new OperationalService(f.Db,Paths(root)).CreditsAsync("Cancelled"),x=>x.Id==f.Account);
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_archive_exceptions_050"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version050_FullyPaidAccountArchivesWithZeroWriteoffAndPreservedReceipt()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca050-paid-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveAsync(
                f.Account,100,PaymentMethod.Cash,f.Operator,f.Session,null);
            var result=await new CreditArchive050(f.Db).ArchiveAsync(new[]{f.Account},f.Operator,"ADMIN: teste | arquivar quitada");
            Assert.Equal(0m,result.WrittenOff);Assert.Equal(100m,result.Paid);
            Assert.Equal(100m,await Value(f.Db,"SELECT SUM(amount) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_receipts"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM credit_archive_exceptions_050"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version050_BrokenPostedPendingReceiptBlocksEntireBatchEvenWithOverride()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca050-broken-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            var other=await AnotherAccount(f.Db,f.Customer,f.Product,f.Operator,f.Session);
            var guard=new CreditSafety046(f.Db);
            var pending=await guard.PrepareAsync(other,40,PaymentMethod.Pix,f.Operator,f.Session,null);
            var receipt=await new SqliteCreditRepository(f.Db,new SystemClock()).ReceiveOnceAsync(
                other,40,PaymentMethod.Pix,f.Operator,f.Session,null,pending.RequestId);
            await using(var c=f.Db.Open())await using(var q=c.CreateCommand())
            {
                q.CommandText="DELETE FROM credit_receipt_cash_links_045 WHERE receipt_id=$id";
                q.Parameters.AddWithValue("$id",receipt.Id.ToString());await q.ExecuteNonQueryAsync();
            }
            var preview=await new CreditArchive050(f.Db).InspectAsync(new[]{f.Account,other});
            Assert.Equal(1,preview.BlockedCount);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>new CreditArchive050(f.Db)
                .ArchiveAsync(new[]{f.Account,other},f.Operator,"ADMIN: teste | vinculo ausente",true));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
            Assert.Equal(160m,await Value(f.Db,"SELECT SUM(balance) FROM credit_accounts"));
            Assert.NotNull(await guard.PendingAsync(other));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version050_RetryOfAlreadyArchivedAccountCannotDoubleWriteoffOrCash()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca050-retry-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var archive=new CreditArchive050(f.Db);
            var first=await archive.ArchiveAsync(new[]{f.Account},f.Operator,"ADMIN: teste | arquivo normal");
            var again=await archive.ArchiveAsync(new[]{f.Account},f.Operator,"ADMIN: teste | arquivo normal");
            Assert.Equal(1,first.Archived);Assert.Equal(0,again.Archived);Assert.Equal(1,again.AlreadyArchived);
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM sale_events WHERE event_type='CreditAccountDeleted'"));
            Assert.Equal(100m,await Value(f.Db,"SELECT SUM(amount) FROM credit_entries WHERE reason='EXCLUSÃO ADMINISTRATIVA DE CREDIÁRIO'"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM cash_movements"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version050_OneLegacyDifferenceMustNotPartiallyCommitBulkWithoutConsent()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca050-bulk-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            var other=await AnotherAccount(f.Db,f.Customer,f.Product,f.Operator,f.Session);
            await using(var c=f.Db.Open())await using(var q=c.CreateCommand())
            {
                q.CommandText=@"INSERT INTO cash_movements(id,session_id,type,amount,origin_id,reason,created_at)
VALUES($id,$session,'StoreCreditReceipt',11,$account,'DIFERENÇA LEGADO',$at)";
                q.Parameters.AddWithValue("$id",Guid.NewGuid().ToString());
                q.Parameters.AddWithValue("$session",f.Session.ToString());
                q.Parameters.AddWithValue("$account",other.ToString());
                q.Parameters.AddWithValue("$at",DateTimeOffset.UtcNow.ToString("O"));
                await q.ExecuteNonQueryAsync();
            }
            var archive=new CreditArchive050(f.Db);
            await Assert.ThrowsAsync<InvalidOperationException>(()=>archive.ArchiveAsync(
                new[]{f.Account,other},f.Operator,"ADMIN: teste | lote com legado"));
            Assert.Equal(0m,await Value(f.Db,"SELECT COUNT(*) FROM credit_account_deletions_046"));
            var result=await archive.ArchiveAsync(new[]{f.Account,other},f.Operator,"ADMIN: teste | lote com legado",true);
            Assert.Equal(2,result.Archived);Assert.Equal(1,result.WithAlerts);
            Assert.Equal(1m,await Value(f.Db,"SELECT COUNT(*) FROM credit_archive_exceptions_050"));
            Assert.Equal(11m,await Value(f.Db,"SELECT SUM(amount) FROM cash_movements WHERE type='StoreCreditReceipt'"));
            Assert.Empty(await new SqliteCreditRepository(f.Db,new SystemClock()).ByCustomerAsync(f.Customer));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version053_FullPaymentDisappearsFromActiveListButRemainsInPaidHistory()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca053-paid-list-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            var repo=new SqliteCreditRepository(f.Db,new SystemClock());
            await repo.ReceiveAsync(f.Account,100,PaymentMethod.Pix,f.Operator,f.Session,"quitação total");
            var ops=new OperationalService(f.Db,Paths(root));
            Assert.DoesNotContain(await ops.CreditsAsync("Todos",f.Customer),x=>x.Id==f.Account);
            var paid=Assert.Single((await ops.CreditsAsync("Paid",f.Customer)).Where(x=>x.Id==f.Account));
            Assert.Equal(0m,paid.Balance);
            Assert.Equal(CreditStatus.Paid,paid.Status);
            Assert.Equal(100m,paid.Paid);
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version053_PartialPaymentRemainsInActiveListUntilBalanceIsZero()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca053-partial-list-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            var repo=new SqliteCreditRepository(f.Db,new SystemClock());
            await repo.ReceiveAsync(f.Account,40,PaymentMethod.Cash,f.Operator,f.Session,"parcial");
            var ops=new OperationalService(f.Db,Paths(root));
            var active=Assert.Single((await ops.CreditsAsync("Todos",f.Customer)).Where(x=>x.Id==f.Account));
            Assert.Equal(60m,active.Balance);
            Assert.Equal(CreditStatus.Partial,active.Status);
            Assert.DoesNotContain(await ops.CreditsAsync("Paid",f.Customer),x=>x.Id==f.Account);
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task Version053_ArchivedAccountDisappearsFromActiveListAndStaysOnlyInAudit()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca053-delete-list-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);
            await new CreditArchive050(f.Db).ArchiveAsync(new[]{f.Account},f.Operator,"ADMIN: teste | remover da lista ativa");
            var ops=new OperationalService(f.Db,Paths(root));
            Assert.DoesNotContain(await ops.CreditsAsync("Todos",f.Customer),x=>x.Id==f.Account);
            Assert.DoesNotContain(await ops.CreditsAsync("Paid",f.Customer),x=>x.Id==f.Account);
            Assert.Contains(await ops.CreditsAsync("Excluídos",f.Customer),x=>x.Id==f.Account);
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

}
