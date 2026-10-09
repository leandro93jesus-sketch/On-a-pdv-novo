using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class OperationsWindow:Window
{
 private readonly OperationalService _ops;private readonly AdvancedOperationsService _advanced;private readonly AppPaths _paths;private readonly Guid _operator;private DateTimeOffset _from=DateTimeOffset.Now.Date,_to=DateTimeOffset.Now.Date.AddDays(1);private SalesSummary? _summary;
 public OperationsWindow(OncaDatabase db,AppPaths paths,Guid op){_ops=new(db,paths);_advanced=new(db);_paths=paths;_operator=op;InitializeComponent();Loaded+=async(_,_)=>{await LoadSales();await LoadStock();await LoadTodaySummary();await LoadCashHistory();LoadBackups();};}
 private async Task LoadSales(){_summary=await _ops.SalesSummaryAsync(_from,_to);SalesSummaryText.Text=$"Quantidade: {_summary.Quantity}\nBruto: {_summary.Gross:C}   Descontos: {_summary.Discounts:C}   Líquido: {_summary.Net:C}\nDinheiro: {_summary.Cash:C}   PIX: {_summary.Pix:C}   Débito: {_summary.Debit:C}   Crédito: {_summary.Credit:C}   Crediário: {_summary.StoreCredit:C}\nRecebimentos de crediário (separados): {_summary.CreditReceipts:C}";}
 private async Task LoadStock()=>StockGrid.ItemsSource=await _ops.StockAsync(BelowMinimum.IsChecked==true);
 private async void Today_Click(object s,RoutedEventArgs e){_from=DateTimeOffset.Now.Date;_to=_from.AddDays(1);await LoadSales();}
 private async void Yesterday_Click(object s,RoutedEventArgs e){_to=DateTimeOffset.Now.Date;_from=_to.AddDays(-1);await LoadSales();}
 private async void Month_Click(object s,RoutedEventArgs e){var n=DateTimeOffset.Now;_from=new(n.Year,n.Month,1,0,0,0,n.Offset);_to=_from.AddMonths(1);await LoadSales();}
 private async void Period_Click(object s,RoutedEventArgs e){if(From.SelectedDate is DateTime f&&To.SelectedDate is DateTime t){_from=f;_to=t.AddDays(1);await LoadSales();}}
 private async void StockFilter(object s,RoutedEventArgs e){if(IsLoaded)await LoadStock();}
 private async void ReportPdf_Click(object s,RoutedEventArgs e){if(_summary is null)return;MessageBox.Show($"PDF gerado:\n{await _ops.SalesReportPdfAsync(_summary,_from,_to)}");}
 private async void Close_Click(object s,RoutedEventArgs e){if(!decimal.TryParse(Informed.Text,out var v)){MessageBox.Show("Valor informado inválido.");return;}var x=await _ops.CloseCashAsync(_operator,v);var pdf=await _ops.ClosingPdfAsync(x);var backup=await _ops.CreateBackupAsync();ClosingText.Text=$"Esperado: {x.Expected:C}\nInformado: {x.Informed:C}\nDiferença: {x.Difference:C}\nPDF: {pdf}\nBackup: {backup}";LoadBackups();}
 private async void Backup_Click(object s,RoutedEventArgs e){try{BackupStatus.Text=$"Backup válido: {await _ops.CreateBackupAsync()}";LoadBackups();}catch(Exception ex){BackupStatus.Text=ex.Message;}}
 private void LegacyImport_Click(object s,RoutedEventArgs e)=>new LegacyImportWindow(_ops,_paths){Owner=this}.ShowDialog();
 private async void Restore_Click(object s,RoutedEventArgs e){if(Backups.SelectedItem is not string file)return;if(MessageBox.Show("Validar e restaurar este backup? Um backup de segurança será criado.","Restauração",MessageBoxButton.YesNo)!=MessageBoxResult.Yes)return;try{await _ops.RestoreAsync(file);BackupStatus.Text="RESTAURAÇÃO CONCLUÍDA — migrations e integrity_check OK";}catch(Exception ex){BackupStatus.Text=$"RESTAURAÇÃO CANCELADA — banco atual restaurado. {ex.Message}";}}
 private async Task LoadTodaySummary(){var f=DateTimeOffset.Now.Date;var x=await _ops.SalesSummaryAsync(f,f.AddDays(1));TodaySummary.Text=$"Vendas: {x.Quantity}\nFaturamento: {x.Net:C}\nTicket médio: {(x.Quantity==0?0:x.Net/x.Quantity):C}\nDinheiro: {x.Cash:C}   PIX: {x.Pix:C}   Débito: {x.Debit:C}   Crédito: {x.Credit:C}\nCrediário vendido: {x.StoreCredit:C}   Recebimentos de crediário: {x.CreditReceipts:C}";}
 private async Task LoadCashHistory()=>CashHistoryGrid.ItemsSource=await _advanced.CashHistoryAsync();
 private async void TodaySummary_Click(object s,RoutedEventArgs e)=>await LoadTodaySummary();
 private async void CashHistory_Click(object s,RoutedEventArgs e)=>await LoadCashHistory();
 private async void Reopen_Click(object s,RoutedEventArgs e){try{var reason=ReopenReason.Text.Trim();if(string.IsNullOrWhiteSpace(reason)){MessageBox.Show("Informe o motivo para reabrir o caixa.");return;}if(MessageBox.Show("Reabrir o último caixa fechado? Esta ação ficará registrada.","Caixa",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;var id=await _advanced.ReopenLastCashAsync(_operator,reason);ReopenReason.Clear();await LoadCashHistory();MessageBox.Show($"Caixa {id.ToString()[..8]} reaberto com auditoria.");}catch(Exception ex){MessageBox.Show(ex.Message,"Caixa",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private void LoadBackups(){_paths.EnsureCreated();Backups.ItemsSource=Directory.GetFiles(_paths.Backups,"*.zip").OrderByDescending(File.GetCreationTimeUtc).ToArray();}
}
