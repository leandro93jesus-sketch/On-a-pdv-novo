using System.Windows;
using System.Windows.Input;
using OncaPDV.Application;
using OncaPDV.Domain;

namespace OncaPDV.Desktop;

public partial class QuickPriceScannerWindow : Window
{
    private readonly PosWorkflow _workflow;
    public Product? SelectedProduct { get; private set; }
    public QuickPriceScannerWindow(PosWorkflow workflow)
    {
        _workflow=workflow;
        InitializeComponent();
        Loaded+=(_,_)=>{QueryBox.Focus();QueryBox.SelectAll();};
    }
    private async Task SearchAsync()
    {
        var query=QueryBox.Text.Trim();
        if(query.Length==0){QueryBox.Focus();return;}
        var matches=(await _workflow.SearchAsync(query)).Where(x=>x.Active).ToArray();
        Product? selected=matches.FirstOrDefault(x=>string.Equals(x.InternalCode,query,StringComparison.OrdinalIgnoreCase)||string.Equals(x.Barcode,query,StringComparison.OrdinalIgnoreCase));
        if(selected is null&&matches.Length==1)selected=matches[0];
        if(selected is null&&matches.Length>1)
        {
            var picker=new ProductSelectionWindow("Escolha o produto para consultar",matches){Owner=this};
            if(picker.ShowDialog()!=true||picker.Selected is null)return;
            selected=picker.Selected;
        }
        if(selected is null)
        {
            SelectedProduct=null;AddButton.IsEnabled=false;NameText.Text="Produto não encontrado";CodeText.Text="Confira o código ou tente parte do nome.";PriceText.Text="—";StockText.Text="";QueryBox.SelectAll();QueryBox.Focus();return;
        }
        SelectedProduct=selected;AddButton.IsEnabled=true;
        NameText.Text=selected.Name;CodeText.Text=$"Código: {selected.InternalCode}   •   Barras: {selected.Barcode ?? "—"}";
        PriceText.Text=selected.CurrentPrice(DateTimeOffset.Now).ToString("C");
        StockText.Text=$"ATIVO • {(selected.CurrentPrice(DateTimeOffset.Now)!=selected.SalePrice ? $"Promoção • preço normal {selected.SalePrice:C}" : "Preço normal")}\nEstoque: {selected.Stock:N3} {selected.Unit}   •   Mínimo: {selected.MinimumStock:N3}";
        QueryBox.SelectAll();QueryBox.Focus();
    }
    private async void Search_Click(object sender,RoutedEventArgs e)=>await SearchAsync();
    private async void Query_KeyDown(object sender,KeyEventArgs e){if(e.Key==Key.Enter){e.Handled=true;await SearchAsync();}}
    private void Add_Click(object sender,RoutedEventArgs e){if(SelectedProduct is not null)DialogResult=true;}
    private void Close_Click(object sender,RoutedEventArgs e)=>DialogResult=false;
    private void Window_KeyDown(object sender,KeyEventArgs e){if(e.Key==Key.Escape)DialogResult=false;}
}
