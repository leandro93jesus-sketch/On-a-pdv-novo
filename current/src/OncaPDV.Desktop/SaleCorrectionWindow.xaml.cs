using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class SaleCorrectionWindow : Window
{
    private readonly Sale _sale;
    private readonly ObservableCollection<Row> _rows = [];
    public SaleCorrectionRequest? Request { get; private set; }

    public SaleCorrectionWindow(Sale sale, string? initialReason = null)
    {
        _sale = sale;
        InitializeComponent();
        ReasonBox.Text = initialReason ?? string.Empty;
        TitleText.Text = $"CORRIGIR VENDA Nº {sale.Number:000000}";
        PaymentText.Text = $"Pagamento original: {string.Join(" + ", sale.Payments.Select(x => $"{x.Method} {x.Amount:C}"))}";
        foreach (var item in sale.Items)
        {
            var row = new Row(item.ProductId, item.Code, item.Name, item.Quantity, item.UnitPrice);
            row.PropertyChanged += (_, _) => RefreshTotal();
            _rows.Add(row);
        }
        ItemsGrid.ItemsSource = _rows;
        DiscountBox.Text = sale.Discount.ToString("N2");
        Loaded += (_, _) => RefreshTotal();
    }

    private void RefreshTotal()
    {
        if (TotalText is null) return;
        var gross = _rows.Sum(x => x.Subtotal);
        var discount = TryMoney(DiscountBox?.Text ?? "", out var d) ? d : 0;
        TotalText.Text = Math.Max(0, gross - discount).ToString("C");
        if (_sale.Payments.Count > 1 && Math.Max(0, gross - discount) != _sale.Total)
            StatusText.Text = "Pagamento misto: para alterar o total, cancele e refaça a venda. Correção direta só mantém o mesmo total.";
        else if (StatusText.Text.StartsWith("Pagamento misto")) StatusText.Text = string.Empty;
    }

    private void ItemsGrid_CellEditEnding(object sender, DataGridCellEditEndingEventArgs e) =>
        Dispatcher.BeginInvoke(RefreshTotal, DispatcherPriority.Background);

    private void Discount_Changed(object sender, TextChangedEventArgs e) => RefreshTotal();

    private void Apply_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(ReasonBox.Text))
        {
            StatusText.Text = "Informe o motivo da correção.";
            return;
        }
        if (_rows.Any(x => x.Quantity <= 0 || x.UnitPrice < 0))
        {
            StatusText.Text = "Quantidade e preço precisam ser válidos.";
            return;
        }
        if (!TryMoney(DiscountBox.Text, out var discount))
        {
            StatusText.Text = "Desconto inválido.";
            return;
        }
        var gross = _rows.Sum(x => x.Subtotal);
        if (discount < 0 || discount > gross)
        {
            StatusText.Text = "Desconto não pode ser maior que o subtotal.";
            return;
        }

        Request = new(
            _rows.Select(x => new SaleCorrectionItem(x.ProductId, x.Code, x.Name, x.Quantity, x.UnitPrice)).ToArray(),
            discount,
            ReasonBox.Text.Trim());
        DialogResult = true;
    }

    private static bool TryMoney(string text, out decimal value)
    {
        if (decimal.TryParse(text, NumberStyles.Number | NumberStyles.AllowCurrencySymbol, CultureInfo.CurrentCulture, out value)) return true;
        return decimal.TryParse((text ?? "").Replace("R$", "", StringComparison.OrdinalIgnoreCase).Trim().Replace('.', ','),
            NumberStyles.Number, CultureInfo.GetCultureInfo("pt-BR"), out value);
    }

    public sealed class Row : INotifyPropertyChanged
    {
        private decimal _quantity;
        private decimal _unitPrice;
        public Guid ProductId { get; }
        public string Code { get; }
        public string Name { get; }
        public decimal Quantity { get => _quantity; set { _quantity = value; Changed(); Changed(nameof(Subtotal)); } }
        public decimal UnitPrice { get => _unitPrice; set { _unitPrice = value; Changed(); Changed(nameof(Subtotal)); } }
        public decimal Subtotal => decimal.Round(Quantity * UnitPrice, 2, MidpointRounding.AwayFromZero);
        public Row(Guid productId,string code,string name,decimal quantity,decimal unitPrice){ProductId=productId;Code=code;Name=name;_quantity=quantity;_unitPrice=unitPrice;}
        public event PropertyChangedEventHandler? PropertyChanged;
        private void Changed([CallerMemberName] string? name=null)=>PropertyChanged?.Invoke(this,new(name));
    }
}
