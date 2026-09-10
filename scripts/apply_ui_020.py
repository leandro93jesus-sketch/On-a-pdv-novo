from pathlib import Path
import re

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'

# ---------------- MAIN WINDOW ----------------
p=d/'MainWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
x=x.replace('v0.1.19','v0.1.20')

# Remove DIVERSOS popup button from search strip and keep product registration next to price.
x=x.replace('<Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>',
'''<Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>''',1)
x=x.replace('                    <Button Grid.Column="4" Style="{StaticResource SoftButton}" Content="DIVERSOS  [F4]" Click="Diversos_Click" Margin="4,0"/>\n','')
x=x.replace('<Button Grid.Column="5" Style="{StaticResource SoftButton}" Content="PRODUTO  [F1]" Click="Product_Click" Margin="4,0,0,0"/>',
            '<Button Grid.Column="4" Style="{StaticResource SoftButton}" Content="PRODUTO  [F1]" Click="Product_Click" Margin="4,0,0,0"/>')

# Wrap the search strip and add a permanent inline DIVERSOS bar underneath, like the older version.
search_re=re.compile(r'(?P<indent>\s*)<Border Background="White" BorderBrush="#DCE5E0" BorderThickness="1" CornerRadius="10" Padding="10" Margin="0,0,0,12">.*?</Border>\s*\n\s*<Border Grid.Row="1"',re.S)
m=search_re.search(x)
if not m: raise RuntimeError('search strip anchor missing')
block=m.group(0)
idx=block.rfind('<Border Grid.Row="1"')
search_part=block[:idx].rstrip()
cart_start=block[idx:]
inline='''\n                <Border Background="#F2F8F4" BorderBrush="#D5E8DB" BorderThickness="1" CornerRadius="10" Padding="9" Margin="0,0,0,12">\n                    <Grid>\n                        <Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/><ColumnDefinition Width="150"/><ColumnDefinition Width="90"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>\n                        <StackPanel Margin="5,0,12,0" VerticalAlignment="Center"><TextBlock Text="DIVERSOS" FontWeight="Bold" FontSize="14" Foreground="#0B6B3A"/><TextBlock Text="item sem cadastro" FontSize="10" Foreground="#708078"/></StackPanel>\n                        <TextBox Grid.Column="1" x:Name="DiversosNameBox" ToolTip="Nome ou descrição do item" FontSize="15" Padding="9,7" Margin="0,0,6,0"/>\n                        <TextBox Grid.Column="2" x:Name="DiversosValueBox" ToolTip="Valor unitário em R$" FontSize="15" Padding="9,7" Margin="0,0,6,0"/>\n                        <TextBox Grid.Column="3" x:Name="DiversosQtyBox" Text="1" ToolTip="Quantidade" FontSize="15" Padding="9,7" Margin="0,0,6,0"/>\n                        <Button Grid.Column="4" Style="{StaticResource RoundedButton}" Content="ADICIONAR DIVERSOS  [F4]" Click="InlineDiversosAdd_Click" Padding="12,8"/>\n                    </Grid>\n                </Border>'''
wrapped='\n            <StackPanel Grid.Row="0">\n'+search_part+'\n'+inline+'\n            </StackPanel>\n\n            '+cart_start
x=x[:m.start()]+wrapped+x[m.end():]
p.write_text(x,encoding='utf-8')

# Main code: price consultation asks whether to add; inline DIVERSOS; F4 focuses inline area.
p=d/'MainWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
old='new QuickPriceWindow(selected) { Owner = this }.ShowDialog();'
new='''var priceWindow = new QuickPriceWindow(selected) { Owner = this };\n        if (priceWindow.ShowDialog() == true)\n        {\n            await _workflow.AddExistingProductAsync(selected);\n            RefreshCart();\n            SetStatus($"{selected.Name} ADICIONADO AO CARRINHO");\n        }'''
if old not in c: raise RuntimeError('quick price call anchor missing')
c=c.replace(old,new,1)

# Add inline DIVERSOS handler before old popup method; keep popup method untouched for compatibility.
anchor='    private async void Diversos_Click(object sender, RoutedEventArgs e)'
handler=r'''    private void FocusDiversos()
    {
        DiversosNameBox.Focus();
        DiversosNameBox.SelectAll();
        SetStatus("DIVERSOS — DIGITE NOME, VALOR E QUANTIDADE");
    }

    private async void InlineDiversosAdd_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var name = string.IsNullOrWhiteSpace(DiversosNameBox.Text) ? "DIVERSOS" : DiversosNameBox.Text.Trim();
            var valueText = DiversosValueBox.Text.Trim().Replace("R$", "", StringComparison.OrdinalIgnoreCase).Trim();
            var qtyText = DiversosQtyBox.Text.Trim();
            var culture = System.Globalization.CultureInfo.GetCultureInfo("pt-BR");
            if (!decimal.TryParse(valueText, System.Globalization.NumberStyles.Number, culture, out var value) || value <= 0)
            {
                MessageBox.Show("Informe um valor válido maior que zero.", "DIVERSOS", MessageBoxButton.OK, MessageBoxImage.Warning);
                DiversosValueBox.Focus(); DiversosValueBox.SelectAll(); return;
            }
            if (!decimal.TryParse(qtyText, System.Globalization.NumberStyles.Number, culture, out var qty) || qty <= 0)
            {
                MessageBox.Show("Informe uma quantidade válida maior que zero.", "DIVERSOS", MessageBoxButton.OK, MessageBoxImage.Warning);
                DiversosQtyBox.Focus(); DiversosQtyBox.SelectAll(); return;
            }
            await _workflow.AddDiversosAsync(name, qty, value);
            RefreshCart();
            SetStatus($"DIVERSOS ADICIONADO — {name}");
            DiversosNameBox.Clear(); DiversosValueBox.Clear(); DiversosQtyBox.Text = "1";
            DiversosNameBox.Focus();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "DIVERSOS", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

'''+anchor
if anchor not in c: raise RuntimeError('Diversos handler anchor missing')
c=c.replace(anchor,handler,1)
c=c.replace('else if (e.Key == Key.F4) Diversos_Click(sender, e);','else if (e.Key == Key.F4) FocusDiversos();')
p.write_text(c,encoding='utf-8')

# ---------------- QUICK PRICE WINDOW ----------------
(d/'QuickPriceWindow.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.QuickPriceWindow" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Consultar preço — ONÇA PDV PRO" Width="760" Height="520" MinWidth="700" MinHeight="480" WindowStartupLocation="CenterOwner" Background="#F7F9F8" FontFamily="Segoe UI">
<Grid Margin="22"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
<StackPanel><TextBlock Text="CONSULTAR PREÇO" FontSize="27" FontWeight="Bold" Foreground="#0B6B3A"/><TextBlock Text="Consulta sem adicionar automaticamente ao carrinho." Foreground="#6A786F" Margin="0,4,0,14"/></StackPanel>
<Border Grid.Row="1" Background="White" BorderBrush="#DCE5DF" BorderThickness="1" CornerRadius="14" Padding="20"><Grid><Grid.ColumnDefinitions><ColumnDefinition Width="190"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
<Border Background="#F2F6F3" CornerRadius="10" Margin="0,0,20,0"><Grid><Image x:Name="Photo" Stretch="Uniform" Margin="10"/><TextBlock x:Name="NoPhoto" Text="SEM FOTO" HorizontalAlignment="Center" VerticalAlignment="Center" Foreground="#89938E" FontWeight="SemiBold"/></Grid></Border>
<StackPanel Grid.Column="1"><TextBlock x:Name="NameText" FontSize="25" FontWeight="Bold" Foreground="#233129" TextWrapping="Wrap"/><TextBlock x:Name="CodeText" Foreground="#718078" Margin="0,4,0,14" TextWrapping="Wrap"/>
<Border Background="#EAF8EF" CornerRadius="10" Padding="14" Margin="0,0,0,10"><StackPanel><TextBlock Text="PREÇO ATUAL" Foreground="#0B6B3A" FontWeight="SemiBold"/><TextBlock x:Name="PriceText" FontSize="36" FontWeight="Bold" Foreground="#087233"/></StackPanel></Border>
<TextBlock x:Name="StockText" FontSize="17" FontWeight="SemiBold" Margin="2,4"/><Border x:Name="PromoBorder" Background="#FFF6E8" CornerRadius="8" Padding="10" Margin="0,6,0,0"><TextBlock x:Name="PromoText" FontSize="14" Foreground="#A96100" FontWeight="SemiBold" TextWrapping="Wrap"/></Border></StackPanel></Grid></Border>
<Grid Grid.Row="2" Margin="0,15,0,0"><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><TextBlock Text="Deseja adicionar este produto ao carrinho?" VerticalAlignment="Center" FontSize="15" FontWeight="SemiBold" Foreground="#33443A"/><Button Grid.Column="1" Content="NÃO — SÓ CONSULTAR" Click="Close_Click" Padding="18,11" Margin="5"/><Button Grid.Column="2" Content="SIM — ADICIONAR AO CARRINHO" Click="Add_Click" Padding="18,11" Margin="5" Background="#0B6B3A" Foreground="White" FontWeight="Bold"/></Grid>
</Grid></Window>''',encoding='utf-8')

(d/'QuickPriceWindow.xaml.cs').write_text(r'''using System;using System.IO;using System.Windows;using System.Windows.Media.Imaging;using OncaPDV.Domain;
namespace OncaPDV.Desktop;
public partial class QuickPriceWindow:Window
{
 public QuickPriceWindow(Product p)
 {
  InitializeComponent();NameText.Text=p.Name;CodeText.Text=$"Código: {p.InternalCode}   •   Barras: {p.Barcode ?? "—"}";PriceText.Text=p.CurrentPrice(DateTimeOffset.Now).ToString("C");StockText.Text=$"Estoque: {p.Stock:N3} {p.Unit}";
  var now=DateTimeOffset.Now;var promo=p.PromotionalPrice is not null&&p.PromotionStartsAt<=now&&p.PromotionEndsAt>=now;
  PromoText.Text=promo?$"PROMOÇÃO ATIVA • preço normal {p.SalePrice:C} • até {p.PromotionEndsAt:dd/MM/yyyy}":"Sem promoção ativa no momento.";
  TryPhoto(p.PhotoPath);
 }
 private void TryPhoto(string? path){try{if(!string.IsNullOrWhiteSpace(path)&&File.Exists(path)){Photo.Source=new BitmapImage(new Uri(Path.GetFullPath(path)));NoPhoto.Visibility=Visibility.Collapsed;}}catch{}}
 private void Add_Click(object sender,RoutedEventArgs e)=>DialogResult=true;
 private void Close_Click(object sender,RoutedEventArgs e)=>DialogResult=false;
}''',encoding='utf-8')

# ---------------- SALES MANAGEMENT ----------------
# Professional list + always-visible receipt preview for every selected sale; existing operations preserved.
(d/'SalesManagementWindow.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.SalesManagementWindow" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Gerenciar vendas — ONÇA PDV PRO 0.1.20" Width="1380" Height="820" MinWidth="1180" MinHeight="700" WindowStartupLocation="CenterOwner" Background="#F7F9F8" FontFamily="Segoe UI">
<Window.Resources><Style TargetType="Button"><Setter Property="Padding" Value="12,8"/><Setter Property="Margin" Value="3"/><Setter Property="FontWeight" Value="SemiBold"/></Style><Style TargetType="DataGrid"><Setter Property="RowHeight" Value="38"/><Setter Property="AlternatingRowBackground" Value="#FAFCFB"/><Setter Property="GridLinesVisibility" Value="Horizontal"/></Style></Window.Resources>
<Grid Margin="16"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
<Border Background="White" BorderBrush="#DDE5E1" BorderThickness="1" CornerRadius="10" Padding="12"><Grid><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><StackPanel><TextBlock Text="GERENCIAR VENDAS" FontSize="23" FontWeight="Bold" Foreground="#0B6B3A"/><TextBlock Text="Selecione qualquer venda para visualizar o cupom completo ao lado." Foreground="#68776F"/></StackPanel><WrapPanel Grid.Column="1" VerticalAlignment="Center"><TextBox x:Name="SearchBox" Width="300" Padding="8" ToolTip="Número, cliente, produto, código, valor ou pagamento"/><ComboBox x:Name="StatusBox" Width="145" Margin="6,0"><ComboBoxItem Content="Todos" IsSelected="True"/><ComboBoxItem Content="Completed"/><ComboBoxItem Content="Cancelled"/></ComboBox><Button Content="PESQUISAR" Click="Search_Click" Background="#0B6B3A" Foreground="White"/></WrapPanel></Grid></Border>
<Grid Grid.Row="1" Margin="0,12"><Grid.ColumnDefinitions><ColumnDefinition Width="1.25*"/><ColumnDefinition Width="12"/><ColumnDefinition Width="0.75*"/></Grid.ColumnDefinitions>
<Border Background="White" BorderBrush="#DDE5E1" BorderThickness="1" CornerRadius="10" Padding="8"><Grid><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition/></Grid.RowDefinitions><TextBlock Text="VENDAS" FontSize="16" FontWeight="Bold" Margin="6,4,6,8" Foreground="#2B3932"/><DataGrid Grid.Row="1" x:Name="Grid" AutoGenerateColumns="True" IsReadOnly="True" SelectionChanged="Grid_SelectionChanged"/></Grid></Border>
<Border Grid.Column="2" Background="White" BorderBrush="#DDE5E1" BorderThickness="1" CornerRadius="10" Padding="10"><Grid><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition/><RowDefinition Height="Auto"/></Grid.RowDefinitions><StackPanel><TextBlock x:Name="ReceiptTitle" Text="CUPOM DA VENDA" FontSize="17" FontWeight="Bold" Foreground="#0B6B3A"/><TextBlock Text="Prévia profissional do comprovante salvo" FontSize="11" Foreground="#748078" Margin="0,2,0,8"/></StackPanel><TextBox Grid.Row="1" x:Name="ReceiptText" IsReadOnly="True" FontFamily="Consolas" FontSize="13" TextWrapping="NoWrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" Background="#FCFDFC" BorderBrush="#E2E8E5"/><WrapPanel Grid.Row="2" HorizontalAlignment="Right" Margin="0,8,0,0"><Button Content="VER CUPOM GRANDE" Click="View_Click"/><Button Content="REIMPRIMIR" Click="Reprint_Click"/><Button Content="PDF" Click="Pdf_Click"/></WrapPanel></Grid></Border>
</Grid>
<Border Grid.Row="2" Background="White" BorderBrush="#DDE5E1" BorderThickness="1" CornerRadius="10" Padding="8"><WrapPanel><Button Content="EDITAR / REABRIR NO CARRINHO" Click="Edit_Click"/><Button Content="ALTERAR PAGAMENTO" Click="Payment_Click"/><Button Content="EXCLUIR / CANCELAR VENDA" Click="Cancel_Click" Foreground="#B42318"/><Button Content="SALVAR COMO RASCUNHO FISCAL" Click="Fiscal_Click"/><Button Content="WHATSAPP ENTREGA" Click="Delivery_Click"/></WrapPanel></Border>
</Grid></Window>''',encoding='utf-8')

(d/'SalesManagementWindow.xaml.cs').write_text(r'''using System.Windows;using System.Windows.Controls;using OncaPDV.Application;using OncaPDV.Domain;using OncaPDV.Infrastructure;using OncaPDV.Printing;
namespace OncaPDV.Desktop;
public partial class SalesManagementWindow:Window
{
 private readonly OncaDatabase _db;private readonly AdvancedOperationsService _advanced;private readonly PosWorkflow _workflow;private readonly Guid _operator;private readonly IPrintService _printer;private readonly IReceiptRenderer _renderer;private readonly AppPaths _paths=AppPaths.Default();
 public bool CartChanged{get;private set;}
 public SalesManagementWindow(OncaDatabase db,PosWorkflow workflow,Guid op,IPrintService printer,IReceiptRenderer renderer){_db=db;_workflow=workflow;_operator=op;_printer=printer;_renderer=renderer;_advanced=new(db);InitializeComponent();Loaded+=async(_,_)=>await Search();}
 private string Status=>(StatusBox.SelectedItem as ComboBoxItem)?.Content?.ToString()??"Todos";
 private async Task Search(){Grid.ItemsSource=await _advanced.SearchSalesAsync(SearchBox.Text,Status);ReceiptText.Clear();ReceiptTitle.Text="CUPOM DA VENDA";}
 private async void Search_Click(object s,RoutedEventArgs e)=>await Search();
 private SaleSearchRow Selected()=>Grid.SelectedItem as SaleSearchRow??throw new DomainException("Selecione uma venda.");
 private async Task<Sale> Sale()=>await _workflow.GetSaleAsync(Selected().Id)??throw new DomainException("Venda não encontrada.");
 private async void Grid_SelectionChanged(object sender,SelectionChangedEventArgs e){try{if(Grid.SelectedItem is not SaleSearchRow row){ReceiptText.Clear();return;}var sale=await _workflow.GetSaleAsync(row.Id);if(sale is null){ReceiptText.Text="Venda não encontrada.";return;}ReceiptTitle.Text=$"CUPOM • VENDA {sale.Number:000000}";ReceiptText.Text=_renderer.Render(new(sale)).Text;}catch(Exception ex){ReceiptText.Text=ex.Message;}}
 private async void View_Click(object s,RoutedEventArgs e){try{var sale=await Sale();new ReceiptPreviewWindow(_renderer.Render(new(sale)).Text,$"Venda {sale.Number:000000}"){Owner=this}.ShowDialog();}catch(Exception ex){MessageBox.Show(ex.Message,"Cupom",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Reprint_Click(object s,RoutedEventArgs e){try{var sale=await Sale();if(MessageBox.Show($"Deseja reimprimir o cupom da venda {sale.Number:000000}?","ONÇA PDV — Confirmação de impressão",MessageBoxButton.YesNo,MessageBoxImage.Question)!=MessageBoxResult.Yes)return;var r=await _printer.PrintAsync(new(sale,IsReprint:true));MessageBox.Show(r.Success?"Reimpressão enviada.":r.Error??"Falha na reimpressão.","Reimpressão");}catch(Exception ex){MessageBox.Show(ex.Message,"Reimpressão",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Pdf_Click(object s,RoutedEventArgs e){try{var sale=await Sale();var pdf=await new OperationalService(_db,_paths).SalePdfAsync(sale);MessageBox.Show($"PDF GERADO\n\n{pdf}","Venda",MessageBoxButton.OK,MessageBoxImage.Information);}catch(Exception ex){MessageBox.Show(ex.Message,"PDF",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Cancel_Click(object s,RoutedEventArgs e){try{var row=Selected();var reason=Microsoft.VisualBasic.Interaction.InputBox("Motivo obrigatório do cancelamento:","Cancelar venda","");if(string.IsNullOrWhiteSpace(reason))return;if(MessageBox.Show($"Cancelar a venda {row.Number:000000}?\n\nCaixa e crediário serão estornados automaticamente.","ONÇA PDV",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;var sale=await _workflow.GetSaleAsync(row.Id);await _advanced.CancelSaleAsync(row.Id,_operator,reason);await Search();if(sale is not null&&MessageBox.Show("Venda cancelada. Deseja imprimir comprovante de cancelamento?","ONÇA PDV",MessageBoxButton.YesNo,MessageBoxImage.Question)==MessageBoxResult.Yes)await _printer.PrintAsync(new(sale,IsReprint:true,SaleLabel:$"CANCELADA {sale.Number:000000}"));}catch(Exception ex){MessageBox.Show(ex.Message,"Venda",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Edit_Click(object s,RoutedEventArgs e){try{var sale=await Sale();var reason=Microsoft.VisualBasic.Interaction.InputBox("Motivo da edição:","Editar venda","");if(string.IsNullOrWhiteSpace(reason))return;if(MessageBox.Show("A venda original será cancelada/estornada e seus itens voltarão ao carrinho para correção. Continuar?","Editar venda",MessageBoxButton.YesNo)!=MessageBoxResult.Yes)return;await _advanced.CancelSaleAsync(sale.Id,_operator,"EDIÇÃO: "+reason);await _workflow.LoadSaleSnapshotAsync(sale);CartChanged=true;DialogResult=true;}catch(Exception ex){MessageBox.Show(ex.Message,"Editar venda",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Payment_Click(object s,RoutedEventArgs e){try{var row=Selected();var dialog=new PaymentMethodChangeWindow{Owner=this};if(dialog.ShowDialog()!=true)return;await _advanced.ChangeSinglePaymentMethodAsync(row.Id,dialog.Method,_operator,dialog.Reason);await Search();MessageBox.Show("Forma de pagamento alterada e caixa/crediário ajustados.");}catch(Exception ex){MessageBox.Show(ex.Message,"Pagamento",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Delivery_Click(object s,RoutedEventArgs e){try{var text=await _advanced.SaleDeliveryTextAsync(Selected().Id);var url="https://wa.me/?text="+Uri.EscapeDataString(text);System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url){UseShellExecute=true});}catch(Exception ex){MessageBox.Show(ex.Message,"WhatsApp",MessageBoxButton.OK,MessageBoxImage.Warning);}}
 private async void Fiscal_Click(object s,RoutedEventArgs e){try{var row=Selected();await _advanced.SaveFiscalDraftAsync(row.Id);MessageBox.Show("Rascunho fiscal salvo. Ele poderá ser preparado para emissão depois, sem emitir nota automaticamente.");}catch(Exception ex){MessageBox.Show(ex.Message,"Fiscal",MessageBoxButton.OK,MessageBoxImage.Warning);}}
}''',encoding='utf-8')

print('UI020_APPLIED=YES')
