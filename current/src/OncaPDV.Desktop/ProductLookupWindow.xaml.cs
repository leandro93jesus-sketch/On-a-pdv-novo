using System.Windows;
using System.Windows.Input;
using OncaPDV.Application;
using OncaPDV.Domain;

namespace OncaPDV.Desktop;

public partial class ProductLookupWindow : Window
{
    private readonly PosWorkflow _workflow;

    public ProductLookupWindow(PosWorkflow workflow, string? initial = null)
    {
        _workflow = workflow;
        InitializeComponent();
        SearchInput.Text = initial ?? string.Empty;
        Loaded += async (_, _) =>
        {
            SearchInput.Focus();
            SearchInput.SelectAll();
            if (!string.IsNullOrWhiteSpace(initial)) await SearchAsync();
        };
    }

    private async Task SearchAsync()
    {
        var term = SearchInput.Text.Trim();
        if (term.Length == 0)
        {
            ResultsGrid.ItemsSource = null;
            StatusText.Text = "Digite nome, código ou código de barras.";
            return;
        }

        var products = await _workflow.SearchAsync(term);
        var rows = products.Select(p => new LookupRow(
            p.InternalCode,
            p.Barcode,
            p.Name,
            p.CurrentPrice(DateTimeOffset.Now),
            p.Stock,
            p.Unit,
            p.Stock <= 0 ? "SEM ESTOQUE" : p.Stock <= p.MinimumStock ? "ESTOQUE BAIXO" : "OK")).ToArray();

        ResultsGrid.ItemsSource = rows;
        StatusText.Text = rows.Length == 0 ? "Nenhum produto encontrado." : $"{rows.Length} produto(s) encontrado(s). Nenhum item foi adicionado ao carrinho.";
    }

    private async void Search_Click(object sender, RoutedEventArgs e) => await SearchAsync();

    private async void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        await SearchAsync();
    }

    private sealed record LookupRow(string Code, string? Barcode, string Name, decimal Price, decimal Stock, string Unit, string Status);
}
