using OncaPDV.Domain;

namespace OncaPDV.Application;

public interface IProductRepository
{
    Task<Product?> FindAsync(string codeOrName, CancellationToken ct = default);
    Task<IReadOnlyList<Product>> SearchAsync(string term, CancellationToken ct = default);
    Task SaveAsync(Product product, CancellationToken ct = default);
}

public interface ICartRecoveryStore
{
    Task SaveAsync(Cart cart, CancellationToken ct = default);
    Task<Cart?> LoadAsync(CancellationToken ct = default);
    Task ClearAsync(CancellationToken ct = default);
}

public interface ISaleRepository
{
    Task<Sale> CompleteAsync(Cart cart, IReadOnlyList<Payment> payments, Guid operatorId, Guid cashSessionId, CancellationToken ct = default);
    Task<IReadOnlyList<Sale>> LastAsync(int count, CancellationToken ct = default);
    Task<Sale?> GetAsync(Guid id, CancellationToken ct = default);
}

public interface ICashSessionRepository
{
    Task<CashSession> GetOrOpenAsync(Guid operatorId, decimal openingAmount = 0, CancellationToken ct = default);
}
public interface ICustomerRepository
{
    Task SaveAsync(CustomerProfile customer,CancellationToken ct=default);
    Task<IReadOnlyList<CustomerProfile>> SearchAsync(string term,bool includeInactive=false,CancellationToken ct=default);
    Task<CustomerProfile?> GetAsync(Guid id,CancellationToken ct=default);
}
public interface ICreditRepository
{
    Task<IReadOnlyList<CreditAccount>> ByCustomerAsync(Guid customerId,CancellationToken ct=default);
    Task<CreditReceipt> ReceiveAsync(Guid accountId,decimal amount,PaymentMethod method,Guid operatorId,Guid cashSessionId,string? notes,CancellationToken ct=default);
}
public sealed class DuplicateCustomerException(string message):Exception(message);
public sealed class CustomerService(ICustomerRepository repository)
{
 public Task<IReadOnlyList<CustomerProfile>> SearchAsync(string term,bool includeInactive=false,CancellationToken ct=default)=>repository.SearchAsync(term,includeInactive,ct);
 public async Task SaveAsync(CustomerProfile customer,CancellationToken ct=default){if(string.IsNullOrWhiteSpace(customer.Name))throw new DomainException("Informe o nome.");if(!BrazilianTaxId.IsValid(customer.Cpf)||!BrazilianTaxId.IsValid(customer.Cnpj))throw new DomainException("CPF/CNPJ inválido.");await repository.SaveAsync(customer,ct);}
}

public sealed class DuplicateProductException(string message) : Exception(message);

public interface IClock { DateTimeOffset Now { get; } }
public sealed class SystemClock : IClock { public DateTimeOffset Now => DateTimeOffset.Now; }

public sealed class ScannerDuplicateGuard(IClock clock, TimeSpan? interval = null)
{
    private readonly TimeSpan _interval = interval ?? TimeSpan.FromMilliseconds(450);
    private string? _lastCode;
    private DateTimeOffset _lastRead;

    public bool Accept(string code)
    {
        code = code.Trim();
        if (code.Length == 0) return false;
        var now = clock.Now;
        if (string.Equals(_lastCode, code, StringComparison.OrdinalIgnoreCase) && now - _lastRead < _interval) return false;
        _lastCode = code;
        _lastRead = now;
        return true;
    }
}

public sealed class CheckoutService(ISaleRepository sales, ICartRecoveryStore recovery)
{
    public async Task<Sale> CompleteAsync(Cart cart, IReadOnlyList<Payment> payments, Guid operatorId, Guid cashSessionId, CancellationToken ct = default)
    {
        if (cart.Items.Count == 0) throw new DomainException("Carrinho vazio.");
        if (payments.Count == 0) throw new DomainException("Informe o pagamento.");
        if (payments.Any(x => x.Amount <= 0)) throw new DomainException("Pagamento inválido.");
        if (payments.Sum(x => x.Amount) != cart.Total) throw new DomainException("A soma dos pagamentos deve ser igual ao total.");
        if (payments.Any(x => x.Method == PaymentMethod.StoreCredit) && cart.CustomerId is null)
            throw new DomainException("Crediário exige cliente.");

        var sale = await sales.CompleteAsync(cart, payments, operatorId, cashSessionId, ct);
        await recovery.ClearAsync(ct);
        return sale;
    }
}

public enum ScanStatus { Added, NotFound, DuplicateBlocked }
public sealed record ScanResult(ScanStatus Status, Product? Product = null);

public sealed class PosWorkflow(
    IProductRepository products,
    ICartRecoveryStore recovery,
    ISaleRepository sales,
    ICashSessionRepository cashSessions,
    IClock clock)
{
    private readonly ScannerDuplicateGuard _scanner = new(clock);
    public Cart Cart { get; private set; } = new();

    public async Task<bool> InitializeAsync(CancellationToken ct = default)
    {
        var restored = await recovery.LoadAsync(ct);
        if (restored is null || restored.Items.Count == 0) return false;
        Cart = restored;
        return true;
    }

    public Task<IReadOnlyList<Product>> SearchAsync(string term, CancellationToken ct = default) => products.SearchAsync(term, ct);

    public async Task<ScanResult> ScanAsync(string query, CancellationToken ct = default)
    {
        if (!_scanner.Accept(query)) return new(ScanStatus.DuplicateBlocked);
        var product = await products.FindAsync(query.Trim(), ct);
        if (product is null) return new(ScanStatus.NotFound);
        Cart.Add(product);
        await recovery.SaveAsync(Cart, ct);
        return new(ScanStatus.Added, product);
    }

    public async Task AddProductAsync(Product product, bool addToCart, CancellationToken ct = default)
    {
        ValidateProduct(product);
        await products.SaveAsync(product, ct);
        if (addToCart)
        {
            Cart.Add(product);
            await recovery.SaveAsync(Cart, ct);
        }
    }

    public async Task ChangeQuantityAsync(Guid productId, decimal quantity, CancellationToken ct = default)
    {
        Cart.ChangeQuantity(productId, quantity);
        await recovery.SaveAsync(Cart, ct);
    }

    public async Task RemoveItemAsync(Guid productId, CancellationToken ct = default)
    {
        Cart.Remove(productId);
        await recovery.SaveAsync(Cart, ct);
    }

    public async Task SetDiscountAsync(decimal discount, CancellationToken ct = default)
    {
        Cart.SetDiscount(discount);
        await recovery.SaveAsync(Cart, ct);
    }

    public async Task PersistAsync(CancellationToken ct = default) => await recovery.SaveAsync(Cart, ct);

    public async Task<Sale> CompleteAsync(IReadOnlyList<Payment> payments, Guid operatorId, CancellationToken ct = default)
    {
        var session = await cashSessions.GetOrOpenAsync(operatorId, 0, ct);
        var completed = await new CheckoutService(sales, recovery).CompleteAsync(Cart, payments, operatorId, session.Id, ct);
        Cart = new();
        return completed;
    }

    public async Task CancelAsync(CancellationToken ct = default)
    {
        Cart = new();
        await recovery.ClearAsync(ct);
    }

    public Task<IReadOnlyList<Sale>> LastSalesAsync(int count = 5, CancellationToken ct = default) => sales.LastAsync(count, ct);
    public Task<Sale?> GetSaleAsync(Guid id, CancellationToken ct = default) => sales.GetAsync(id, ct);
    public async Task SelectCustomerAsync(Guid? customerId,CancellationToken ct=default){Cart.CustomerId=customerId;await recovery.SaveAsync(Cart,ct);}

    private static void ValidateProduct(Product product)
    {
        if (string.IsNullOrWhiteSpace(product.InternalCode)) throw new DomainException("Informe o código interno.");
        if (string.IsNullOrWhiteSpace(product.Name)) throw new DomainException("Informe o nome.");
        if (string.IsNullOrWhiteSpace(product.Unit)) throw new DomainException("Informe a unidade.");
        if (product.CostPrice < 0 || product.SalePrice < 0 || product.Stock < 0) throw new DomainException("Valores não podem ser negativos.");
    }
}
