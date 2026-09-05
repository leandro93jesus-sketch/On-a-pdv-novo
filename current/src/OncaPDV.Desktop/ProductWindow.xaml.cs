using System.Globalization;
using System.Windows;
using Microsoft.Win32;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class ProductWindow : Window
{
    private readonly Product? _existing;
    public Product? Product { get; private set; }
    public ProductExtraProfile? Extra { get; private set; }

    public ProductWindow(string? barcode = null, Product? existing = null)
    {
        _existing = existing;
        InitializeComponent();

        if (existing is null)
        {
            Barcode.Text = barcode ?? "";
            if (barcode is not null) Code.Text = barcode;
        }
        else
        {
            Code.Text = existing.InternalCode;
            Barcode.Text = existing.Barcode ?? "";
            ProductName.Text = existing.Name;
            Description.Text = existing.Description ?? "";
            Category.Text = existing.Category ?? "";
            Brand.Text = existing.Brand ?? "";
            Unit.Text = existing.Unit;
            Stock.Text = existing.Stock.ToString("N3");
            Stock.IsReadOnly = true;
            MinimumStock.Text = existing.MinimumStock.ToString("N3");
            Cost.Text = existing.CostPrice.ToString("N2");
            Price.Text = existing.SalePrice.ToString("N2");
            Supplier.Text = existing.Supplier ?? "";
            PhotoPathBox.Text = existing.PhotoPath ?? "";
            Active.IsChecked = existing.Active;
            PromoPrice.Text = existing.PromotionalPrice?.ToString("N2") ?? "";
            PromoStart.SelectedDate = existing.PromotionStartsAt?.LocalDateTime.Date;
            PromoEnd.SelectedDate = existing.PromotionEndsAt?.LocalDateTime.Date;
            Title = "Editar produto — estoque protegido";
        }

        Loaded += async (_, _) =>
        {
            if (_existing is not null)
            {
                var extra = await new ProductMetadataStore(AppServices.Database).LoadAsync(_existing.Id);
                Location.Text = extra.Location ?? "";
                if (string.IsNullOrWhiteSpace(Supplier.Text)) Supplier.Text = extra.PreferredSupplier ?? "";
            }
            UpdateMargin();
        };
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(Code.Text) || string.IsNullOrWhiteSpace(ProductName.Text) || string.IsNullOrWhiteSpace(Unit.Text))
        {
            StatusText.Text = "Informe código interno, nome e unidade.";
            return;
        }

        if (!TryNumber(Cost.Text, out var cost) || !TryNumber(Price.Text, out var price) || !TryNumber(Stock.Text, out var stock) || !TryNumber(MinimumStock.Text, out var min))
        {
            StatusText.Text = "Custo, preço ou estoque inválido.";
            return;
        }

        decimal? promo = null;
        if (!string.IsNullOrWhiteSpace(PromoPrice.Text))
        {
            if (!TryNumber(PromoPrice.Text, out var parsedPromo) || parsedPromo < 0)
            {
                StatusText.Text = "Preço promocional inválido.";
                return;
            }
            promo = parsedPromo;
        }

        DateTimeOffset? start = PromoStart.SelectedDate is DateTime s ? new DateTimeOffset(s.Date) : null;
        DateTimeOffset? end = PromoEnd.SelectedDate is DateTime e ? new DateTimeOffset(e.Date.AddDays(1).AddTicks(-1)) : null;
        if (promo is not null && (start is null || end is null || end < start))
        {
            StatusText.Text = "Promoção exige data inicial e final válidas.";
            return;
        }

        Product = new(
            _existing?.Id ?? Guid.NewGuid(),
            Code.Text.Trim(),
            Null(Barcode.Text),
            ProductName.Text.Trim(),
            Null(Description.Text),
            Null(Category.Text),
            Null(Brand.Text),
            cost,
            price,
            _existing?.Stock ?? stock,
            min,
            Unit.Text.Trim(),
            Null(Supplier.Text),
            Null(PhotoPathBox.Text),
            Active.IsChecked == true,
            promo,
            start,
            end);

        Extra = new(Product.Id, Null(Location.Text), Null(Supplier.Text), null);
        DialogResult = true;
    }

    private void Photo_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Filter = "Imagens|*.png;*.jpg;*.jpeg;*.webp;*.bmp" };
        if (dialog.ShowDialog() == true) PhotoPathBox.Text = dialog.FileName;
    }

    private void Label_Click(object sender, RoutedEventArgs e)
    {
        var name = ProductName.Text.Trim();
        var barcode = Barcode.Text.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(barcode))
        {
            StatusText.Text = "Informe nome e código de barras para gerar a etiqueta.";
            return;
        }
        if (!TryNumber(Price.Text, out var price)) price = 0;
        new BarcodeLabelWindow(name, barcode, price) { Owner = this }.ShowDialog();
    }

    private void PriceChanged(object sender, System.Windows.Controls.TextChangedEventArgs e) => UpdateMargin();

    private void UpdateMargin()
    {
        if (MarginText is null) return;
        if (TryNumber(Cost.Text, out var cost) && TryNumber(Price.Text, out var price) && cost > 0)
            MarginText.Text = $"Margem: {((price - cost) / cost) * 100:N1}%";
        else MarginText.Text = "Margem: —";
    }

    private static bool TryNumber(string text, out decimal value)
    {
        if (decimal.TryParse(text, NumberStyles.Number, CultureInfo.CurrentCulture, out value)) return true;
        return decimal.TryParse((text ?? "").Replace('.', ','), NumberStyles.Number, CultureInfo.GetCultureInfo("pt-BR"), out value);
    }

    private static string? Null(string value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
