using System.Windows;
using OncaPDV.Infrastructure;
namespace OncaPDV.Desktop;
public partial class IntegrityCenter151Window:Window
{
    private readonly IntegrityCenter151 _service;private bool _loading;
    public IntegrityCenter151Window(OncaDatabase db,AppPaths paths){InitializeComponent();_service=new(db,paths);Loaded+=async(_,_)=>await LoadReport();}
    private async Task LoadReport()
    {
        if(_loading)return;_loading=true;try
        {
            SummaryText.Text="Verificando banco, vendas, caixa, crediário, duplicidades e backups...";
            var r=await _service.RunAsync();ChecksGrid.ItemsSource=r.Checks;DuplicatesGrid.ItemsSource=r.Duplicates;CreditsGrid.ItemsSource=r.Credits;
            SummaryText.Text=$"STATUS GERAL: {r.Overall}   •   Banco: {r.DatabaseIntegrity}   •   Vendas: {r.Sales}   •   Produtos: {r.Products}   •   Clientes: {r.Customers}\nCrediários: {r.CreditAccounts} (ativos {r.ActiveCreditAccounts})   •   Caixas abertos: {r.OpenCashSessions}   •   Backups: {r.Backups}   •   Duplicidades: {r.Duplicates.Count}";
        }
        catch(Exception ex){SummaryText.Text="Falha ao executar diagnóstico: "+ex.Message;MessageBox.Show(ex.Message,"Centro de Integridade",MessageBoxButton.OK,MessageBoxImage.Warning);}
        finally{_loading=false;}
    }
    private async void Refresh_Click(object sender,RoutedEventArgs e)=>await LoadReport();
    private async void Export_Click(object sender,RoutedEventArgs e){try{MessageBox.Show($"Relatório exportado em:\n{await _service.ExportAsync()}","Centro de Integridade");}catch(Exception ex){MessageBox.Show(ex.Message,"Exportação",MessageBoxButton.OK,MessageBoxImage.Warning);}}
}
