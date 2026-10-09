using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using OncaPDV.Domain;
namespace OncaPDV.Desktop;
public partial class PaymentWindow:Window
{
 private readonly decimal _total;private readonly ObservableCollection<Row> _rows=[];public IReadOnlyList<Payment> Payments{get;private set;}=[];
 public PaymentWindow(decimal total,PaymentMethod initialMethod=PaymentMethod.Cash){_total=total;InitializeComponent();TotalText.Text=total.ToString("C");Grid.ItemsSource=_rows;((DataGridComboBoxColumn)Grid.Columns[0]).ItemsSource=Enum.GetValues<PaymentMethod>();_rows.Add(new(){Method=initialMethod,Amount=total,Received=initialMethod==PaymentMethod.Cash?total:null});foreach(var r in _rows)r.PropertyChanged+=Changed;Refresh();}
 private void Add_Click(object s,RoutedEventArgs e){var r=new Row{Method=PaymentMethod.Pix};r.PropertyChanged+=Changed;_rows.Add(r);Refresh();}
 private void Remove_Click(object s,RoutedEventArgs e){if(Grid.SelectedItem is Row r&&_rows.Count>1)_rows.Remove(r);Refresh();}
 private void Grid_CellEditEnding(object s,DataGridCellEditEndingEventArgs e)=>Dispatcher.BeginInvoke(Refresh,DispatcherPriority.Background);
 private void Changed(object? s,PropertyChangedEventArgs e)=>Refresh();
 private void Refresh(){if(TotalText is null)return;var allocated=_rows.Sum(x=>x.Amount);var received=_rows.Where(x=>x.Method==PaymentMethod.Cash).Sum(x=>x.Received??x.Amount);var cashAllocated=_rows.Where(x=>x.Method==PaymentMethod.Cash).Sum(x=>x.Amount);var change=Math.Max(0,received-cashAllocated);AllocatedText.Text=allocated.ToString("C");RemainingText.Text=(_total-allocated).ToString("C");CashReceivedText.Text=received.ToString("C");ChangeText.Text=change.ToString("C");ConfirmButton.IsEnabled=_rows.Count>0&&_rows.All(x=>x.Amount>0&&(x.Method!=PaymentMethod.Cash||(x.Received??0)>=x.Amount))&&allocated==_total;}
 private void Confirm_Click(object s,RoutedEventArgs e){Refresh();if(!ConfirmButton.IsEnabled)return;Payments=_rows.Select(x=>new Payment(x.Method,x.Amount,x.Method==PaymentMethod.Cash?x.Received:null)).ToArray();DialogResult=true;}
 public sealed class Row:INotifyPropertyChanged{private PaymentMethod _method;private decimal _amount;private decimal? _received;public PaymentMethod Method{get=>_method;set{_method=value;OnChanged();}}public decimal Amount{get=>_amount;set{_amount=value;OnChanged();}}public decimal? Received{get=>_received;set{_received=value;OnChanged();}}public event PropertyChangedEventHandler? PropertyChanged;private void OnChanged([CallerMemberName]string? n=null)=>PropertyChanged?.Invoke(this,new(n));}
}
