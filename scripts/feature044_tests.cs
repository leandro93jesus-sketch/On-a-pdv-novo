using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using OncaPDV.Application;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;
using Xunit;

namespace OncaPDV.Tests;

public sealed class SalesIntegrity044Tests
{
    private static AppPaths Paths(string root)=>new(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));
    private static async Task<(OncaDatabase Db,Guid Product,Guid Session,Guid Operator)> Fixture(string root)
    {
        var db=new OncaDatabase(Paths(root));db.Migrate();
        var product=Guid.NewGuid();var session=Guid.NewGuid();var op=Guid.NewGuid();
        await using var c=db.Open();await using var q=c.CreateCommand();
        q.CommandText=@"INSERT INTO products(id,internal_code,name,cost_price,sale_price,stock,minimum_stock,unit,active)
VALUES($id,'CHECKOUT044','ITEM TESTE',5,10,20,0,'UN',1);
INSERT INTO cash_sessions(id,operator_id,opened_at,opening_amount)
VALUES($session,$op,$at,0)";
        q.Parameters.AddWithValue("$id",product.ToString());
        q.Parameters.AddWithValue("$session",session.ToString());
        q.Parameters.AddWithValue("$op",op.ToString());
        q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));
        await q.ExecuteNonQueryAsync();
        return(db,product,session,op);
    }
    private static Cart CartFor(Guid product,Guid? id=null)
    {
        var cart=new Cart{Id=id??Guid.NewGuid()};
        cart.AddCustom(product,"CHECKOUT044","ITEM TESTE",2,10);
        return cart;
    }
    private static async Task<decimal> Amount(OncaDatabase db,string sql)
    {
        await using var c=db.Open();await using var q=c.CreateCommand();q.CommandText=sql;
        return Convert.ToDecimal(await q.ExecuteScalarAsync());
    }

    [Fact]
    public async Task SameCartCheckoutRepeated_CreatesOnlyOneSaleAndOneStockAndCashMovement()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-integrity044-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var repo=new SqliteSaleRepository(f.Db,new SystemClock());
            var cart=CartFor(f.Product);
            var payments=new[]{new Payment(PaymentMethod.Cash,20,20)};
            var first=await repo.CompleteAsync(cart,payments,f.Operator,f.Session);
            var retry=await repo.CompleteAsync(cart,payments,f.Operator,f.Session);
            Assert.Equal(first.Id,retry.Id);
            Assert.Equal(first.Number,retry.Number);
            Assert.Equal(1m,await Amount(f.Db,"SELECT COUNT(*) FROM sales"));
            Assert.Equal(1m,await Amount(f.Db,"SELECT COUNT(*) FROM checkout_keys_044"));
            Assert.Equal(18m,await Amount(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
            Assert.Equal(20m,await Amount(f.Db,"SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE type='Sale'"));
            Assert.Equal(1m,await Amount(f.Db,"SELECT COUNT(*) FROM stock_movements WHERE type='Sale'"));
            // Same products and amount CAN be a legitimately separate sale with a new cart.
            var second=await repo.CompleteAsync(CartFor(f.Product),payments,f.Operator,f.Session);
            Assert.NotEqual(first.Id,second.Id);
            Assert.Equal(2m,await Amount(f.Db,"SELECT COUNT(*) FROM sales"));
            Assert.Equal(16m,await Amount(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task RestartRecoveryPreservesCartIdAndOldSnapshotStillLoads()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-recovery044-"+Guid.NewGuid().ToString("N"));
        try
        {
            var paths=Paths(root);var store=new JsonCartRecoveryStore(paths);var cart=CartFor(Guid.NewGuid());
            await store.SaveAsync(cart);
            var restarted=await new JsonCartRecoveryStore(paths).LoadAsync();
            Assert.NotNull(restarted);
            Assert.Equal(cart.Id,restarted.Id);
            var db=new OncaDatabase(paths);db.Migrate();
            var slots=new MultiSaleRecovery040(db,"terminal-044");
            slots.Save(new(1,2,new(){new(1,"Balcão","CONSUMIDOR",null,null,0,
                new(){new(cart.Items[0].ProductId,cart.Items[0].Code,cart.Items[0].Name,2,10)},cart.Id)}));
            Assert.Equal(cart.Id,slots.Load()!.Tabs[0].CartId);
            // Pre-0.1.44 recovery JSON does not contain CartId.
            File.WriteAllText(Path.Combine(paths.Data,"pending-cart.json"),
                "{\"CustomerId\":null,\"Discount\":0,\"Items\":[]}");
            var legacy=await new JsonCartRecoveryStore(paths).LoadAsync();
            Assert.NotNull(legacy);
            Assert.NotEqual(Guid.Empty,legacy.Id);
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task DeleteCompletedSale_ReverseOnce_KeepAudit_AndHideFromNormalList()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-delete044-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var repo=new SqliteSaleRepository(f.Db,new SystemClock());
            var sale=await repo.CompleteAsync(CartFor(f.Product),new[]{new Payment(PaymentMethod.Cash,20,20)},f.Operator,f.Session);
            var advanced=new AdvancedOperationsService(f.Db);
            await advanced.DeleteSaleAsync(sale.Id,f.Operator,"ADMIN: TESTE | EXCLUSÃO: venda duplicada");
            Assert.Equal(20m,await Amount(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
            Assert.Equal(0m,await Amount(f.Db,"SELECT COALESCE(SUM(amount),0) FROM cash_movements"));
            Assert.Equal(1m,await Amount(f.Db,$"SELECT COUNT(*) FROM sales WHERE id='{sale.Id}' AND status='Deleted'"));
            Assert.Equal(1m,await Amount(f.Db,$"SELECT COUNT(*) FROM sale_events WHERE sale_id='{sale.Id}' AND event_type='Deleted'"));
            Assert.DoesNotContain(await advanced.SearchSalesAsync(),row=>row.Id==sale.Id);
            Assert.Contains(await advanced.SearchSalesAsync("","Excluídas"),row=>row.Id==sale.Id);
            await Assert.ThrowsAsync<DomainException>(()=>advanced.DeleteSaleAsync(sale.Id,f.Operator,"repetido"));
            await Assert.ThrowsAsync<DomainException>(()=>advanced.CancelSaleAsync(sale.Id,f.Operator,"repetido"));
            Assert.Equal(0m,await Amount(f.Db,"SELECT COALESCE(SUM(amount),0) FROM cash_movements"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task DeleteAlreadyCancelledSaleDoesNotReverseTheCashOrStockAgain()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-delete-cancelled044-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var repo=new SqliteSaleRepository(f.Db,new SystemClock());
            var sale=await repo.CompleteAsync(CartFor(f.Product),new[]{new Payment(PaymentMethod.Cash,20,20)},f.Operator,f.Session);
            var svc=new AdvancedOperationsService(f.Db);
            await svc.CancelSaleAsync(sale.Id,f.Operator,"Primeiro cancelamento");
            await svc.DeleteSaleAsync(sale.Id,f.Operator,"Ocultar da lista");
            Assert.Equal(20m,await Amount(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
            Assert.Equal(0m,await Amount(f.Db,"SELECT COALESCE(SUM(amount),0) FROM cash_movements"));
            Assert.Equal(1m,await Amount(f.Db,$"SELECT COUNT(*) FROM sale_events WHERE sale_id='{sale.Id}' AND event_type='Cancelled'"));
            Assert.Equal(1m,await Amount(f.Db,$"SELECT COUNT(*) FROM sale_events WHERE sale_id='{sale.Id}' AND event_type='Deleted'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task ChangingPaymentMethodThenDeletingReversesOnlyNetCash()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-method044-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var repo=new SqliteSaleRepository(f.Db,new SystemClock());
            var sale=await repo.CompleteAsync(CartFor(f.Product),new[]{new Payment(PaymentMethod.Cash,20,20)},f.Operator,f.Session);
            var svc=new AdvancedOperationsService(f.Db);
            await svc.ChangeSinglePaymentMethodAsync(sale.Id,PaymentMethod.Pix,f.Operator,"Corrigir PIX");
            Assert.Equal(20m,await Amount(f.Db,"SELECT COALESCE(SUM(amount),0) FROM cash_movements"));
            await svc.DeleteSaleAsync(sale.Id,f.Operator,"ADMIN: TESTE | EXCLUSÃO: duplicação");
            Assert.Equal(0m,await Amount(f.Db,"SELECT COALESCE(SUM(amount),0) FROM cash_movements"));
            Assert.Equal(20m,await Amount(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }

    [Fact]
    public async Task FiscalAuthorizedSaleCannotBeDeletedByAdministrativeShortcut()
    {
        var root=Path.Combine(Path.GetTempPath(),"onca-fiscal044-"+Guid.NewGuid().ToString("N"));
        try
        {
            var f=await Fixture(root);var repo=new SqliteSaleRepository(f.Db,new SystemClock());
            var sale=await repo.CompleteAsync(CartFor(f.Product),new[]{new Payment(PaymentMethod.Cash,20,20)},f.Operator,f.Session);
            await using(var c=f.Db.Open())await using(var q=c.CreateCommand())
            {
                q.CommandText="UPDATE sales SET fiscal_status='Authorized' WHERE id=$id";
                q.Parameters.AddWithValue("$id",sale.Id.ToString());
                await q.ExecuteNonQueryAsync();
            }
            await Assert.ThrowsAsync<DomainException>(()=>new AdvancedOperationsService(f.Db).DeleteSaleAsync(sale.Id,f.Operator,"Tentar"));
            Assert.Equal(1m,await Amount(f.Db,$"SELECT COUNT(*) FROM sales WHERE id='{sale.Id}' AND status='Completed'"));
            Assert.Equal(18m,await Amount(f.Db,$"SELECT stock FROM products WHERE id='{f.Product}'"));
        }
        finally{try{if(Directory.Exists(root))Directory.Delete(root,true);}catch{}}
    }
}
