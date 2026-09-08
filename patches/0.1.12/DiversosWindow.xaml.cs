using System.Globalization;
using System.Windows;
using System.Windows.Input;

namespace OncaPDV.Desktop;

public partial class DiversosWindow : Window
{
    public decimal Price { get; private set; }
    public string? Description => string.IsNullOrWhiteSpace(DescriptionBox.Text) ? null : DescriptionBox.Text.Trim();

    public DiversosWindow()
    {
        InitializeComponent();
        Loaded += (_, _) => PriceBox.Focus();
    }

    private void Add_Click(object sender, RoutedEventArgs e) => Confirm();
    private void PriceBox_KeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) Confirm(); }

    private void Confirm()
    {
        var text = PriceBox.Text.Trim().Replace("R$", "", StringComparison.OrdinalIgnoreCase).Trim();
        var ok = decimal.TryParse(text, NumberStyles.Number, CultureInfo.CurrentCulture, out var value) ||
                 decimal.TryParse(text.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out value);
        if (!ok || value <= 0)
        {
            MessageBox.Show("Informe um preço válido maior que zero.", "DIVERSOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            PriceBox.SelectAll();
            PriceBox.Focus();
            return;
        }
        Price = value;
        DialogResult = true;
    }
}