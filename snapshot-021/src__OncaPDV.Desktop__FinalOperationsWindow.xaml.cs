using System.Windows;
using OncaPDV.Infrastructure;
namespace OncaPDV.Desktop;
public partial class FinalOperationsWindow:Window
{
 public HeldSale? SelectedHold { get; private set; }
 private readonly FinalFeaturesService _svc; private readonly Guid _operator; private DateTimeOffset _from=DateTimeOffset.Now.Date,_to=DateTimeOffset.Now.Date.AddDays(1);
 public FinalOperationsWindow(OncaDatabase db,Guid op){InitializeComponent();_svc=new(db);_operator=op;Loaded+=async(_,_)=>{await LoadHolds();await LoadHistory();};}
 private async Task LoadHolds()=>HoldsGrid.ItemsSource=await _svc.HoldsAsync();
 private async void DeleteHold_Click(object s,RoutedEventArgs e){if(HoldsGrid.SelectedItem is not HeldSale h)return;if(MessageBox.Show($"Excluir a venda em espera {h.Label}?","ONÇA PDV",MessageBoxButton.YesNo)!=MessageBoxResult.Yes)return;await _svc.DeleteHoldAsync(h.Id);await LoadHolds();}
 private void RecoverHold_Click(object s,RoutedEventArgs e){if(HoldsGrid.SelectedItem is not HeldSale h){MessageBox.Show("Selecione uma venda em espera.");return;}SelectedHold=h;DialogResult=true;}
 private async Task LoadHistory(){HistoryGrid.ItemsSource=await _svc.HistoryAsync(_from,_to,SearchBox.Text);var s=await _svc.SummaryAsync(_from,_to);SummaryText.Text=$"Vendas: {s.Sales}   •   Faturamento: {s.Revenue:C}   •   Ticket médio: {s.AverageTicket:C}\nDinheiro: {s.Cash:C}   PIX: {s.Pix:C}   Débito: {s.Debit:C}   Crédito: {s.Credit:C}   Crediário: {s.StoreCredit:C}\nRecebimentos crediário: {s.CreditReceipts:C}   Despesas: {s.Expenses:C}   Devoluções: {s.Returns:C}";}
 private async void Expense_Click(object s,RoutedEventArgs e){try{if(!decimal.TryParse(ExpenseAmount.Text,out var v))throw new InvalidOperationException("VALOR INVÁLIDO");var x=await _svc.AddExpenseAsync(_operator,v,ExpenseDescription.Text);MessageBox.Show($"Despesa registrada: {x.Amount:C}\n{x.Description}");ExpenseAmount.Clear();ExpenseDescription.Clear();await LoadHistory();}catch(Exception ex){MessageBox.Show(ex.Message,"Despesa",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Return_Click(object s,RoutedEventArgs e){try{if(!Guid.TryParse(ReturnSale.Text,out var sale)||!Guid.TryParse(ReturnProduct.Text,out var product)||!decimal.TryParse(ReturnQty.Text,out var q))throw new InvalidOperationException("PREENCHA VENDA, PRODUTO E QUANTIDADE CORRETAMENTE");await _svc.ReturnItemAsync(sale,product,q,ReturnReason.Text,_operator);MessageBox.Show("DEVOLUÇÃO REGISTRADA. ESTOQUE E FINANCEIRO AJUSTADOS.");await LoadHistory();}catch(Exception ex){MessageBox.Show(ex.Message,"Devolução",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Exchange_Click(object s,RoutedEventArgs e){try{if(!Guid.TryParse(ExchangeSale.Text,out var sale)||!Guid.TryParse(ExchangeOld.Text,out var oldp)||!Guid.TryParse(ExchangeNew.Text,out var newp)||!decimal.TryParse(ExchangeOldQty.Text,out var oq)||!decimal.TryParse(ExchangeNewQty.Text,out var nq))throw new InvalidOperationException("PREENCHA OS DADOS DA TROCA CORRETAMENTE");await _svc.ExchangeItemAsync(sale,oldp,oq,newp,nq,ExchangeReason.Text,_operator);MessageBox.Show("TROCA REGISTRADA. ESTOQUE E DIFERENÇA FINANCEIRA AJUSTADOS.");await LoadHistory();}catch(Exception ex){MessageBox.Show(ex.Message,"Troca",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Today_Click(object s,RoutedEventArgs e){_from=DateTimeOffset.Now.Date;_to=_from.AddDays(1);await LoadHistory();}
 private async void Yesterday_Click(object s,RoutedEventArgs e){_to=DateTimeOffset.Now.Date;_from=_to.AddDays(-1);await LoadHistory();}
 private async void Month_Click(object s,RoutedEventArgs e){var n=DateTimeOffset.Now;_from=new DateTimeOffset(n.Year,n.Month,1,0,0,0,n.Offset);_to=_from.AddMonths(1);await LoadHistory();}
 private async void Filter_Click(object s,RoutedEventArgs e)=>await LoadHistory();
}
