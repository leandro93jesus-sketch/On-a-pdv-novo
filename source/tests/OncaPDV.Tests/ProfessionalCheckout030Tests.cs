using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using OncaPDV.Application;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Tests;

public sealed class ProfessionalCheckout030Tests
{
    [Fact]
    public async Task Operator_journey_hold_second_sale_recover_credit_finance_and_close()
    {
        using var e=new Env();
        var customer=new CustomerProfile(Guid.NewGuid(),"Cliente de teste",null,null,"11999999999",null,null,null,null,null,null,null,null,null,null,true);
        await new SqliteCustomerRepository(e.Db).SaveAsync(customer);
        var p=await e.Product("BLUE","789","Amaciante Blue 5L");
        var session=await new SqliteCashSessionRepository(e.Db,new SystemClock()).GetOrOpenAsync(e.Operator);
        await e.Workflow.AddExistingProductAsync(p,3);
        await e.Workflow.AddDiversosAsync("Embalagem",1,5);
        await e.Workflow.SelectCustomerAsync(customer.Id);
        var holds=new FinalFeaturesService(e.Db);
        await holds.HoldAsync("Cliente aguardando",e.Workflow.Cart.CustomerId,e.Workflow.Cart.Items.ToArray(),0);
        await e.Workflow.CancelAsync();
        await e.Workflow.AddExistingProductAsync(p);
        await e.Workflow.CompleteAsync([new(PaymentMethod.Pix,10)],e.Operator);
        var held=Assert.Single(await holds.HoldsAsync());
        var restored=new Cart{CustomerId=held.CustomerId};
        foreach(var item in held.Items)restored.AddCustom(item.ProductId,item.Code,item.Name,item.Quantity,item.UnitPrice);
        await e.Workflow.ReplaceCartAsync(restored);await holds.DeleteHoldAsync(held.Id);
        var sale=await e.Workflow.CompleteAsync([new(PaymentMethod.StoreCredit,35)],e.Operator);
        Assert.Equal(35,sale.Total);Assert.Empty(await holds.HoldsAsync());Assert.Empty(e.Workflow.Cart.Items);
        var credit=new SqliteCreditRepository(e.Db,new SystemClock());
        var account=Assert.Single(await credit.ByCustomerAsync(customer.Id));
        var ops=new OperationalService(e.Db,e.Paths);
        await credit.ReceiveAsync(account.Id,15,PaymentMethod.Cash,e.Operator,session.Id,"parcial");
        Assert.Equal(20,Assert.Single(await ops.CreditsAsync("Todos",customer.Id)).Balance);
        await credit.ReceiveAsync(account.Id,20,PaymentMethod.Cash,e.Operator,session.Id,"quitação");
        Assert.Empty(await ops.CreditsAsync("Todos",customer.Id));
        Assert.Single(await ops.CreditsAsync("Paid",customer.Id));
        var finance=new Finance052(e.Db);
        await finance.AddExpenseAsync("Outros","Despesa de teste",5,"PIX",DateTimeOffset.Now,null,null,null,e.Operator,Guid.NewGuid());
        Assert.Equal(5,(await finance.SummaryAsync()).ExpensesThisMonth);
        var closing=await ops.CloseCashAsync(e.Operator,35);
        Assert.Equal(0,closing.Difference);Assert.Equal("ok",e.Db.IntegrityCheck());
        Assert.Equal(2,(await e.Workflow.LastSalesAsync()).Count);
    }

    [Fact]
    public async Task Cash_movement_summary_reads_real_today_rows()
    {
        using var e=new Env();
        var session=await new SqliteCashSessionRepository(e.Db,new SystemClock()).GetOrOpenAsync(e.Operator);
        using var c=e.Db.Open();using var q=c.CreateCommand();
        q.CommandText="INSERT INTO cash_movements VALUES($a,$s,'Supply',100,NULL,'TESTE',$at),($b,$s,'Withdrawal',25,NULL,'TESTE',$at)";
        q.Parameters.AddWithValue("$a",Guid.NewGuid().ToString());q.Parameters.AddWithValue("$b",Guid.NewGuid().ToString());q.Parameters.AddWithValue("$s",session.Id.ToString());q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.ExecuteNonQuery();
        var result=await new CashMovements030(e.Db).TodayAsync();
        Assert.Equal(100,result.Supplies);Assert.Equal(25,result.Withdrawals);
    }

    [Theory]
    [InlineData("789123", 1)]
    [InlineData("3*789123", 3)]
    [InlineData("3x789123", 3)]
    public async Task Scanner_quantity_reaches_saved_sale_even_with_zero_stock(string input, int quantity)
    {
        using var e = new Env();
        var p = await e.Product("P", "789123", "Amaciante Blue 5L");
        Assert.True(ScannerCommand0230.TryParse(input, out var code, out var qty));
        var found = await e.Products.FindAsync(code);
        Assert.NotNull(found);
        await e.Workflow.AddExistingProductAsync(found!, qty);
        var sale = await e.Workflow.CompleteAsync([new(PaymentMethod.Cash, quantity * 10, quantity * 10)], e.Operator);
        Assert.Equal(quantity, sale.Items.Single().Quantity);
        Assert.Equal(-quantity, (await e.Products.FindAsync("789123"))!.Stock);
        Assert.Equal("ok", e.Db.IntegrityCheck());
    }

    [Theory]
    [InlineData("amac blue")]
    [InlineData("amciant blue")]
    public async Task Multiword_search_finds_abbreviation_and_typo(string query)
    {
        using var e = new Env();
        var p = await e.Product("AMA", "789", "Amaciante Blue 5L");
        Assert.Contains(await e.Products.SearchAsync(query), x => x.Id == p.Id);
    }

    [Fact]
    public async Task Barcode_wins_over_another_products_internal_code()
    {
        using var e = new Env();
        await e.Product("789", "111", "Código interno");
        var barcode = await e.Product("P2", "789", "Código de barras");
        Assert.Equal(barcode.Id, (await e.Products.SearchAsync("789"))[0].Id);
        Assert.Equal(barcode.Id, (await e.Products.FindAsync("789"))!.Id);
    }

    [Fact]
    public async Task Unknown_scan_does_not_mutate_cart()
    {
        using var e = new Env();
        Assert.Equal(ScanStatus.NotFound, (await e.Workflow.ScanAsync("9999999999999")).Status);
        Assert.Empty(e.Workflow.Cart.Items);
    }

    [Fact]
    public async Task Consumer_default_customer_selection_and_clear_persist()
    {
        using var e = new Env();
        Assert.Null(e.Workflow.Cart.CustomerId);
        var id = Guid.NewGuid();
        await e.Workflow.SelectCustomerAsync(id);
        Assert.Equal(id, (await e.Recovery.LoadAsync())!.CustomerId);
        await e.Workflow.SelectCustomerAsync(null);
        Assert.Null((await e.Recovery.LoadAsync())!.CustomerId);
    }

    [Fact]
    public async Task Committed_cart_is_not_recovered_after_crash_before_cleanup()
    {
        using var e = new Env();
        var p = await e.Product("P", "789", "Produto");
        await e.Workflow.AddExistingProductAsync(p);
        var cart = e.Workflow.Cart;
        var session = await new SqliteCashSessionRepository(e.Db, new SystemClock()).GetOrOpenAsync(e.Operator);
        await new SqliteSaleRepository(e.Db, new SystemClock()).CompleteAsync(cart, [new(PaymentMethod.Pix, 10)], e.Operator, session.Id);
        // Simulate crash: no ClearAsync and no UI tab cleanup after commit.
        Assert.Null(await new JsonCartRecoveryStore(e.Paths).LoadAsync());
        Assert.Single(await new SqliteSaleRepository(e.Db, new SystemClock()).LastAsync(10));
    }

    [Fact]
    public async Task Recovery_preserves_distinct_diversos_lines_and_identity()
    {
        using var e = new Env();
        await e.Workflow.AddDiversosAsync("Serviço A", 2, 10);
        await e.Workflow.AddDiversosAsync("Serviço B", 1, 10);
        var recovered = await e.Recovery.LoadAsync();
        Assert.Equal(e.Workflow.Cart.Id, recovered!.Id);
        Assert.Equal(2, recovered.Items.Count);
        Assert.Equal("Serviço B", recovered.Items[1].Name);
    }

    [Fact]
    public async Task Only_committed_tab_is_cleared_after_crash()
    {
        using var e = new Env();
        var p = await e.Product("P", "789", "Produto");
        await e.Workflow.AddExistingProductAsync(p);
        var paidId = e.Workflow.Cart.Id;
        var otherId = Guid.NewGuid();
        var tabs = new MultiSaleRecovery040(e.Db, "isolated");
        tabs.Save(new(1, 3, [new(1, "A", "CONSUMIDOR", null, null, 0, [new(p.Id,p.InternalCode,p.Name,1,10)],paidId),
            new(2, "B", "CONSUMIDOR", null, null, 0, [new(p.Id,p.InternalCode,p.Name,3,10)],otherId)]));
        await e.Workflow.CompleteAsync([new(PaymentMethod.Pix,10)],e.Operator);
        var recovered=tabs.Load()!;
        Assert.Empty(recovered.Tabs[0].Items);
        Assert.NotEqual(paidId,recovered.Tabs[0].CartId);
        Assert.Equal(otherId,recovered.Tabs[1].CartId);
        Assert.Equal(3,recovered.Tabs[1].Items.Single().Quantity);
    }

    [Fact]
    public void Concurrent_finalize_events_allow_exactly_one_entry()
    {
        var guard = new CheckoutActionGuard0230();
        var accepted = 0;
        Parallel.For(0, 64, _ => { if (guard.TryEnter()) Interlocked.Increment(ref accepted); });
        Assert.Equal(1, accepted);
        guard.Exit(); Assert.True(guard.TryEnter());
    }

    [Fact]
    public async Task Repeated_checkout_identity_does_not_duplicate_negative_stock_sale()
    {
        using var e = new Env();
        var p = await e.Product("P", "789", "Produto");
        var cart = new Cart(); cart.Add(p,3);
        var session=await new SqliteCashSessionRepository(e.Db,new SystemClock()).GetOrOpenAsync(e.Operator);
        var repo=new SqliteSaleRepository(e.Db,new SystemClock());
        var a=await repo.CompleteAsync(cart,[new(PaymentMethod.Pix,30)],e.Operator,session.Id);
        var b=await repo.CompleteAsync(cart,[new(PaymentMethod.Pix,30)],e.Operator,session.Id);
        Assert.Equal(a.Id,b.Id); Assert.Single(await repo.LastAsync(10));
        Assert.Equal(-3,(await e.Products.FindAsync("789"))!.Stock);
    }

    [Fact]
    public void Frozen_print_and_payment_files_are_byte_identical_to_official_023()
    {
        var root=SourceRoot();
        var hashes=JsonSerializer.Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(root,"tests","printing-baseline.json")))!;
        Assert.Equal(10,hashes.Count);
        foreach(var (file,hash) in hashes)
            Assert.Equal(hash,Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(root,file)))).ToLowerInvariant());
    }

    [Fact]
    public void Print_confirmation_calls_preview_reprint_and_pdf_match_official_023()
    {
        var root=SourceRoot();
        var source=File.ReadAllText(Path.Combine(root,"src/OncaPDV.Desktop/MainWindow.xaml.cs")).Replace("\r\n","\n");
        var blocks=JsonSerializer.Deserialize<string[]>(File.ReadAllText(Path.Combine(root,"tests/printing-flow-baseline.json")))!;
        foreach(var block in blocks) Assert.Contains(block,source);
    }
    private static string SourceRoot()
    {
        for(var d=new DirectoryInfo(AppContext.BaseDirectory);d is not null;d=d.Parent)
            if(File.Exists(Path.Combine(d.FullName,"OncaPDV.slnx")))return d.FullName;
        throw new InvalidOperationException("Execute no código-fonte completo para verificar impressão congelada.");
    }
    private sealed class Env : IDisposable
    {
        public readonly AppPaths Paths;
        public readonly OncaDatabase Db;
        public readonly SqliteProductRepository Products;
        public readonly PosWorkflow Workflow;
        public readonly JsonCartRecoveryStore Recovery;
        public readonly Guid Operator=Guid.NewGuid();
        public Env()
        {
            var root=Path.Combine(Path.GetTempPath(),"onca-030-test-"+Guid.NewGuid());
            Paths=new(root,Path.Combine(root,"data"),Path.Combine(root,"backups"),Path.Combine(root,"logs"),Path.Combine(root,"exports"),Path.Combine(root,"print"));
            Db=new(Paths);Db.Migrate();Products=new(Db);Recovery=new(Paths);
            Workflow=new(Products,Recovery,new SqliteSaleRepository(Db,new SystemClock()),new SqliteCashSessionRepository(Db,new SystemClock()),new SystemClock());
        }
        public async Task<Product> Product(string code,string barcode,string name)
        {
            var p=new Product(Guid.NewGuid(),code,barcode,name,null,null,null,1,10,0,2,"UN",null,null,true);
            await Products.SaveAsync(p);return p;
        }
        public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(Paths.Root,true);}
    }
}
