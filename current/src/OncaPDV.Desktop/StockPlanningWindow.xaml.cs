using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class StockPlanningWindow : Window
{
    private readonly OperationalService _ops;
    private IReadOnlyList<StockPlanningView> _rows = [];
    public StockPlanningWindow(OperationalService ops)
    {
        InitializeComponent(); _ops=ops; Loaded+=async(_,_)=>await LoadAsync();
    }
    private async Task LoadAsync()
    {
        _rows=await _ops.StockPlanningAsync();
        Grid.ItemsSource=_rows.Where(x=>x.Action!="OK").ToArray();
        BuyCountText.Text=_rows.Count(x=>x.Action=="COMPRAR").ToString();
        NoMovementCountText.Text=_rows.Count(x=>x.Action=="SEM GIRO").ToString();
        EstimatedCostText.Text=_rows.Where(x=>x.Action=="COMPRAR").Sum(x=>x.SuggestedBuy*x.AverageCost).ToString("C");
    }
    private async void Pdf_Click(object sender,RoutedEventArgs e)
    {
        var file=await _ops.StockPlanningPdfAsync(_rows);
        MessageBox.Show($"PDF gerado:\n\n{file}","Estoque",MessageBoxButton.OK,MessageBoxImage.Information);
    }
}
