using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using OncaPDV.Domain;

namespace OncaPDV.Desktop;

public partial class PaymentWindow : Window
{
    private readonly decimal _total;
    private readonly ObservableCollection<Row> _rows = [];
    private bool _syncingCash;
    public IReadOnlyList<Payment> Payments { get; private set; } = [];

    public PaymentWindow(decimal total, PaymentMethod initialMethod = PaymentMethod.Cash)
    {
        _total = total;
        InitializeComponent();
        TotalText.Text = total.ToString("C");
        Grid.ItemsSource = _rows;
        ((DataGridComboBoxColumn)Grid.Columns[0]).ItemsSource = Enum.GetValues<PaymentMethod>();

        var first = new Row { Method = initialMethod, Amount = total, Received = null };
        first.PropertyChanged += Changed;
        _rows.Add(first);
        Refresh();

        Loaded += (_, _) =>
        {
            if (initialMethod == PaymentMethod.Cash)
            {
                CashReceivedInput.Focus();
                CashReceivedInput.SelectAll();
            }
            else
            {
                Grid.Focus();
            }
        };
    }

    private void Add_Click(object sender, RoutedEventArgs e)
    {
        var remaining = Math.Max(0, _total - _rows.Sum(x => x.Amount));
        var method = Enum.GetValues<PaymentMethod>().FirstOrDefault(m => _rows.All(x => x.Method != m));
        var row = new Row { Method = method, Amount = remaining };
        row.PropertyChanged += Changed;
        _rows.Add(row);
        Refresh();
    }

    private void Remove_Click(object sender, RoutedEventArgs e)
    {
        if (Grid.SelectedItem is Row row && _rows.Count > 1)
        {
            row.PropertyChanged -= Changed;
            _rows.Remove(row);
        }
        Refresh();
    }

    private void Grid_CellEditEnding(object sender, DataGridCellEditEndingEventArgs e) =>
        Dispatcher.BeginInvoke(Refresh, DispatcherPriority.Background);

    private void Changed(object? sender, PropertyChangedEventArgs e) => Refresh();

    private void Refresh()
    {
        if (TotalText is null) return;

        var allocated = _rows.Sum(x => x.Amount);
        var cashRows = _rows.Where(x => x.Method == PaymentMethod.Cash).ToArray();
        var cashAllocated = cashRows.Sum(x => x.Amount);
        var cash = cashRows.FirstOrDefault();
        var received = cash?.Received ?? 0m;
        var change = cash is null ? 0m : Math.Max(0, received - cashAllocated);
        var duplicateMethods = _rows.GroupBy(x => x.Method).Any(g => g.Count() > 1);

        AllocatedText.Text = allocated.ToString("C");
        RemainingText.Text = (_total - allocated).ToString("C");
        ChangeText.Text = change.ToString("C");
        CashPanel.Opacity = cash is null ? 0.42 : 1;
        CashReceivedInput.IsEnabled = cash is not null;

        _syncingCash = true;
        try
        {
            var desired = cash?.Received is decimal value ? value.ToString("N2") : string.Empty;
            if (!CashReceivedInput.IsKeyboardFocusWithin && CashReceivedInput.Text != desired)
                CashReceivedInput.Text = desired;
        }
        finally
        {
            _syncingCash = false;
        }

        var validCash = cash is null || (cash.Received ?? 0) >= cashAllocated;
        ConfirmButton.IsEnabled = _rows.Count > 0 &&
                                  !duplicateMethods &&
                                  _rows.All(x => x.Amount > 0) &&
                                  validCash &&
                                  allocated == _total;

        PaymentHintText.Text = duplicateMethods
            ? "Use apenas uma linha para cada forma de pagamento."
            : cash is not null && cash.Received is null
                ? "DIGITE O VALOR RECEBIDO EM DINHEIRO acima."
                : cash is not null && !validCash
                    ? $"Valor recebido insuficiente. Faltam {(cashAllocated - received):C}."
                    : allocated != _total
                        ? $"Ajuste as formas: o total precisa fechar exatamente {_total:C}."
                        : "Pagamento pronto para confirmar.";
    }

    private void CashReceivedInput_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncingCash) return;
        var cash = _rows.FirstOrDefault(x => x.Method == PaymentMethod.Cash);
        if (cash is null) return;

        var text = CashReceivedInput.Text.Trim();
        if (text.Length == 0)
        {
            cash.Received = null;
            Refresh();
            return;
        }

        if (TryMoney(text, out var value))
            cash.Received = value;
        Refresh();
    }

    private void CashQuick_Click(object sender, RoutedEventArgs e)
    {
        var cash = _rows.FirstOrDefault(x => x.Method == PaymentMethod.Cash);
        if (cash is null) return;
        var cashAllocated = _rows.Where(x => x.Method == PaymentMethod.Cash).Sum(x => x.Amount);
        var tag = (sender as Button)?.Tag?.ToString();
        var value = string.Equals(tag, "EXACT", StringComparison.OrdinalIgnoreCase)
            ? cashAllocated
            : decimal.TryParse(tag, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed) ? parsed : cashAllocated;
        cash.Received = value;
        _syncingCash = true;
        CashReceivedInput.Text = value.ToString("N2");
        _syncingCash = false;
        CashReceivedInput.Focus();
        CashReceivedInput.SelectAll();
        Refresh();
    }

    private void CashReceivedInput_GotKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e) => CashReceivedInput.SelectAll();

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        Refresh();
        if (!ConfirmButton.IsEnabled) return;
        Payments = _rows.Select(x => new Payment(x.Method, x.Amount, x.Method == PaymentMethod.Cash ? x.Received : null)).ToArray();
        DialogResult = true;
    }

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && ConfirmButton.IsEnabled)
        {
            e.Handled = true;
            Confirm_Click(sender, e);
        }
    }

    private static bool TryMoney(string text, out decimal value)
    {
        if (decimal.TryParse(text, NumberStyles.Number | NumberStyles.AllowCurrencySymbol, CultureInfo.CurrentCulture, out value)) return true;
        var normalized = text.Replace("R$", string.Empty, StringComparison.OrdinalIgnoreCase).Trim().Replace('.', ',');
        return decimal.TryParse(normalized, NumberStyles.Number, CultureInfo.GetCultureInfo("pt-BR"), out value);
    }

    public sealed class Row : INotifyPropertyChanged
    {
        private PaymentMethod _method;
        private decimal _amount;
        private decimal? _received;
        public PaymentMethod Method { get => _method; set { _method = value; OnChanged(); } }
        public decimal Amount { get => _amount; set { _amount = value; OnChanged(); } }
        public decimal? Received { get => _received; set { _received = value; OnChanged(); } }
        public event PropertyChangedEventHandler? PropertyChanged;
        private void OnChanged([CallerMemberName] string? name = null) => PropertyChanged?.Invoke(this, new(name));
    }
}
