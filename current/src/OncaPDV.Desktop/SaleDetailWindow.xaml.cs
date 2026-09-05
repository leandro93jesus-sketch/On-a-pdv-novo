using System.Windows;
using OncaPDV.Domain;

namespace OncaPDV.Desktop;

public partial class SaleDetailWindow : Window
{
    public SaleDetailWindow(Sale sale, string customer)
    {
        InitializeComponent();
        TitleText.Text = $"Venda Nº {sale.Number:000000}";
        SubtitleText.Text = $"{sale.CreatedAt.ToLocalTime():dd/MM/yyyy HH:mm:ss} • Operador {sale.OperatorId.ToString("N")[..8].ToUpperInvariant()}";
        CustomerText.Text = customer;
        ItemsCountText.Text = sale.Items.Sum(x => x.Quantity).ToString("N2");
        DiscountText.Text = sale.Discount.ToString("C");
        TotalText.Text = sale.Total.ToString("C");

        var cash = sale.Payments.Where(x => x.Method == PaymentMethod.Cash).ToArray();
        ReceivedText.Text = cash.Length == 0 ? "—" : cash.Sum(x => x.Received ?? x.Amount).ToString("C");
        ChangeText.Text = cash.Length == 0 ? "—" : cash.Sum(x => x.Change).ToString("C");

        ItemsGrid.ItemsSource = sale.Items;
        PaymentsGrid.ItemsSource = sale.Payments.Select(x => new PaymentRow(
            MethodLabel(x.Method),
            x.Amount,
            x.Method == PaymentMethod.Cash ? x.Received : null,
            x.Change)).ToArray();
    }

    private static string MethodLabel(PaymentMethod method) => method switch
    {
        PaymentMethod.Cash => "Dinheiro",
        PaymentMethod.Pix => "PIX",
        PaymentMethod.Debit => "Débito",
        PaymentMethod.Credit => "Crédito",
        PaymentMethod.StoreCredit => "Crediário",
        _ => method.ToString()
    };

    private sealed record PaymentRow(string Method, decimal Amount, decimal? Received, decimal Change);
}
