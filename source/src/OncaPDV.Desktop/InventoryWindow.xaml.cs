using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.VisualBasic;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;
public partial class InventoryWindow:Window
{
    private readonly InventoryService026 _svc; private Product? Selected=>Grid.SelectedItem as Product;
    public InventoryWindow(OncaDatabase db){_svc=new(db);InitializeComponent();Loaded+=async(_,_)=>await Refresh();}
    private async Task Refresh(){Grid.ItemsSource=await _svc.SearchAsync(SearchBox.Text.Trim());}
    private async void Search_Click(object s,RoutedEventArgs e)=>await Refresh();
    private async void SearchBox_KeyDown(object s,KeyEventArgs e){if(e.Key==Key.Enter){e.Handled=true;await Refresh();}}
    private async void Grid_SelectionChanged(object s,SelectionChangedEventArgs e){if(Selected is not Product p){SelectedText.Text="Selecione um produto.";HistoryGrid.ItemsSource=null;return;}SelectedText.Text=$"{p.Name}  •  Estoque atual: {p.Stock:N0} {p.Unit}";HistoryGrid.ItemsSource=await _svc.HistoryAsync(p.Id);}
    private async void NewProduct_Click(object s,RoutedEventArgs e){var w=new ProductWindow(null){Owner=this};if(w.ShowDialog()!=true||w.Product is null)return;try{await _svc.SaveProductAsync(w.Product);SearchBox.Text="";await Refresh();MessageBox.Show("Produto cadastrado.","ESTOQUE");}catch(Exception ex){MessageBox.Show(ex.Message,"ESTOQUE",MessageBoxButton.OK,MessageBoxImage.Warning);}}
    private async void Edit_Click(object s,RoutedEventArgs e){var p=Need();if(p is null)return;var w=new ProductWindow(null,p){Owner=this};if(w.ShowDialog()!=true||w.Product is null)return;try{await _svc.SaveProductAsync(w.Product);await Refresh();MessageBox.Show("Produto atualizado. O estoque não foi alterado.","Produtos / Estoque");}catch(Exception ex){MessageBox.Show(ex.Message,"Produtos / Estoque",MessageBoxButton.OK,MessageBoxImage.Warning);}}
    private async void Entry_Click(object s,RoutedEventArgs e){var p=Need();if(p is null)return;await Move(p,true);}
    private async void Exit_Click(object s,RoutedEventArgs e){var p=Need();if(p is null)return;await Move(p,false);}
    private async Task Move(Product p,bool entry){var raw=Interaction.InputBox($"Estoque atual: {p.Stock:N0}\n\nQuantidade para {(entry?"ENTRADA":"SAÍDA")}:","Movimentar estoque","1");if(!TryDecimal(raw,out var q)||q<=0||q!=decimal.Truncate(q)){if(raw.Length>0)MessageBox.Show("Quantidade inválida.");return;}var reason=Interaction.InputBox("Motivo da movimentação:","Movimentar estoque",entry?"ENTRADA MANUAL":"SAÍDA / PERDA / AJUSTE");if(string.IsNullOrWhiteSpace(reason))return;var signed=entry?q:-q;var after=p.Stock+signed;if(MessageBox.Show($"Produto: {p.Name}\nAnterior: {p.Stock:N0}\nMovimento: {signed:+0;-0}\nNovo saldo: {after:N0}\n\nConfirmar?","Estoque",MessageBoxButton.YesNo,MessageBoxImage.Question)!=MessageBoxResult.Yes)return;try{await _svc.MoveAsync(p.Id,signed,entry?"Adjustment":"Adjustment",reason);await Refresh();MessageBox.Show($"Estoque atualizado para {after:N0}.","Estoque");}catch(Exception ex){MessageBox.Show(ex.Message,"Estoque",MessageBoxButton.OK,MessageBoxImage.Warning);}}
    private async void Balance_Click(object s,RoutedEventArgs e){var p=Need();if(p is null)return;var raw=Interaction.InputBox($"Estoque atual: {p.Stock:N0}\n\nDigite a CONTAGEM FÍSICA correta:","Ajustar saldo",p.Stock.ToString("N0"));if(!TryDecimal(raw,out var v)||v!=decimal.Truncate(v)){if(raw.Length>0)MessageBox.Show("A quantidade deve ser um número inteiro, sem vírgula.");return;}var reason=Interaction.InputBox("Motivo do ajuste / inventário:","Ajustar saldo","CONTAGEM FÍSICA");if(string.IsNullOrWhiteSpace(reason))return;if(MessageBox.Show($"Alterar saldo de {p.Stock:N0} para {v:N0}?\n\nA diferença ficará registrada no histórico.","Ajustar saldo",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;try{await _svc.SetBalanceAsync(p.Id,v,reason);await Refresh();}catch(Exception ex){MessageBox.Show(ex.Message,"Estoque",MessageBoxButton.OK,MessageBoxImage.Warning);}}
    private Product? Need(){if(Selected is Product p)return p;MessageBox.Show("Selecione um produto primeiro.","Produtos / Estoque");return null;}
    private static bool TryDecimal(string s,out decimal v)=>decimal.TryParse(s,NumberStyles.Number,CultureInfo.GetCultureInfo("pt-BR"),out v)||decimal.TryParse(s,NumberStyles.Number,CultureInfo.InvariantCulture,out v);
}
