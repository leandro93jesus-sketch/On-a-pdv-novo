using System.Globalization;
using System.Windows;
using System.Windows.Media;
using OncaPDV.Infrastructure;
using OncaPDV.Printing;

namespace OncaPDV.Desktop;

public partial class StockControlWindow : Window
{
    private const string TerminalId="CAIXA-01";
    private readonly OperationalService _ops;
    private readonly Guid _operator;
    private StockView _row;

    public StockControlWindow(OperationalService ops, StockView row, Guid operatorId)
    {
        _ops = ops;_row = row;_operator = operatorId;InitializeComponent();Loaded += async (_, _) => await RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        ProductText.Text = _row.Product;CodeText.Text = $"Código: {_row.Code}   •   Barras: {_row.Barcode ?? "—"}   •   {_row.Category ?? "Sem categoria"}";CurrentText.Text = $"{_row.Stock:N3} {_row.Unit}";MinimumText.Text = $"{_row.Minimum:N3} {_row.Unit}";CostText.Text = _row.Cost.ToString("C");PriceText.Text = _row.Price.ToString("C");StatusText.Text = _row.Status;StatusText.Foreground = _row.Status switch{"SEM ESTOQUE"=>Brushes.DarkRed,"ESTOQUE BAIXO"=>Brushes.DarkGoldenrod,_=>Brushes.DarkGreen};if (!QuantityInput.IsKeyboardFocusWithin)QuantityInput.Text = _row.Stock.ToString("N3");MovementsGrid.ItemsSource = await _ops.StockMovementsAsync(_row.Id);
    }

    private async void Apply_Click(object sender, RoutedEventArgs e)
    {
        var access=new AccessControlStore(AppServices.Paths);var user=await access.ActiveUserAsync();if(!AccessControlStore.HasPermission(user.Role,UserRole.Stockkeeper)){var auth=new AdminPinWindow(AppServices.Paths,"Ajustar estoque exige autorização de administrador ou perfil Estoquista."){Owner=this};if(auth.ShowDialog()!=true||!auth.Authorized)return;}
        if (!TryNumber(QuantityInput.Text, out var quantity) || quantity < 0){MessageBox.Show("Informe uma quantidade física válida.", "Estoque", MessageBoxButton.OK, MessageBoxImage.Warning);return;}
        if (string.IsNullOrWhiteSpace(ReasonInput.Text)){MessageBox.Show("Informe o motivo do ajuste.", "Estoque", MessageBoxButton.OK, MessageBoxImage.Warning);ReasonInput.Focus();return;}
        var difference = quantity - _row.Stock;if (difference == 0){MessageText.Text = "Nenhuma diferença encontrada na contagem.";return;}
        if (MessageBox.Show($"Confirmar ajuste de estoque?\n\nProduto: {_row.Product}\nAtual: {_row.Stock:N3}\nNovo: {quantity:N3}\nDiferença: {difference:+0.###;-0.###;0}","Confirmar ajuste",MessageBoxButton.YesNo,MessageBoxImage.Question) != MessageBoxResult.Yes)return;
        try{await _ops.AdjustStockAsync(_row.Id, quantity, user.Id, ReasonInput.Text);_row = _row with{Stock=quantity,EstimatedCost=quantity*_row.Cost,EstimatedSale=quantity*_row.Price,Status=quantity<=0?"SEM ESTOQUE":quantity<=_row.Minimum?"ESTOQUE BAIXO":"OK"};ReasonInput.Clear();MessageText.Text = $"AJUSTE REGISTRADO • {difference:+0.###;-0.###;0} {_row.Unit} • histórico e auditoria salvos.";await RefreshAsync();}catch(Exception ex){MessageBox.Show(ex.Message,"Ajuste de estoque",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

    private async void Label_Click(object sender,RoutedEventArgs e)
    {
        var profile=await new TerminalPrinterProfileStore(AppServices.Paths).LoadAsync(TerminalId);if(profile is null){MessageBox.Show("Configure a impressora antes de imprimir etiquetas.");return;}var result=new ProductLabelPrinter().Print(new ProductLabel(_row.Product,_row.Code,_row.Barcode,_row.Price,profile.CutEnabled),profile);MessageText.Text=result.Success?"Etiqueta enviada para a impressora.":result.Error??"Falha ao imprimir etiqueta.";
    }

    private static bool TryNumber(string text, out decimal value){if(decimal.TryParse(text,NumberStyles.Number,CultureInfo.CurrentCulture,out value))return true;return decimal.TryParse((text??string.Empty).Replace('.',','),NumberStyles.Number,CultureInfo.GetCultureInfo("pt-BR"),out value);}
}
