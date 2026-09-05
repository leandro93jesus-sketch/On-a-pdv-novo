using System.Globalization;
using System.Windows;

namespace OncaPDV.Desktop;

public partial class MoneyEntryWindow : Window
{
    public decimal Value { get; private set; }

    public MoneyEntryWindow(string title, string hint, decimal initial)
    {
        InitializeComponent();
        TitleText.Text = title;
        HintText.Text = hint;
        ValueBox.Text = initial.ToString("N2");
        Loaded += (_, _) => { ValueBox.Focus(); ValueBox.SelectAll(); };
    }

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        if (!TryMoney(ValueBox.Text, out var value) || value < 0)
        {
            StatusText.Text = "Informe um valor válido.";
            return;
        }
        Value = value;
        DialogResult = true;
    }

    private static bool TryMoney(string text, out decimal value)
    {
        if (decimal.TryParse(text, NumberStyles.Number | NumberStyles.AllowCurrencySymbol, CultureInfo.CurrentCulture, out value)) return true;
        return decimal.TryParse((text ?? string.Empty).Replace("R$", "", StringComparison.OrdinalIgnoreCase).Trim().Replace('.', ','),
            NumberStyles.Number, CultureInfo.GetCultureInfo("pt-BR"), out value);
    }
}
