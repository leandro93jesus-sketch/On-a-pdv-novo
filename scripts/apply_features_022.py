from pathlib import Path
import re

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'
i=root/'src'/'OncaPDV.Infrastructure'

# ---------- version + main layout + navigation ----------
p=d/'MainWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
x=x.replace('v0.1.21','v0.1.22')
x=x.replace('Height="900" Width="1540" MinHeight="760" MinWidth="1240"','Height="900" Width="1540" MinHeight="650" MinWidth="1000"')
x=x.replace('<ColumnDefinition Width="220"/>','<ColumnDefinition x:Name="NavColumn" Width="220"/>',1)
x=x.replace('<ColumnDefinition Width="370"/>','<ColumnDefinition x:Name="PaymentColumn" Width="370"/>',1)
x=x.replace('<Button Style="{StaticResource NavButton}" Content="▥   Relatórios" Click="Operations_Click"/>','<Button Style="{StaticResource NavButton}" Content="▥   Relatórios" Click="Reports022_Click"/>')
x=x.replace('<Button Style="{StaticResource NavButton}" Content="⏸   Colocar venda em espera" Click="HoldSale_Click"/>','<Button Style="{StaticResource NavButton}" Content="📦   Pedidos" Click="Orders_Click"/>')
p.write_text(x,encoding='utf-8')

# Hide legacy hold tab but preserve fields/code for compatibility.
p=d/'FinalOperationsWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
x=x.replace('<TabItem Header="VENDAS EM ESPERA">','<TabItem Header="VENDAS EM ESPERA" Visibility="Collapsed">',1)
p.write_text(x,encoding='utf-8')

# ---------- orders service ----------
(i/'OrderService022.cs').write_text(r'''using System.Text.Json;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed record Order022(Guid Id,long Number,Guid? CustomerId,string Customer,string Phone,IReadOnlyList<CartItem> Items,decimal Discount,decimal Total,string Status,string Notes,DateTimeOffset CreatedAt,DateTimeOffset UpdatedAt,long? SaleNumber);

public sealed class OrderService022
{
    private readonly OncaDatabase _db;
    public OrderService022(OncaDatabase db){_db=db;EnsureSchema();}
    private void EnsureSchema(){using var c=_db.Open();using var q=c.CreateCommand();q.CommandText="""
CREATE TABLE IF NOT EXISTS orders_022(
 id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, customer_id TEXT, customer_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
 items_json TEXT NOT NULL, discount NUMERIC NOT NULL, total NUMERIC NOT NULL, status TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, sale_id TEXT, sale_number INTEGER);
CREATE INDEX IF NOT EXISTS ix_orders022_number ON orders_022(number);
CREATE INDEX IF NOT EXISTS ix_orders022_status ON orders_022(status);
CREATE INDEX IF NOT EXISTS ix_orders022_customer ON orders_022(customer_name);
""";q.ExecuteNonQuery();}

    public async Task<Order022> CreateAsync(Guid? customerId,string customer,string phone,string notes,IReadOnlyList<CartItem> items,decimal discount,CancellationToken ct=default)
    {
        if(items.Count==0)throw new InvalidOperationException("CARRINHO VAZIO");customer=(customer??"").Trim();if(customer.Length<2)throw new InvalidOperationException("INFORME O NOME DO CLIENTE");phone=(phone??"").Trim();notes=(notes??"").Trim();
        var id=Guid.NewGuid();var now=DateTimeOffset.Now;var total=items.Sum(x=>x.Subtotal)-discount;var json=JsonSerializer.Serialize(items.Select(x=>new ItemDto(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitPrice)).ToArray());
        await using var c=_db.Open();await using var tx=await c.BeginTransactionAsync(ct);long number;await using(var n=c.CreateCommand()){n.Transaction=(SqliteTransaction)tx;n.CommandText="SELECT COALESCE(MAX(number),0)+1 FROM orders_022";number=Convert.ToInt64(await n.ExecuteScalarAsync(ct));}
        await using(var q=c.CreateCommand()){q.Transaction=(SqliteTransaction)tx;q.CommandText="INSERT INTO orders_022(id,number,customer_id,customer_name,phone,items_json,discount,total,status,notes,created_at,updated_at) VALUES($id,$n,$cid,$c,$p,$j,$d,$t,'AwaitingPayment',$o,$at,$at)";q.Parameters.AddWithValue("$id",id.ToString());q.Parameters.AddWithValue("$n",number);q.Parameters.AddWithValue("$cid",(object?)customerId?.ToString()??DBNull.Value);q.Parameters.AddWithValue("$c",customer);q.Parameters.AddWithValue("$p",phone);q.Parameters.AddWithValue("$j",json);q.Parameters.AddWithValue("$d",discount);q.Parameters.AddWithValue("$t",total);q.Parameters.AddWithValue("$o",notes);q.Parameters.AddWithValue("$at",now.ToString("O"));await q.ExecuteNonQueryAsync(ct);}await tx.CommitAsync(ct);return new(id,number,customerId,customer,phone,items,discount,total,"AwaitingPayment",notes,now,now,null);
    }

    public async Task<Order022?> GetAsync(Guid id,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT id,number,customer_id,customer_name,phone,items_json,discount,total,status,notes,created_at,updated_at,sale_number FROM orders_022 WHERE id=$id";q.Parameters.AddWithValue("$id",id.ToString());await using var r=await q.ExecuteReaderAsync(ct);return await r.ReadAsync(ct)?Read(r):null;}

    public async Task<IReadOnlyList<Order022>> SearchAsync(string? search=null,string status="AwaitingPayment",CancellationToken ct=default){search=(search??"").Trim();var list=new List<Order022>();await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT id,number,customer_id,customer_name,phone,items_json,discount,total,status,notes,created_at,updated_at,sale_number FROM orders_022 WHERE ($status='Todos' OR status=$status) AND ($s='' OR CAST(number AS TEXT) LIKE '%'||$s||'%' OR customer_name LIKE '%'||$s||'%' OR phone LIKE '%'||$s||'%' OR substr(created_at,1,10) LIKE '%'||$s||'%') ORDER BY created_at DESC LIMIT 1000";q.Parameters.AddWithValue("$status",status);q.Parameters.AddWithValue("$s",search);await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(Read(r));return list;}

    public async Task UpdateAsync(Guid id,Guid? customerId,string customer,string phone,string notes,IReadOnlyList<CartItem> items,decimal discount,CancellationToken ct=default){if(items.Count==0)throw new InvalidOperationException("CARRINHO VAZIO");customer=(customer??"").Trim();if(customer.Length<2)throw new InvalidOperationException("INFORME O NOME DO CLIENTE");var total=items.Sum(x=>x.Subtotal)-discount;var json=JsonSerializer.Serialize(items.Select(x=>new ItemDto(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitPrice)).ToArray());await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET customer_id=$cid,customer_name=$c,phone=$p,notes=$o,items_json=$j,discount=$d,total=$t,updated_at=$at WHERE id=$id AND status='AwaitingPayment'";q.Parameters.AddWithValue("$cid",(object?)customerId?.ToString()??DBNull.Value);q.Parameters.AddWithValue("$c",customer);q.Parameters.AddWithValue("$p",phone??"");q.Parameters.AddWithValue("$o",notes??"");q.Parameters.AddWithValue("$j",json);q.Parameters.AddWithValue("$d",discount);q.Parameters.AddWithValue("$t",total);q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException("PEDIDO NÃO ESTÁ MAIS AGUARDANDO PAGAMENTO");}

    public async Task CancelAsync(Guid id,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET status='Cancelled',updated_at=$at WHERE id=$id AND status='AwaitingPayment'";q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException("SOMENTE PEDIDO AGUARDANDO PAGAMENTO PODE SER CANCELADO");}

    public async Task<bool> TryClaimForPaymentAsync(Guid id,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET status='Processing',updated_at=$at WHERE id=$id AND status='AwaitingPayment'";q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());return await q.ExecuteNonQueryAsync(ct)==1;}
    public async Task ReleaseClaimAsync(Guid id,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET status='AwaitingPayment',updated_at=$at WHERE id=$id AND status='Processing'";q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());await q.ExecuteNonQueryAsync(ct);}
    public async Task MarkPaidAsync(Guid id,Guid saleId,long saleNumber,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="UPDATE orders_022 SET status='Paid',sale_id=$sale,sale_number=$number,updated_at=$at WHERE id=$id AND status='Processing'";q.Parameters.AddWithValue("$sale",saleId.ToString());q.Parameters.AddWithValue("$number",saleNumber);q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$id",id.ToString());if(await q.ExecuteNonQueryAsync(ct)!=1)throw new InvalidOperationException("PEDIDO JÁ FOI PAGO OU ALTERADO EM OUTRO TERMINAL");}

    public async Task<int> CountPaidAsync(DateTimeOffset from,DateTimeOffset to,CancellationToken ct=default){await using var c=_db.Open();await using var q=c.CreateCommand();q.CommandText="SELECT COUNT(*) FROM orders_022 WHERE status='Paid' AND updated_at >= $f AND updated_at < $t";q.Parameters.AddWithValue("$f",from.ToString("O"));q.Parameters.AddWithValue("$t",to.ToString("O"));return Convert.ToInt32(await q.ExecuteScalarAsync(ct));}

    private static Order022 Read(SqliteDataReader r){var dto=JsonSerializer.Deserialize<ItemDto[]>(r.GetString(5))??[];var items=dto.Select(x=>new CartItem(x.ProductId,x.Code,x.Name,x.Quantity,x.UnitPrice)).ToArray();return new(Guid.Parse(r.GetString(0)),r.GetInt64(1),r.IsDBNull(2)?null:Guid.Parse(r.GetString(2)),r.GetString(3),r.GetString(4),items,r.GetDecimal(6),r.GetDecimal(7),r.GetString(8),r.GetString(9),DateTimeOffset.Parse(r.GetString(10)),DateTimeOffset.Parse(r.GetString(11)),r.IsDBNull(12)?null:r.GetInt64(12));}
    private sealed record ItemDto(Guid? ProductId,string Code,string Name,decimal Quantity,decimal UnitPrice);
}
''',encoding='utf-8')

# ---------- order dialogs ----------
(d/'FinalizeChoiceWindow.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.FinalizeChoiceWindow" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Finalizar carrinho — ONÇA PDV PRO 0.1.22" Width="560" Height="310" ResizeMode="NoResize" WindowStartupLocation="CenterOwner" Background="#F7F9F8"><Grid Margin="24"><Grid.RowDefinitions><RowDefinition/><RowDefinition Height="Auto"/></Grid.RowDefinitions><StackPanel><TextBlock Text="O QUE DESEJA FAZER?" FontSize="25" FontWeight="Bold" Foreground="#173A28"/><TextBlock Text="Finalize a venda normalmente ou separe o carrinho como pedido aguardando pagamento." Margin="0,10,0,0" TextWrapping="Wrap" Foreground="#66746C" FontSize="15"/></StackPanel><Grid Grid.Row="1" Margin="0,20,0,0"><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition/></Grid.ColumnDefinitions><Button Content="FINALIZAR VENDA" Height="64" Margin="0,0,6,0" Background="#0B6B3A" Foreground="White" FontSize="17" FontWeight="Bold" Click="Sale_Click"/><Button Grid.Column="1" Content="SEPARAR PEDIDO" Height="64" Margin="6,0,0,0" Background="#D98B16" Foreground="White" FontSize="17" FontWeight="Bold" Click="Order_Click"/></Grid></Grid></Window>''',encoding='utf-8')
(d/'FinalizeChoiceWindow.xaml.cs').write_text(r'''using System.Windows;namespace OncaPDV.Desktop;public partial class FinalizeChoiceWindow:Window{public bool SeparateOrder{get;private set;}public FinalizeChoiceWindow(){InitializeComponent();}private void Sale_Click(object sender,RoutedEventArgs e){SeparateOrder=false;DialogResult=true;}private void Order_Click(object sender,RoutedEventArgs e){SeparateOrder=true;DialogResult=true;}}''',encoding='utf-8')

(d/'SeparateOrderWindow.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.SeparateOrderWindow" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Separar pedido — ONÇA PDV PRO 0.1.22" Width="620" Height="500" MinWidth="560" MinHeight="460" WindowStartupLocation="CenterOwner" Background="#F7F9F8"><ScrollViewer VerticalScrollBarVisibility="Auto"><StackPanel Margin="24"><TextBlock Text="SEPARAR PEDIDO" FontSize="27" FontWeight="Bold" Foreground="#0B6B3A"/><TextBlock x:Name="TotalText" Margin="0,5,0,18" FontSize="18" FontWeight="SemiBold"/><TextBlock Text="Nome do cliente *"/><TextBox x:Name="CustomerBox" FontSize="16" Padding="10" Margin="0,5,0,12"/><TextBlock Text="Telefone"/><TextBox x:Name="PhoneBox" FontSize="16" Padding="10" Margin="0,5,0,12"/><TextBlock Text="Observação"/><TextBox x:Name="NotesBox" FontSize="15" Padding="10" Height="90" AcceptsReturn="True" TextWrapping="Wrap" Margin="0,5,0,15"/><TextBlock Text="O pedido ficará AGUARDANDO PAGAMENTO e não entrará no caixa nem no faturamento." Foreground="#8A5A00" TextWrapping="Wrap" Margin="0,0,0,15"/><Button Content="SALVAR PEDIDO" Height="52" Background="#0B6B3A" Foreground="White" FontWeight="Bold" FontSize="16" Click="Save_Click"/></StackPanel></ScrollViewer></Window>''',encoding='utf-8')
(d/'SeparateOrderWindow.xaml.cs').write_text(r'''using System.Windows;namespace OncaPDV.Desktop;public partial class SeparateOrderWindow:Window{public string CustomerName=>CustomerBox.Text.Trim();public string Phone=>PhoneBox.Text.Trim();public string Notes=>NotesBox.Text.Trim();public SeparateOrderWindow(decimal total,string? customer=null,string? phone=null,string? notes=null){InitializeComponent();TotalText.Text=$"Total do carrinho: {total:C}";CustomerBox.Text=customer??"";PhoneBox.Text=phone??"";NotesBox.Text=notes??"";}private void Save_Click(object sender,RoutedEventArgs e){if(CustomerName.Length<2){MessageBox.Show("Informe o nome do cliente.","Pedido",MessageBoxButton.OK,MessageBoxImage.Warning);CustomerBox.Focus();return;}DialogResult=true;}}''',encoding='utf-8')

(d/'OrdersWindow.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.OrdersWindow" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Pedidos — ONÇA PDV PRO 0.1.22" Width="1180" Height="760" MinWidth="940" MinHeight="620" WindowStartupLocation="CenterOwner" Background="#F7F9F8"><Grid Margin="18"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition/><RowDefinition Height="Auto"/></Grid.RowDefinitions><StackPanel><TextBlock Text="PEDIDOS" FontSize="28" FontWeight="Bold" Foreground="#0B6B3A"/><TextBlock Text="Pedidos aguardam pagamento e só viram venda quando o pagamento é confirmado." Foreground="#69766F"/></StackPanel><Grid Grid.Row="1" Margin="0,14"><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="180"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><TextBox x:Name="SearchBox" Padding="10" FontSize="15" ToolTip="Número, cliente, telefone ou data"/><ComboBox x:Name="StatusBox" Grid.Column="1" Margin="8,0" SelectedIndex="0"><ComboBoxItem Content="AwaitingPayment"/><ComboBoxItem Content="Paid"/><ComboBoxItem Content="Cancelled"/><ComboBoxItem Content="Todos"/></ComboBox><Button Grid.Column="2" Content="BUSCAR" Padding="18,9" Background="#0B6B3A" Foreground="White" Click="Search_Click"/></Grid><DataGrid Grid.Row="2" x:Name="Grid" AutoGenerateColumns="False" IsReadOnly="True" SelectionMode="Single" Background="White" RowHeight="40"><DataGrid.Columns><DataGridTextColumn Header="PEDIDO" Binding="{Binding Number,StringFormat=000000}" Width="90"/><DataGridTextColumn Header="CLIENTE" Binding="{Binding Customer}" Width="2*"/><DataGridTextColumn Header="TELEFONE" Binding="{Binding Phone}" Width="150"/><DataGridTextColumn Header="DATA" Binding="{Binding CreatedAt,StringFormat=dd/MM/yyyy HH:mm}" Width="150"/><DataGridTextColumn Header="TOTAL" Binding="{Binding Total,StringFormat=C}" Width="120"/><DataGridTextColumn Header="STATUS" Binding="{Binding Status}" Width="155"/><DataGridTextColumn Header="VENDA" Binding="{Binding SaleNumber}" Width="90"/></DataGrid.Columns></DataGrid><Grid Grid.Row="3" Margin="0,14,0,0"><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><TextBlock Text="Editar abre o pedido no carrinho. Cancelar não movimenta caixa nem estoque." Foreground="#6C7871" VerticalAlignment="Center"/><WrapPanel Grid.Column="1"><Button Content="CANCELAR PEDIDO" Padding="14,10" Margin="4" Click="Cancel_Click"/><Button Content="EDITAR NO CARRINHO" Padding="14,10" Margin="4" Click="Edit_Click"/><Button Content="CONFIRMAR PAGAMENTO" Padding="16,10" Margin="4" Background="#0B6B3A" Foreground="White" FontWeight="Bold" Click="Pay_Click"/><Button Content="FECHAR" Padding="14,10" Margin="4" IsCancel="True"/></WrapPanel></Grid></Grid></Window>''',encoding='utf-8')
(d/'OrdersWindow.xaml.cs').write_text(r'''using System.Windows;using System.Windows.Controls;using OncaPDV.Infrastructure;namespace OncaPDV.Desktop;public partial class OrdersWindow:Window{private readonly OrderService022 _svc;public Order022? SelectedOrder{get;private set;}public string Action{get;private set;}="";public OrdersWindow(OrderService022 svc){_svc=svc;InitializeComponent();Loaded+=async(_,_)=>await Refresh();}private string Status=>StatusBox.SelectedItem is ComboBoxItem i?Convert.ToString(i.Content)??"AwaitingPayment":"AwaitingPayment";private async Task Refresh()=>Grid.ItemsSource=await _svc.SearchAsync(SearchBox.Text,Status);private async void Search_Click(object sender,RoutedEventArgs e)=>await Refresh();private Order022? Pick(){if(Grid.SelectedItem is not Order022 o){MessageBox.Show("Selecione um pedido.","Pedidos");return null;}return o;}private void Edit_Click(object sender,RoutedEventArgs e){var o=Pick();if(o is null)return;if(o.Status!="AwaitingPayment"){MessageBox.Show("Somente pedido aguardando pagamento pode ser editado.");return;}SelectedOrder=o;Action="Edit";DialogResult=true;}private void Pay_Click(object sender,RoutedEventArgs e){var o=Pick();if(o is null)return;if(o.Status!="AwaitingPayment"){MessageBox.Show("Este pedido não está aguardando pagamento.");return;}SelectedOrder=o;Action="Pay";DialogResult=true;}private async void Cancel_Click(object sender,RoutedEventArgs e){var o=Pick();if(o is null)return;if(MessageBox.Show($"Cancelar o pedido {o.Number:000000}?\n\nNada será lançado no caixa.","Pedidos",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;try{await _svc.CancelAsync(o.Id);await Refresh();}catch(Exception ex){MessageBox.Show(ex.Message,"Pedidos",MessageBoxButton.OK,MessageBoxImage.Warning);}}}''',encoding='utf-8')

# ---------- reports ----------
(i/'ReportService022.cs').write_text(r'''using Microsoft.Data.Sqlite;namespace OncaPDV.Infrastructure;public sealed record Report022(int Sales,decimal Revenue,decimal Cash,decimal Pix,decimal Debit,decimal Credit,decimal StoreCredit,decimal CreditReceipts,int PaidOrders,int CancelledSales);public sealed class ReportService022{private readonly OncaDatabase _db;public ReportService022(OncaDatabase db){_db=db;}public async Task<Report022> LoadAsync(DateTimeOffset from,DateTimeOffset to,CancellationToken ct=default){var baseSummary=await new FinalFeaturesService(_db).SummaryAsync(from,to,ct);await using var c=_db.Open();async Task<int>I(string sql){await using var q=c.CreateCommand();q.CommandText=sql;q.Parameters.AddWithValue("$f",from.ToString("O"));q.Parameters.AddWithValue("$t",to.ToString("O"));return Convert.ToInt32(await q.ExecuteScalarAsync(ct));}var cancelled=await I("SELECT COUNT(*) FROM sales WHERE status='Cancelled' AND created_at >= $f AND created_at < $t");var orders=await new OrderService022(_db).CountPaidAsync(from,to,ct);return new(baseSummary.Sales,baseSummary.Revenue,baseSummary.Cash,baseSummary.Pix,baseSummary.Debit,baseSummary.Credit,baseSummary.StoreCredit,baseSummary.CreditReceipts,orders,cancelled);}public async Task<string> PdfAsync(Report022 r,DateTimeOffset from,DateTimeOffset to,AppPaths paths,CancellationToken ct=default){paths.EnsureCreated();var lines=new[]{"ONÇA PRODUTOS DE LIMPEZA","RELATÓRIO GERENCIAL",$"Período: {from:dd/MM/yyyy} a {to.AddDays(-1):dd/MM/yyyy}",$"Emitido em: {DateTime.Now:dd/MM/yyyy HH:mm}","",$"VENDAS CONCLUÍDAS: {r.Sales}",$"FATURAMENTO: {r.Revenue:C}",$"PEDIDOS PAGOS: {r.PaidOrders}",$"CANCELAMENTOS: {r.CancelledSales}","","FORMAS DE PAGAMENTO",$"Dinheiro: {r.Cash:C}",$"PIX: {r.Pix:C}",$"Débito: {r.Debit:C}",$"Crédito: {r.Credit:C}",$"Crediário gerado: {r.StoreCredit:C}",$"Crediário recebido: {r.CreditReceipts:C}","","Página 1 de 1","ONÇA PDV PRO • v0.1.22"};var file=Path.Combine(paths.Exports,$"relatorio-onca-{DateTime.Now:yyyyMMdd-HHmmssfff}.pdf");await File.WriteAllBytesAsync(file,SimplePdf.Create("RELATÓRIO — ONÇA PRODUTOS DE LIMPEZA",lines),ct);return file;}}''',encoding='utf-8')

(d/'Reports022Window.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.Reports022Window" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Relatórios — ONÇA PDV PRO 0.1.22" Width="1080" Height="720" MinWidth="900" MinHeight="620" WindowStartupLocation="CenterOwner" Background="#F7F9F8"><ScrollViewer VerticalScrollBarVisibility="Auto"><StackPanel Margin="22"><TextBlock Text="RELATÓRIOS — ONÇA PRODUTOS DE LIMPEZA" FontSize="27" FontWeight="Bold" Foreground="#0B6B3A"/><TextBlock Text="Vendas, crediário, pedidos pagos, cancelamentos e formas de pagamento." Foreground="#66746C" Margin="0,4,0,16"/><WrapPanel><DatePicker x:Name="FromPicker" Width="160"/><DatePicker x:Name="ToPicker" Width="160" Margin="8,0"/><Button Content="ATUALIZAR" Padding="18,8" Click="Refresh_Click" Background="#0B6B3A" Foreground="White"/><Button Content="GERAR PDF" Padding="18,8" Margin="8,0" Click="Pdf_Click"/></WrapPanel><UniformGrid Columns="4" Margin="0,18,0,12"><Border Background="White" CornerRadius="10" Padding="15" Margin="4"><StackPanel><TextBlock Text="VENDAS"/><TextBlock x:Name="SalesText" FontSize="26" FontWeight="Bold"/></StackPanel></Border><Border Background="White" CornerRadius="10" Padding="15" Margin="4"><StackPanel><TextBlock Text="FATURAMENTO"/><TextBlock x:Name="RevenueText" FontSize="26" FontWeight="Bold"/></StackPanel></Border><Border Background="White" CornerRadius="10" Padding="15" Margin="4"><StackPanel><TextBlock Text="PEDIDOS PAGOS"/><TextBlock x:Name="OrdersText" FontSize="26" FontWeight="Bold"/></StackPanel></Border><Border Background="White" CornerRadius="10" Padding="15" Margin="4"><StackPanel><TextBlock Text="CANCELAMENTOS"/><TextBlock x:Name="CancelledText" FontSize="26" FontWeight="Bold"/></StackPanel></Border></UniformGrid><Border Background="White" CornerRadius="12" Padding="18"><Grid><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition/></Grid.ColumnDefinitions><StackPanel><TextBlock Text="FORMAS DE PAGAMENTO" FontSize="18" FontWeight="Bold" Margin="0,0,0,10"/><TextBlock x:Name="CashText" FontSize="16" Margin="0,5"/><TextBlock x:Name="PixText" FontSize="16" Margin="0,5"/><TextBlock x:Name="DebitText" FontSize="16" Margin="0,5"/><TextBlock x:Name="CreditText" FontSize="16" Margin="0,5"/></StackPanel><StackPanel Grid.Column="1"><TextBlock Text="CREDIÁRIO" FontSize="18" FontWeight="Bold" Margin="0,0,0,10"/><TextBlock x:Name="StoreCreditText" FontSize="16" Margin="0,5"/><TextBlock x:Name="CreditReceiptsText" FontSize="16" Margin="0,5"/><TextBlock Text="Pedidos aguardando pagamento não entram no faturamento nem no fechamento do caixa." TextWrapping="Wrap" Foreground="#8A5A00" Margin="0,18,0,0"/></StackPanel></Grid></Border><TextBlock Text="ONÇA PDV PRO • v0.1.22" FontSize="11" Foreground="#7B8781" HorizontalAlignment="Right" Margin="0,14,0,0"/></StackPanel></ScrollViewer></Window>''',encoding='utf-8')
(d/'Reports022Window.xaml.cs').write_text(r'''using System.Windows;using OncaPDV.Infrastructure;namespace OncaPDV.Desktop;public partial class Reports022Window:Window{private readonly ReportService022 _svc;private readonly AppPaths _paths;private Report022? _report;public Reports022Window(OncaDatabase db,AppPaths paths){_svc=new(db);_paths=paths;InitializeComponent();FromPicker.SelectedDate=DateTime.Today;ToPicker.SelectedDate=DateTime.Today;Loaded+=async(_,_)=>await Refresh();}private (DateTimeOffset From,DateTimeOffset To)Range(){var f=(FromPicker.SelectedDate??DateTime.Today).Date;var t=(ToPicker.SelectedDate??DateTime.Today).Date.AddDays(1);return(f,t);}private async Task Refresh(){var r=Range();_report=await _svc.LoadAsync(r.From,r.To);SalesText.Text=_report.Sales.ToString();RevenueText.Text=_report.Revenue.ToString("C");OrdersText.Text=_report.PaidOrders.ToString();CancelledText.Text=_report.CancelledSales.ToString();CashText.Text=$"Dinheiro: {_report.Cash:C}";PixText.Text=$"PIX: {_report.Pix:C}";DebitText.Text=$"Débito: {_report.Debit:C}";CreditText.Text=$"Crédito: {_report.Credit:C}";StoreCreditText.Text=$"Crediário gerado: {_report.StoreCredit:C}";CreditReceiptsText.Text=$"Crediário recebido: {_report.CreditReceipts:C}";}private async void Refresh_Click(object sender,RoutedEventArgs e)=>await Refresh();private async void Pdf_Click(object sender,RoutedEventArgs e){await Refresh();var r=Range();var file=await _svc.PdfAsync(_report!,r.From,r.To,_paths);MessageBox.Show($"PDF GERADO\n\n{file}","Relatório",MessageBoxButton.OK,MessageBoxImage.Information);}}''',encoding='utf-8')

# ---------- credit UI: safer edit = audited reversal + corrected receipt ----------
p=d/'CreditWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
x=x.replace('Width="1420" Height="820" MinWidth="1180" MinHeight="700"','Width="1280" Height="760" MinWidth="1000" MinHeight="640"')
x=x.replace('Content="↩  ESTORNAR RECEBIMENTO SELECIONADO" Click="ReverseReceipt_Click"','Content="✎  EDITAR / CORRIGIR RECEBIMENTO" Click="EditReceipt_Click"/><Button Style="{StaticResource SoftButton}" Content="🗑  APAGAR / ESTORNAR RECEBIMENTO" Click="ReverseReceipt_Click"')
p.write_text(x,encoding='utf-8')

p=d/'CreditWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
anchor='    private async void ReverseReceipt_Click(object sender,RoutedEventArgs e)'
edit=r'''    private async void EditReceipt_Click(object sender,RoutedEventArgs e)
    {
        if(Accounts.SelectedItem is not CreditView account || Movements.SelectedItem is not CreditMovement movement){MessageBox.Show("Selecione a conta e o recebimento que deseja corrigir.","Crediário");return;}
        var raw=Microsoft.VisualBasic.Interaction.InputBox($"Valor atual: {movement.Amount:C}\n\nDigite o novo valor:","Editar recebimento",movement.Amount.ToString("N2"));
        var culture=System.Globalization.CultureInfo.GetCultureInfo("pt-BR");if(!decimal.TryParse(raw,System.Globalization.NumberStyles.Number,culture,out var amount)||amount<=0){MessageBox.Show("Valor inválido.");return;}
        var reason=Microsoft.VisualBasic.Interaction.InputBox("Motivo da correção (obrigatório):","Editar recebimento","");if(string.IsNullOrWhiteSpace(reason))return;
        if(MessageBox.Show($"Corrigir {movement.Amount:C} para {amount:C}?\n\nO lançamento antigo será estornado com auditoria e um novo recebimento será criado.","Crediário",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
        try{
            await new AdvancedOperationsService(_db).ReverseCreditReceiptAsync(movement.Id,_operator,"CORREÇÃO: "+reason.Trim());
            var session=await new SqliteCashSessionRepository(_db,new SystemClock()).GetOrOpenAsync(_operator);
            await new SqliteCreditRepository(_db,new SystemClock()).ReceiveAsync(account.Id,amount,movement.Method,_operator,session.Id,$"CORREÇÃO DO RECEBIMENTO {movement.Id}: {reason.Trim()}");
            await Refresh();MessageBox.Show("Recebimento corrigido. O histórico anterior foi preservado e o caixa/saldo foram recalculados.","Crediário");
        }catch(Exception ex){MessageBox.Show(ex.Message,"Crediário",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

'''+anchor
if anchor not in c: raise RuntimeError('Credit reverse anchor missing')
c=c.replace(anchor,edit,1)
p.write_text(c,encoding='utf-8')

# ---------- auto display ----------
p=d/'DisplaySettingsWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
x=x.replace('<UniformGrid Columns="2" Margin="0,10,0,10">','<UniformGrid Columns="2" Margin="0,10,0,10">\n                    <Button Content="AUTOMÁTICO (RECOMENDADO)" Margin="5" Padding="12" Background="#0B6B3A" Foreground="White" Click="Auto_Click"/>',1)
x=x.replace('Mínimo seguro recomendado: 1240 × 760. Para telas menores, use maximizado.','Modo Automático usa a área útil e a escala do Windows. O ajuste manual continua disponível.')
p.write_text(x,encoding='utf-8')

p=d/'DisplaySettingsWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
insert=r'''    private void Auto_Click(object sender, RoutedEventArgs e)
    {
        _target.WindowState = WindowState.Maximized;
        try { var dir=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Onca PDV Pro"); System.IO.Directory.CreateDirectory(dir); System.IO.File.WriteAllText(System.IO.Path.Combine(dir,"terminal-ui.txt"),"0;0;AUTO"); } catch { }
        DialogResult = true;
    }
'''
anchor='    private void Size1366_Click'
if anchor not in c: raise RuntimeError('Display anchor missing')
c=c.replace(anchor,insert+'\n'+anchor,1)
p.write_text(c,encoding='utf-8')

# ---------- main code: orders + automatic screen + cut at end ----------
p=d/'MainWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
c=c.replace('private readonly CustomerService _customers;','private readonly CustomerService _customers;\n    private readonly OrderService022 _orders;\n    private Guid? _activeOrderId;')
c=c.replace('_database.Migrate();','_database.Migrate();\n        _orders = new OrderService022(_database);',1)
c=c.replace('if (!System.IO.File.Exists(file)) return;','if (!System.IO.File.Exists(file)) { ApplyAutomaticDisplaySettings(); return; }',1)
c=c.replace('if (p.Length < 3) return;','if (p.Length < 3) { ApplyAutomaticDisplaySettings(); return; }',1)
c=c.replace('if (p[2] == "MAX") { WindowState = WindowState.Maximized; return; }','if (p[2] == "AUTO") { ApplyAutomaticDisplaySettings(); return; }\n            if (p[2] == "MAX") { WindowState = WindowState.Maximized; return; }',1)
# printing: cut only after the complete cupom
c=c.replace('await _printer.PrintAsync(new(sale));','await _printer.PrintAsync(new(sale, Cut:true));')
c=c.replace('await _printer.PrintAsync(new(sale,IsReprint:true));','await _printer.PrintAsync(new(sale,IsReprint:true,Cut:true));')
# mark paid order immediately after sale persistence, before print prompt
needle='            var sale = await _workflow.CompleteAsync(dialog.Payments, OperatorId);\n            await RefreshSales();'
replacement='''            Guid? claimedOrder = null;
            if (_activeOrderId is Guid pendingOrder)
            {
                if (!await _orders.TryClaimForPaymentAsync(pendingOrder))
                {
                    MessageBox.Show("Este pedido já está sendo pago, foi pago ou foi alterado em outro terminal.", "Pedido", MessageBoxButton.OK, MessageBoxImage.Warning);
                    return;
                }
                claimedOrder = pendingOrder;
            }
            Sale sale;
            try { sale = await _workflow.CompleteAsync(dialog.Payments, OperatorId); }
            catch { if (claimedOrder is Guid releaseId) await _orders.ReleaseClaimAsync(releaseId); throw; }
            if (claimedOrder is Guid paidId)
            {
                await _orders.MarkPaidAsync(paidId, sale.Id, sale.Number);
                _activeOrderId = null;
            }
            await RefreshSales();'''
if needle not in c: raise RuntimeError('Complete sale anchor missing')
c=c.replace(needle,replacement,1)

# finalize button now asks Finalize vs Separate Order
old='    private async void Pay_Click(object sender, RoutedEventArgs e) => await CompletePaymentAsync();'
new=r'''    private async void Pay_Click(object sender, RoutedEventArgs e)
    {
        if (_workflow.Cart.Items.Count == 0) { SetStatus("CARRINHO VAZIO"); return; }
        var choice = new FinalizeChoiceWindow { Owner = this };
        if (choice.ShowDialog() != true) return;
        if (choice.SeparateOrder) { await SeparateOrderAsync(); return; }
        await CompletePaymentAsync();
    }

    private async Task SeparateOrderAsync()
    {
        Order022? existing = _activeOrderId is Guid oid ? await _orders.GetAsync(oid) : null;
        var suggested = existing?.Customer ?? (CustomerText.Text == "CONSUMIDOR" ? "" : CustomerText.Text);
        var w = new SeparateOrderWindow(_workflow.Cart.Total, suggested, existing?.Phone, existing?.Notes) { Owner = this };
        if (w.ShowDialog() != true) return;
        if (existing is null)
        {
            var created = await _orders.CreateAsync(_workflow.Cart.CustomerId, w.CustomerName, w.Phone, w.Notes, _workflow.Cart.Items.ToArray(), _workflow.Cart.Discount);
            SetStatus($"PEDIDO {created.Number:000000} SEPARADO — AGUARDANDO PAGAMENTO");
        }
        else
        {
            await _orders.UpdateAsync(existing.Id, _workflow.Cart.CustomerId, w.CustomerName, w.Phone, w.Notes, _workflow.Cart.Items.ToArray(), _workflow.Cart.Discount);
            SetStatus($"PEDIDO {existing.Number:000000} ATUALIZADO — AGUARDANDO PAGAMENTO");
        }
        await _workflow.CancelAsync(); _activeOrderId = null; RefreshCart(); SearchBox.Focus();
    }
'''
if old not in c: raise RuntimeError('Pay_Click anchor missing')
c=c.replace(old,new,1)

# replace old hold/recovery methods area with Orders manager while leaving legacy methods harmless
anchor='    private async void HoldSale_Click(object sender, RoutedEventArgs e)'
orders=r'''    private async void Orders_Click(object sender, RoutedEventArgs e)
    {
        var w = new OrdersWindow(_orders) { Owner = this };
        if (w.ShowDialog() != true || w.SelectedOrder is null) return;
        var o = w.SelectedOrder;
        if (_workflow.Cart.Items.Count > 0 && MessageBox.Show("Substituir o carrinho atual pelo pedido selecionado?", "Pedidos", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        await _workflow.CancelAsync();
        var cart = new Cart { CustomerId = o.CustomerId };
        foreach (var item in o.Items) cart.AddCustom(item.ProductId,item.Code,item.Name,item.Quantity,item.UnitPrice);
        cart.SetDiscount(o.Discount); await _workflow.ReplaceCartAsync(cart); _activeOrderId=o.Id; CustomerText.Text=o.Customer; RefreshCart();
        SetStatus($"PEDIDO {o.Number:000000} CARREGADO — {o.Customer}");
        if (w.Action == "Pay") await CompletePaymentAsync();
    }

    private void Reports022_Click(object sender, RoutedEventArgs e) => new Reports022Window(_database,_paths) { Owner=this }.ShowDialog();

    private void ApplyAutomaticDisplaySettings()
    {
        WindowState = WindowState.Maximized;
        var width = SystemParameters.WorkArea.Width;
        if (width < 1300) { NavColumn.Width = new GridLength(185); PaymentColumn.Width = new GridLength(315); }
        else if (width < 1600) { NavColumn.Width = new GridLength(205); PaymentColumn.Width = new GridLength(340); }
        else { NavColumn.Width = new GridLength(220); PaymentColumn.Width = new GridLength(370); }
    }

'''+anchor
if anchor not in c: raise RuntimeError('Hold anchor missing')
c=c.replace(anchor,orders,1)
# cancelling cart must never cancel the stored order
c=c.replace('        await _workflow.CancelAsync();\n        RefreshCart();\n        RecoveryText.Text = string.Empty;','        await _workflow.CancelAsync();\n        _activeOrderId = null;\n        RefreshCart();\n        RecoveryText.Text = string.Empty;',1)
p.write_text(c,encoding='utf-8')

print('FEATURES022_APPLIED=YES')
