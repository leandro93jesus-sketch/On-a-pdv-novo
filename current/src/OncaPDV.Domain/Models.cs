namespace OncaPDV.Domain;

public enum PaymentMethod { Cash, Pix, Debit, Credit, StoreCredit }
public enum StockMovementType { Sale, Purchase, Return, Adjustment, Cancellation, Inventory }
public enum CashMovementType { Opening, Sale, Supply, Withdrawal, StoreCreditReceipt, Closing }
public enum FiscalStatus { NotRequested, Pending, Processing, Authorized, Rejected, Contingency, Cancelled }
public enum PrintJobStatus { Pending, Printing, Success, Failed }

public sealed record Product(
    Guid Id, string InternalCode, string? Barcode, string Name, string? Description,
    string? Category, string? Brand, decimal CostPrice, decimal SalePrice,
    decimal Stock, decimal MinimumStock, string Unit, string? Supplier,
    string? PhotoPath, bool Active, decimal? PromotionalPrice = null,
    DateTimeOffset? PromotionStartsAt = null, DateTimeOffset? PromotionEndsAt = null)
{
    public decimal CurrentPrice(DateTimeOffset now) => PromotionalPrice is not null &&
        PromotionStartsAt <= now && PromotionEndsAt >= now ? PromotionalPrice.Value : SalePrice;
}

public sealed record CartItem(Guid ProductId, string Code, string Name, decimal Quantity, decimal UnitPrice)
{
    public decimal Subtotal => decimal.Round(Quantity * UnitPrice, 2, MidpointRounding.AwayFromZero);
}

public sealed class Cart
{
    private readonly List<CartItem> _items = [];
    public Guid Id { get; init; } = Guid.NewGuid();
    public IReadOnlyList<CartItem> Items => _items;
    public Guid? CustomerId { get; set; }
    public decimal Discount { get; private set; }
    public decimal GrossTotal => _items.Sum(x => x.Subtotal);
    public decimal Total => Math.Max(0, GrossTotal - Discount);

    public void Add(Product product, decimal quantity = 1)
    {
        if (!product.Active) throw new DomainException("Produto inativo.");
        if (quantity <= 0) throw new DomainException("Quantidade deve ser positiva.");
        var existing = _items.FindIndex(x => x.ProductId == product.Id && x.UnitPrice == product.CurrentPrice(DateTimeOffset.Now));
        if (existing >= 0) _items[existing] = _items[existing] with { Quantity = _items[existing].Quantity + quantity };
        else _items.Add(new(product.Id, product.InternalCode, product.Name, quantity, product.CurrentPrice(DateTimeOffset.Now)));
    }

    public void ChangeQuantity(Guid productId, decimal quantity)
    {
        if (quantity <= 0) throw new DomainException("Quantidade deve ser positiva.");
        var index = _items.FindIndex(x => x.ProductId == productId);
        if (index < 0) throw new DomainException("Item não encontrado.");
        _items[index] = _items[index] with { Quantity = quantity };
    }

    public void Remove(Guid productId)
    {
        var index = _items.FindIndex(x => x.ProductId == productId);
        if (index < 0) throw new DomainException("Item não encontrado.");
        _items.RemoveAt(index);
        if (Discount > GrossTotal) Discount = GrossTotal;
    }

    public void SetDiscount(decimal discount)
    {
        if (discount < 0 || discount > GrossTotal) throw new DomainException("Desconto inválido.");
        Discount = discount;
    }
}

public sealed record Payment(PaymentMethod Method, decimal Amount, decimal? Received = null)
{
    public decimal Change => Method == PaymentMethod.Cash ? Math.Max(0, (Received ?? Amount) - Amount) : 0;
}

public sealed record Sale(Guid Id, long Number, DateTimeOffset CreatedAt, Guid OperatorId, Guid? CustomerId,
    IReadOnlyList<CartItem> Items, IReadOnlyList<Payment> Payments, decimal Discount, decimal Total,
    FiscalStatus FiscalStatus = FiscalStatus.NotRequested);

public sealed record Customer(Guid Id, string Name, string? TaxId, string? Phone, string? WhatsApp,
    string? Address, string? Notes, bool Active = true);
public sealed record CustomerProfile(Guid Id,string Name,string? Cpf,string? Cnpj,string? Phone,string? WhatsApp,string? Email,string? PostalCode,string? Address,string? Number,string? Complement,string? District,string? City,string? State,string? Notes,bool Active=true)
{ public string? TaxId=>!string.IsNullOrWhiteSpace(Cpf)?Cpf:Cnpj; }
public enum CreditStatus { Open, Partial, Paid, Overdue, Cancelled }
public sealed record CreditAccount(Guid Id,Guid CustomerId,Guid SaleId,decimal OriginalAmount,decimal Balance,DateTimeOffset CreatedAt,DateTimeOffset DueAt,CreditStatus Status,int Installments,string? Notes);
public sealed record CreditReceipt(Guid Id,Guid AccountId,decimal Amount,PaymentMethod Method,Guid OperatorId,DateTimeOffset CreatedAt,string? Notes);
public sealed record Supplier(Guid Id, string Name, string? TaxId, string? Phone, string? Notes, bool Active = true);
public sealed record PurchaseItem(Guid ProductId,string Code,string Name,decimal Quantity,decimal UnitCost){public decimal Subtotal=>decimal.Round(Quantity*UnitCost,2,MidpointRounding.AwayFromZero);}
public sealed record Purchase(Guid Id,long Number,Guid SupplierId,DateTimeOffset CreatedAt,IReadOnlyList<PurchaseItem> Items,decimal Total,string? DocumentNumber,string? Notes);
public sealed record CashSession(Guid Id, Guid OperatorId, DateTimeOffset OpenedAt, decimal OpeningAmount,
    DateTimeOffset? ClosedAt = null, decimal? InformedTotal = null);
public sealed record AuditEntry(Guid Id, Guid UserId, string Action, string Entity, string EntityId,
    string? BeforeJson, string? AfterJson, string Reason, DateTimeOffset CreatedAt);

public sealed class DomainException(string message) : Exception(message);
