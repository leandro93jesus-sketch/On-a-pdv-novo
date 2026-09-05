using System.Globalization;
using System.Windows;
using System.Windows.Media;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class StockControlWindow : Window
{
    private readonly OperationalService _ops;
    private readonly Guid _operator;
    private StockView _row;

    public StockControlWindow(OperationalService ops, StockView row, Guid operatorId)
    {
        _ops = ops;
        _row = row;
        _operator = operatorId;
        InitializeComponent();
        Loaded += async (_, _) => await RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        ProductText.Text = _row.Product;
        CodeText.Text = $"Código: {_row.Code}   •   Barras: {_row.Barcode ?? "—"}   •   {_row.Category ?? "Sem categoria"}";
        CurrentText.Text = $"{_row.Stock:N3} {_row.Unit}";
        MinimumText.Text = $"{_row.Minimum:N3} {_row.Unit}";
        CostText.Text = _row.Cost.ToString("C");
        PriceText.Text = _row.Price.ToString("C");
        StatusText.Text = _row.Status;
        StatusText.Foreground = _row.Status switch
        {
            "SEM ESTOQUE" => Brushes.DarkRed,
            "ESTOQUE BAIXO" => Brushes.DarkGoldenrod,
            _ => Brushes.DarkGreen
        };

        if (!QuantityInput.IsKeyboardFocusWithin)
            QuantityInput.Text = _row.Stock.ToString("N3");

        MovementsGrid.ItemsSource = await _ops.StockMovementsAsync(_row.Id);
    }

    private async void Apply_Click(object sender, RoutedEventArgs e)
    {
        if (!TryNumber(QuantityInput.Text, out var quantity) || quantity < 0)
        {
            MessageBox.Show("Informe uma quantidade física válida.", "Estoque", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (string.IsNullOrWhiteSpace(ReasonInput.Text))
        {
            MessageBox.Show("Informe o motivo do ajuste.", "Estoque", MessageBoxButton.OK, MessageBoxImage.Warning);
            ReasonInput.Focus();
            return;
        }

        var difference = quantity - _row.Stock;
        if (difference == 0)
        {
            MessageText.Text = "Nenhuma diferença encontrada na contagem.";
            return;
        }

        if (MessageBox.Show(
                $"Confirmar ajuste de estoque?\n\nProduto: {_row.Product}\nAtual: {_row.Stock:N3}\nNovo: {quantity:N3}\nDiferença: {difference:+0.###;-0.###;0}",
                "Confirmar ajuste",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;

        try
        {
            await _ops.AdjustStockAsync(_row.Id, quantity, _operator, ReasonInput.Text);
            _row = _row with
            {
                Stock = quantity,
                EstimatedCost = quantity * _row.Cost,
                EstimatedSale = quantity * _row.Price,
                Status = quantity <= 0 ? "SEM ESTOQUE" : quantity <= _row.Minimum ? "ESTOQUE BAIXO" : "OK"
            };
            ReasonInput.Clear();
            MessageText.Text = $"AJUSTE REGISTRADO • {difference:+0.###;-0.###;0} {_row.Unit} • histórico e auditoria salvos.";
            await RefreshAsync();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Ajuste de estoque", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private static bool TryNumber(string text, out decimal value)
    {
        if (decimal.TryParse(text, NumberStyles.Number, CultureInfo.CurrentCulture, out value)) return true;
        return decimal.TryParse((text ?? string.Empty).Replace('.', ','), NumberStyles.Number, CultureInfo.GetCultureInfo("pt-BR"), out value);
    }
}
