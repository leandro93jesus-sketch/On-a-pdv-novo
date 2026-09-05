using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;
using OncaPDV.Printing;

namespace OncaPDV.Desktop;

public partial class SaleManagementWindow:Window
{
    private const string TerminalId="CAIXA-01";
    private readonly OncaDatabase _db;private readonly AppPaths _paths;private readonly Guid _operator;private readonly OperationalService _ops;private readonly AdvancedOperationsService _advanced;
    public bool CorrectionPrepared{get;private set;}

    public SaleManagementWindow(OncaDatabase db,AppPaths paths,Guid operatorId)
    {
        _db=db;_paths=paths;_operator=operatorId;_ops=new(db,paths);_advanced=new(db,paths);_advanced.EnsureSchema();InitializeComponent();From.SelectedDate=DateTime.Today.AddDays(-30);To.SelectedDate=DateTime.Today;Loaded+=async(_,_)=>await LoadAsync();
    }

    private SalesHistoryView? Selected()=>Grid.SelectedItem as SalesHistoryView;
    private async Task LoadAsync()
    {
        var from=new DateTimeOffset((From.SelectedDate??DateTime.Today).Date);var to=new DateTimeOffset((To.SelectedDate??DateTime.Today).Date.AddDays(1));var pay=(Payment.SelectedItem as ComboBoxItem)?.Tag?.ToString()??"Todos";var status=(Status.SelectedItem as ComboBoxItem)?.Tag?.ToString()??"Concluidas";var rows=await _ops.SalesHistoryAsync(from,to,Search.Text,pay,status);Grid.ItemsSource=rows;Info.Text=$"{rows.Count} venda(s) • total exibido {rows.Sum(x=>x.Total):C} • canceladas aparecem em vermelho.";
    }
    private async void Refresh_Click(object sender,RoutedEventArgs e)=>await LoadAsync();
    private async void Search_KeyDown(object sender,KeyEventArgs e){if(e.Key==Key.Enter){e.Handled=true;await LoadAsync();}}
    private async void Grid_DoubleClick(object sender,MouseButtonEventArgs e){if(Selected() is not null)await ShowDetailsAsync();}

    private async Task<Sale?> SaleAsync(){var row=Selected();if(row is null){MessageBox.Show("Selecione uma venda.","Histórico",MessageBoxButton.OK,MessageBoxImage.Information);return null;}return await _ops.SaleAsync(row.Id);}
    private async Task ShowDetailsAsync(){var row=Selected();var sale=await SaleAsync();if(row is null||sale is null)return;new SaleDetailWindow(sale,row.Customer){Owner=this}.ShowDialog();}
    private async void Details_Click(object sender,RoutedEventArgs e)=>await ShowDetailsAsync();
    private async void Pdf_Click(object sender,RoutedEventArgs e){var sale=await SaleAsync();if(sale is null)return;var file=await _ops.SalePdfAsync(sale,true);MessageBox.Show($"PDF gerado:\n{file}","Venda",MessageBoxButton.OK,MessageBoxImage.Information);}
    private async void Reprint_Click(object sender,RoutedEventArgs e)
    {
        var row=Selected();var sale=await SaleAsync();if(row is null||sale is null)return;if(row.Status=="CANCELADA"){MessageBox.Show("Venda cancelada não pode ser reimpressa como comprovante válido.");return;}var result=await PrintSaleAsync(sale,row.Customer);MessageBox.Show(result.Success?"Comprovante enviado com sucesso.":result.Error??"Falha de impressão.","Reimpressão",MessageBoxButton.OK,result.Success?MessageBoxImage.Information:MessageBoxImage.Warning);
    }

    private async void Cancel_Click(object sender,RoutedEventArgs e)
    {
        var row=Selected();if(row is null)return;if(row.Status=="CANCELADA"){MessageBox.Show("Esta venda já está cancelada.");return;}if(!Authorize("Cancelar venda concluída. O estoque e os movimentos financeiros serão estornados e a ação ficará auditada."))return;var reason=AskReason("Motivo do cancelamento");if(reason is null)return;
        try{await _advanced.CancelSaleAsync(row.Id,_operator,reason);await LoadAsync();MessageBox.Show("Venda cancelada com estorno de estoque e caixa. Registro de auditoria criado.","Cancelamento",MessageBoxButton.OK,MessageBoxImage.Information);}
        catch(Exception ex){MessageBox.Show(ex.Message,"Cancelamento",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

    private async void Correct_Click(object sender,RoutedEventArgs e)
    {
        var row=Selected();if(row is null)return;if(row.Status=="CANCELADA"){MessageBox.Show("Selecione uma venda concluída para corrigir.");return;}if(!Authorize("Corrigir venda concluída. A venda original será cancelada de forma auditada e os itens voltarão ao carrinho para uma nova venda."))return;var reason=AskReason("Motivo da correção");if(reason is null)return;
        try{await _advanced.PrepareCorrectionAsync(row.Id,_operator,reason);CorrectionPrepared=true;MessageBox.Show("Venda original cancelada e itens preparados para correção. Ao voltar para Vendas, o carrinho será recuperado.","Correção",MessageBoxButton.OK,MessageBoxImage.Information);DialogResult=true;}
        catch(Exception ex){MessageBox.Show(ex.Message,"Correção",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

    private bool Authorize(string reason){var w=new AdminPinWindow(_paths,reason){Owner=this};return w.ShowDialog()==true&&w.Authorized;}
    private string? AskReason(string title){var w=new ReasonPromptWindow(title){Owner=this};return w.ShowDialog()==true?w.Reason:null;}

    private async Task<PrintResult> PrintSaleAsync(Sale sale,string? customer)
    {
        var profile=await new TerminalPrinterProfileStore(_paths).LoadAsync(TerminalId);var company=await new CompanyReceiptProfileStore(_paths).LoadAsync();var cp=profile?.Encoding switch{"CP858"=>858,"CP860"=>860,_=>850};IReceiptRenderer renderer=profile?.PaperWidthMm==58?new EscPos58Renderer(new CodePagePrinterEncoding(cp)):new EscPos80Renderer(new CodePagePrinterEncoding(cp));var doc=new ReceiptDocument(sale,company.FantasyName,CustomerName:customer=="CONSUMIDOR"?null:customer,OpenDrawer:false,Cut:profile?.CutEnabled==true,IsReprint:true,Company:new ReceiptCompany(company.FantasyName,company.LegalName,company.Cnpj,company.StateRegistration,company.Phone,company.AddressLine1,company.AddressLine2,company.FooterMessage));
        if(profile?.PhysicalPrintingEnabled==true&&!string.IsNullOrWhiteSpace(profile.PrinterName))return await new QueuedPrintService(new WindowsRawPrintService(renderer,_paths.Logs,true),_db).PrintAsync(doc,profile.PrinterName);return await new QueuedPrintService(new MockPrintService(renderer,_paths.PrintPreview),_db).PrintAsync(doc);
    }
}

public sealed class ReasonPromptWindow:Window
{
    private readonly TextBox _box=new(){MinHeight=75,TextWrapping=TextWrapping.Wrap,AcceptsReturn=true,FontSize=15,Padding=new Thickness(8)};public string Reason{get;private set;}="";
    public ReasonPromptWindow(string title)
    {
        Title=title;Width=470;Height=300;WindowStartupLocation=WindowStartupLocation.CenterOwner;ResizeMode=ResizeMode.NoResize;var grid=new Grid{Margin=new Thickness(20)};grid.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});grid.RowDefinitions.Add(new RowDefinition{Height=new GridLength(1,GridUnitType.Star)});grid.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});var t=new TextBlock{Text=title.ToUpperInvariant(),FontSize=21,FontWeight=FontWeights.Bold,Foreground=System.Windows.Media.Brushes.DarkGreen};grid.Children.Add(t);Grid.SetRow(_box,1);_box.Margin=new Thickness(0,14,0,14);grid.Children.Add(_box);var p=new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right};var cancel=new Button{Content="CANCELAR",IsCancel=true,Padding=new Thickness(12,8),Margin=new Thickness(4)};var ok=new Button{Content="CONFIRMAR",Padding=new Thickness(12,8),Margin=new Thickness(4),Background=System.Windows.Media.Brushes.DarkGreen,Foreground=System.Windows.Media.Brushes.White};ok.Click+=(_,_)=>{if(string.IsNullOrWhiteSpace(_box.Text)){MessageBox.Show("Informe o motivo.");return;}Reason=_box.Text.Trim();DialogResult=true;};p.Children.Add(cancel);p.Children.Add(ok);Grid.SetRow(p,2);grid.Children.Add(p);Content=grid;Loaded+=(_,_)=>_box.Focus();
    }
}
