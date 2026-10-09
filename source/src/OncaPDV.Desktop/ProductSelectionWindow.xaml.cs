using System.Windows;
using OncaPDV.Domain;

namespace OncaPDV.Desktop;

public partial class ProductSelectionWindow : Window
{
    public Product? Selected { get; private set; }

    public ProductSelectionWindow(string query, IReadOnlyList<Product> products, bool priceLookup = false)
    {
        InitializeComponent();
        ProductsGrid.ItemsSource = products;
        if (products.Count > 0) ProductsGrid.SelectedIndex = 0;
        InfoText.Text = $"Busca: {query}  •  {products.Count} item(ns). Escolha o produto correto.";
        if (priceLookup)
        {
            Title = "Consultar preço";
            TitleText.Text = "SELECIONE O PRODUTO PARA CONSULTAR";
            ActionButton.Content = "CONSULTAR PREÇO";
        }
    }

    private void Select_Click(object sender, RoutedEventArgs e)
    {
        if (ProductsGrid.SelectedItem is not Product product) return;
        Selected = product;
        DialogResult = true;
    }
}