using Microsoft.Data.Sqlite;
using OncaPDV.Application;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Tests;

public sealed class ProfessionalCheckout0230Tests
{
    [Theory]
    [InlineData("3*789123", "789123", "3")]
    [InlineData("2,5xABC", "ABC", "2.5")]
    [InlineData("ABC", "ABC", "1")]
    public void Scanner_command_accepts_quantity_prefix(string input,string expectedQuery,string expectedQuantity)
    {
        Assert.True(ScannerCommand0230.TryParse(input,out var query,out var quantity));
        Assert.Equal(expectedQuery,query);
        Assert.Equal(decimal.Parse(expectedQuantity,System.Globalization.CultureInfo.InvariantCulture),quantity);
    }

    [Fact]
    public void Checkout_guard_blocks_double_finalize_until_exit()
    {
        var guard=new CheckoutActionGuard0230();
        Assert.True(guard.TryEnter());
        Assert.False(guard.TryEnter());
        Assert.True(guard.IsBusy);
        guard.Exit();
        Assert.False(guard.IsBusy);
        Assert.True(guard.TryEnter());
    }

    [Fact]
    public void Stock_alert_warns_but_does_not_block_zero_or_low_stock()
    {
        var zero=Product("ZERO",stock:0,min:0);
        var low=Product("LOW",stock:5,min:2);
        Assert.Contains("SEM ESTOQUE",StockAlert0230.Evaluate(zero,1));
        Assert.Contains("venda permitida",StockAlert0230.Evaluate(zero,1));
        Assert.Contains("ESTOQUE BAIXO",StockAlert0230.Evaluate(low,4));
        Assert.Null(StockAlert0230.Evaluate(low,1));
    }

    [Fact]
    public async Task Smart_search_finds_product_with_small_typing_error()
    {
        using var e=new Env();
        var repo=new SqliteProductRepository(e.Db);
        var p=Product("AMA001",name:"AMACIANTE LAVANDA");
        await repo.SaveAsync(p);
        var found=await repo.SearchAsync("AMCIANTE");
        Assert.Contains(found,x=>x.Id==p.Id);
    }

    [Fact]
    public async Task Product_code_guard_reports_duplicate_code_and_barcode_but_allows_same_product()
    {
        using var e=new Env();
        var repo=new SqliteProductRepository(e.Db);
        var p=Product("DUP001",barcode:"7891112223334",name:"Produto original");
        await repo.SaveAsync(p);
        var guard=new ProductCodeGuard0230(e.Db);
        var byCode=await guard.FindConflictAsync("dup001",null);
        Assert.NotNull(byCode);
        Assert.Equal("Código interno",byCode!.Field);
        var byBarcode=await guard.FindConflictAsync("OUTRO","7891112223334");
        Assert.NotNull(byBarcode);
        Assert.Equal("Código de barras",byBarcode!.Field);
        Assert.Null(await guard.FindConflictAsync("DUP001","7891112223334",p.Id));
    }

    [Fact]
    public async Task Cash_pulse_sums_today_payment_methods_and_credit_receipts()
    {
        using var e=new Env();
        var products=new SqliteProductRepository(e.Db);
        var p=Product("PULSE001",stock:50,price:100);
        await products.SaveAsync(p);
        var operatorId=Guid.NewGuid();
        var session=await new SqliteCashSessionRepository(e.Db,new SystemClock()).GetOrOpenAsync(operatorId);
        var cart=new Cart();cart.Add(p);
        await new CheckoutService(new SqliteSaleRepository(e.Db,new SystemClock()),new JsonCartRecoveryStore(e.Paths))
            .CompleteAsync(cart,[new(PaymentMethod.Cash,40,50),new(PaymentMethod.Pix,60)],operatorId,session.Id);

        var customer=Customer();
        await new SqliteCustomerRepository(e.Db).SaveAsync(customer);
        var creditCart=new Cart{CustomerId=customer.Id};creditCart.Add(p);
        await new CheckoutService(new SqliteSaleRepository(e.Db,new SystemClock()),new JsonCartRecoveryStore(e.Paths))
            .CompleteAsync(creditCart,[new(PaymentMethod.StoreCredit,100)],operatorId,session.Id);
        var account=(await new SqliteCreditRepository(e.Db,new SystemClock()).ByCustomerAsync(customer.Id)).Single();
        await new SqliteCreditRepository(e.Db,new SystemClock()).ReceiveAsync(account.Id,25,PaymentMethod.Pix,operatorId,session.Id,null);

        var pulse=await new CheckoutInsights0230(e.Db,e.Paths).TodayAsync();
        Assert.Equal(2,pulse.Sales);
        Assert.Equal(40,pulse.Cash);
        Assert.Equal(60,pulse.Pix);
        Assert.Equal(100,pulse.StoreCredit);
        Assert.Equal(25,pulse.CreditReceipts);
    }

    [Fact]
    public async Task Customer_pulse_shows_purchase_credit_balance_and_receipts()
    {
        using var e=new Env();
        var customer=Customer();
        await new SqliteCustomerRepository(e.Db).SaveAsync(customer);
        var p=Product("CLIENT001",stock:30,price:80);
        await new SqliteProductRepository(e.Db).SaveAsync(p);
        var operatorId=Guid.NewGuid();
        var session=await new SqliteCashSessionRepository(e.Db,new SystemClock()).GetOrOpenAsync(operatorId);
        var cart=new Cart{CustomerId=customer.Id};cart.Add(p);
        await new CheckoutService(new SqliteSaleRepository(e.Db,new SystemClock()),new JsonCartRecoveryStore(e.Paths))
            .CompleteAsync(cart,[new(PaymentMethod.StoreCredit,80)],operatorId,session.Id);
        var creditRepo=new SqliteCreditRepository(e.Db,new SystemClock());
        var account=(await creditRepo.ByCustomerAsync(customer.Id)).Single();
        await creditRepo.ReceiveAsync(account.Id,30,PaymentMethod.Cash,operatorId,session.Id,null);

        var pulse=await new CheckoutInsights0230(e.Db,e.Paths).CustomerAsync(customer.Id);
        Assert.NotNull(pulse);
        Assert.Equal(customer.Name,pulse!.Name);
        Assert.Equal(1,pulse.Purchases);
        Assert.Equal(80,pulse.Spent);
        Assert.Equal(50,pulse.CreditBalance);
        Assert.Equal(1,pulse.OpenCredits);
        Assert.Equal(30,pulse.CreditPaid);
        Assert.NotNull(pulse.LastPurchase);
    }

    [Fact]
    public void Health_indicator_reports_backup_attention_then_ok()
    {
        using var e=new Env();
        var insights=new CheckoutInsights0230(e.Db,e.Paths);
        Assert.Contains("ATENÇÃO",insights.HealthText());
        Directory.CreateDirectory(e.Paths.Backups);
        File.WriteAllText(Path.Combine(e.Paths.Backups,"backup-test.zip"),"ok");
        Assert.Equal("SISTEMA OK",insights.HealthText());
    }

    private static Product Product(string code,string? barcode=null,string? name=null,decimal stock=10,decimal min=0,decimal price=10)
        =>new(Guid.NewGuid(),code,barcode,name??code,null,null,null,1,price,stock,min,"UN",null,null,true);

    private static CustomerProfile Customer()=>new(Guid.NewGuid(),"Cliente Teste",null,null,"11999999999",null,null,null,null,null,null,null,null,null,null,true);

    private sealed class Env:IDisposable
    {
        public string Root{get;}=Path.Combine(Path.GetTempPath(),"onca-0230-"+Guid.NewGuid());
        public AppPaths Paths{get;}
        public OncaDatabase Db{get;}
        public Env(){Paths=new(Root,Path.Combine(Root,"data"),Path.Combine(Root,"backups"),Path.Combine(Root,"logs"),Path.Combine(Root,"exports"),Path.Combine(Root,"print"));Db=new(Paths);Db.Migrate();}
        public void Dispose(){SqliteConnection.ClearAllPools();if(Directory.Exists(Root))Directory.Delete(Root,true);}
    }
}
