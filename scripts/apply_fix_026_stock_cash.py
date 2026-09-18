from pathlib import Path

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'
i=root/'src'/'OncaPDV.Infrastructure'

# Build exactly on top of 0.1.25.
exec(Path('scripts/apply_ui_025.py').read_text(encoding='utf-8'), {})

# --- Inventory service: explicit, audited stock movements. ---
(i/'InventoryService026.cs').write_text(r'''using Microsoft.Data.Sqlite;
using OncaPDV.Domain;

namespace OncaPDV.Infrastructure;

public sealed record StockMovement026(Guid Id, string Type, decimal Quantity, string Reason, DateTimeOffset CreatedAt);
public sealed class InventoryService026
{
    private readonly OncaDatabase _db;
    public InventoryService026(OncaDatabase db) => _db=db;

    public Task<IReadOnlyList<Product>> SearchAsync(string term, CancellationToken ct=default)
        => new SqliteProductRepository(_db).SearchAsync(term ?? "", ct);

    public Task SaveProductAsync(Product product, CancellationToken ct=default)
        => new SqliteProductRepository(_db).SaveAsync(product, ct);

    public async Task<decimal> MoveAsync(Guid productId, decimal quantity, string type, string reason, CancellationToken ct=default)
    {
        if (quantity == 0) throw new DomainException("INFORME UMA QUANTIDADE DIFERENTE DE ZERO.");
        reason=(reason??"").Trim();
        if (reason.Length < 2) throw new DomainException("INFORME O MOTIVO DO AJUSTE.");
        await using var c=_db.Open();
        await using var tx=await c.BeginTransactionAsync(ct);
        decimal before;
        await using(var q=c.CreateCommand()){
            q.Transaction=(SqliteTransaction)tx;
            q.CommandText="SELECT stock FROM products WHERE id=$id";
            q.Parameters.AddWithValue("$id",productId.ToString());
            var value=await q.ExecuteScalarAsync(ct);
            if(value is null) throw new DomainException("PRODUTO NÃO ENCONTRADO.");
            before=Convert.ToDecimal(value);
        }
        var after=before+quantity;
        await using(var q=c.CreateCommand()){
            q.Transaction=(SqliteTransaction)tx;
            q.CommandText="UPDATE products SET stock=$stock WHERE id=$id";
            q.Parameters.AddWithValue("$stock",after);
            q.Parameters.AddWithValue("$id",productId.ToString());
            if(await q.ExecuteNonQueryAsync(ct)!=1) throw new DomainException("NÃO FOI POSSÍVEL ATUALIZAR O ESTOQUE.");
        }
        await using(var q=c.CreateCommand()){
            q.Transaction=(SqliteTransaction)tx;
            q.CommandText="INSERT INTO stock_movements(id,product_id,type,quantity,origin_id,reason,created_at) VALUES($mid,$pid,$type,$qty,$origin,$reason,$at)";
            q.Parameters.AddWithValue("$mid",Guid.NewGuid().ToString());
            q.Parameters.AddWithValue("$pid",productId.ToString());
            q.Parameters.AddWithValue("$type",type);
            q.Parameters.AddWithValue("$qty",quantity);
            q.Parameters.AddWithValue("$origin",productId.ToString());
            q.Parameters.AddWithValue("$reason",reason);
            q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));
            await q.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);
        return after;
    }

    public async Task<decimal> SetBalanceAsync(Guid productId, decimal newBalance, string reason, CancellationToken ct=default)
    {
        await using var c=_db.Open();
        await using var q=c.CreateCommand();
        q.CommandText="SELECT stock FROM products WHERE id=$id";
        q.Parameters.AddWithValue("$id",productId.ToString());
        var value=await q.ExecuteScalarAsync(ct);
        if(value is null) throw new DomainException("PRODUTO NÃO ENCONTRADO.");
        var before=Convert.ToDecimal(value);
        var diff=newBalance-before;
        if(diff==0) return before;
        return await MoveAsync(productId,diff,"Inventory","INVENTÁRIO / AJUSTE DE SALDO: "+reason,ct);
    }

    public async Task<IReadOnlyList<StockMovement026>> HistoryAsync(Guid productId,CancellationToken ct=default)
    {
        var list=new List<StockMovement026>();
        await using var c=_db.Open(); await using var q=c.CreateCommand();
        q.CommandText="SELECT id,type,quantity,reason,created_at FROM stock_movements WHERE product_id=$id ORDER BY created_at DESC LIMIT 100";
        q.Parameters.AddWithValue("$id",productId.ToString());
        await using var r=await q.ExecuteReaderAsync(ct);
        while(await r.ReadAsync(ct)) list.Add(new(Guid.Parse(r.GetString(0)),r.GetString(1),r.GetDecimal(2),r.GetString(3),DateTimeOffset.Parse(r.GetString(4))));
        return list;
    }
}
''',encoding='utf-8')

(d/'InventoryWindow.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.InventoryWindow" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Title="Produtos / Estoque — ONÇA PDV PRO 0.1.26" Width="1180" Height="760" MinWidth="980" MinHeight="620" WindowStartupLocation="CenterOwner" Background="#F7F9F8">
<Grid Margin="18"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition/><RowDefinition Height="Auto"/><RowDefinition Height="180"/></Grid.RowDefinitions>
<StackPanel><TextBlock Text="PRODUTOS / ESTOQUE" FontSize="28" FontWeight="Bold" Foreground="#0B6B3A"/><TextBlock Text="Pesquise um produto para editar cadastro, dar entrada, saída ou ajustar o saldo físico." Foreground="#66746C"/></StackPanel>
<Grid Grid.Row="1" Margin="0,14"><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><TextBox x:Name="SearchBox" FontSize="16" Padding="10" KeyDown="SearchBox_KeyDown"/><Button Grid.Column="1" Content="BUSCAR" Padding="22,10" Margin="8,0,0,0" Background="#0B6B3A" Foreground="White" Click="Search_Click"/></Grid>
<DataGrid Grid.Row="2" x:Name="Grid" AutoGenerateColumns="False" IsReadOnly="True" SelectionMode="Single" SelectionChanged="Grid_SelectionChanged" RowHeight="38" Background="White"><DataGrid.Columns><DataGridTextColumn Header="CÓDIGO" Binding="{Binding InternalCode}" Width="130"/><DataGridTextColumn Header="PRODUTO" Binding="{Binding Name}" Width="2*"/><DataGridTextColumn Header="BARRAS" Binding="{Binding Barcode}" Width="170"/><DataGridTextColumn Header="ESTOQUE" Binding="{Binding Stock,StringFormat=N3}" Width="110"/><DataGridTextColumn Header="PREÇO" Binding="{Binding SalePrice,StringFormat=C}" Width="120"/><DataGridCheckBoxColumn Header="ATIVO" Binding="{Binding Active}" Width="70"/></DataGrid.Columns></DataGrid>
<Grid Grid.Row="3" Margin="0,12"><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><TextBlock x:Name="SelectedText" VerticalAlignment="Center" FontSize="17" FontWeight="SemiBold" Text="Selecione um produto."/><WrapPanel Grid.Column="1"><Button Content="EDITAR PRODUTO" Padding="14,10" Margin="4" Click="Edit_Click"/><Button Content="+ ENTRADA" Padding="14,10" Margin="4" Background="#0B6B3A" Foreground="White" Click="Entry_Click"/><Button Content="- SAÍDA" Padding="14,10" Margin="4" Background="#A63A32" Foreground="White" Click="Exit_Click"/><Button Content="AJUSTAR SALDO" Padding="14,10" Margin="4" Click="Balance_Click"/></WrapPanel></Grid>
<GroupBox Grid.Row="4" Header="HISTÓRICO DO PRODUTO"><DataGrid x:Name="HistoryGrid" AutoGenerateColumns="False" IsReadOnly="True"><DataGrid.Columns><DataGridTextColumn Header="DATA" Binding="{Binding CreatedAt,StringFormat=dd/MM/yyyy HH:mm}" Width="160"/><DataGridTextColumn Header="TIPO" Binding="{Binding Type}" Width="130"/><DataGridTextColumn Header="MOVIMENTO" Binding="{Binding Quantity,StringFormat=N3}" Width="120"/><DataGridTextColumn Header="MOTIVO" Binding="{Binding Reason}" Width="*"/></DataGrid.Columns></DataGrid></GroupBox>
</Grid></Window>''',encoding='utf-8')

(d/'InventoryWindow.xaml.cs').write_text(r'''using System.Globalization;
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
    private async void Grid_SelectionChanged(object s,SelectionChangedEventArgs e){if(Selected is not Product p){SelectedText.Text="Selecione um produto.";HistoryGrid.ItemsSource=null;return;}SelectedText.Text=$"{p.Name}  •  Estoque atual: {p.Stock:N3} {p.Unit}";HistoryGrid.ItemsSource=await _svc.HistoryAsync(p.Id);}
    private async void Edit_Click(object s,RoutedEventArgs e){var p=Need();if(p is null)return;var w=new ProductWindow(null,p){Owner=this};if(w.ShowDialog()!=true||w.Product is null)return;try{await _svc.SaveProductAsync(w.Product);await Refresh();MessageBox.Show("Produto atualizado. O estoque não foi alterado.","Produtos / Estoque");}catch(Exception ex){MessageBox.Show(ex.Message,"Produtos / Estoque",MessageBoxButton.OK,MessageBoxImage.Warning);}}
    private async void Entry_Click(object s,RoutedEventArgs e){var p=Need();if(p is null)return;await Move(p,true);}
    private async void Exit_Click(object s,RoutedEventArgs e){var p=Need();if(p is null)return;await Move(p,false);}
    private async Task Move(Product p,bool entry){var raw=Interaction.InputBox($"Estoque atual: {p.Stock:N3}\n\nQuantidade para {(entry?"ENTRADA":"SAÍDA")}:","Movimentar estoque","1");if(!TryDecimal(raw,out var q)||q<=0){if(raw.Length>0)MessageBox.Show("Quantidade inválida.");return;}var reason=Interaction.InputBox("Motivo da movimentação:","Movimentar estoque",entry?"ENTRADA MANUAL":"SAÍDA / PERDA / AJUSTE");if(string.IsNullOrWhiteSpace(reason))return;var signed=entry?q:-q;var after=p.Stock+signed;if(MessageBox.Show($"Produto: {p.Name}\nAnterior: {p.Stock:N3}\nMovimento: {signed:+0.###;-0.###}\nNovo saldo: {after:N3}\n\nConfirmar?","Estoque",MessageBoxButton.YesNo,MessageBoxImage.Question)!=MessageBoxResult.Yes)return;try{await _svc.MoveAsync(p.Id,signed,entry?"Adjustment":"Adjustment",reason);await Refresh();MessageBox.Show($"Estoque atualizado para {after:N3}.","Estoque");}catch(Exception ex){MessageBox.Show(ex.Message,"Estoque",MessageBoxButton.OK,MessageBoxImage.Warning);}}
    private async void Balance_Click(object s,RoutedEventArgs e){var p=Need();if(p is null)return;var raw=Interaction.InputBox($"Estoque atual: {p.Stock:N3}\n\nDigite a CONTAGEM FÍSICA correta:","Ajustar saldo",p.Stock.ToString("N3"));if(!TryDecimal(raw,out var v))return;var reason=Interaction.InputBox("Motivo do ajuste / inventário:","Ajustar saldo","CONTAGEM FÍSICA");if(string.IsNullOrWhiteSpace(reason))return;if(MessageBox.Show($"Alterar saldo de {p.Stock:N3} para {v:N3}?\n\nA diferença ficará registrada no histórico.","Ajustar saldo",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;try{await _svc.SetBalanceAsync(p.Id,v,reason);await Refresh();}catch(Exception ex){MessageBox.Show(ex.Message,"Estoque",MessageBoxButton.OK,MessageBoxImage.Warning);}}
    private Product? Need(){if(Selected is Product p)return p;MessageBox.Show("Selecione um produto primeiro.","Produtos / Estoque");return null;}
    private static bool TryDecimal(string s,out decimal v)=>decimal.TryParse(s,NumberStyles.Number,CultureInfo.GetCultureInfo("pt-BR"),out v)||decimal.TryParse(s,NumberStyles.Number,CultureInfo.InvariantCulture,out v);
}
''',encoding='utf-8')

# Add visible navigation without removing any existing button.
p=d/'MainWindow.xaml'; x=p.read_text(encoding='utf-8-sig')
anchor='<Button Style="{StaticResource NavButton}" Content="▦   Produtos" Click="Product_Click"/>'
if anchor in x:
    x=x.replace(anchor,anchor+'\n                    <Button Style="{StaticResource NavButton}" Content="📦   Produtos / Estoque" Click="Inventory026_Click"/>',1)
else:
    anchor='Click="Product_Click"'
    pos=x.find(anchor)
    if pos<0: raise RuntimeError('Product navigation anchor missing')
    end=x.find('/>',pos)+2
    x=x[:end]+'\n                    <Button Style="{StaticResource NavButton}" Content="📦   Produtos / Estoque" Click="Inventory026_Click"/>'+x[end:]
x=x.replace('v0.1.25','v0.1.26').replace('0.1.25','0.1.26')
p.write_text(x,encoding='utf-8')

p=d/'MainWindow.xaml.cs'; c=p.read_text(encoding='utf-8-sig')
anchor='    private void Reports022_Click'
if anchor not in c: raise RuntimeError('MainWindow handler anchor missing')
c=c.replace(anchor,'    private void Inventory026_Click(object sender, RoutedEventArgs e) => new InventoryWindow(_database) { Owner=this }.ShowDialog();\n\n'+anchor,1)
p.write_text(c,encoding='utf-8')

# --- Cash closing fix: atomic close + no misleading "failed close" when PDF/backup fails afterwards. ---
p=i/'OperationalServices.cs'; c=p.read_text(encoding='utf-8-sig')
start=c.find(' public async Task<CashClosing> CloseCashAsync(')
end=c.find('\n public ',start+10)
if start<0 or end<0: raise RuntimeError('CloseCashAsync anchor missing')
new=r''' public async Task<CashClosing> CloseCashAsync(Guid operatorId,decimal informed,CancellationToken ct=default)
 {
   await using var c=db.Open(); await using var tx=await c.BeginTransactionAsync(ct);
   Guid id; decimal opening;
   await using(var q=c.CreateCommand()){
     q.Transaction=(SqliteTransaction)tx;
     q.CommandText="SELECT id,opening_amount FROM cash_sessions WHERE operator_id=$op AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1";
     q.Parameters.AddWithValue("$op",operatorId.ToString());
     await using var r=await q.ExecuteReaderAsync(ct);
     if(!await r.ReadAsync(ct)) throw new InvalidOperationException("CAIXA NÃO ESTÁ ABERTO.");
     id=Guid.Parse(r.GetString(0)); opening=r.GetDecimal(1);
   }
   decimal cash=0,pix=0,debit=0,credit=0,receipts=0,supply=0,withdrawal=0;
   await using(var q=c.CreateCommand()){
     q.Transaction=(SqliteTransaction)tx;
     q.CommandText="""SELECT
COALESCE(SUM(CASE WHEN type='Sale' AND reason='Cash' THEN amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN type='Sale' AND reason='Pix' THEN amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN type='Sale' AND reason='Debit' THEN amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN type='Sale' AND reason='Credit' THEN amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN type='StoreCreditReceipt' THEN amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN type='Supply' THEN amount ELSE 0 END),0),
COALESCE(SUM(CASE WHEN type='Withdrawal' THEN amount ELSE 0 END),0)
FROM cash_movements WHERE session_id=$id""";
     q.Parameters.AddWithValue("$id",id.ToString());
     await using var r=await q.ExecuteReaderAsync(ct);
     if(await r.ReadAsync(ct)){cash=r.GetDecimal(0);pix=r.GetDecimal(1);debit=r.GetDecimal(2);credit=r.GetDecimal(3);receipts=r.GetDecimal(4);supply=r.GetDecimal(5);withdrawal=r.GetDecimal(6);}
   }
   decimal store;
   await using(var q=c.CreateCommand()){
     q.Transaction=(SqliteTransaction)tx;
     q.CommandText="SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.cash_session_id=$id AND p.method='StoreCredit'";
     q.Parameters.AddWithValue("$id",id.ToString()); store=Convert.ToDecimal(await q.ExecuteScalarAsync(ct));
   }
   var expected=opening+cash+receipts+supply-withdrawal;
   await using(var q=c.CreateCommand()){
     q.Transaction=(SqliteTransaction)tx;
     q.CommandText="UPDATE cash_sessions SET closed_at=$at,informed_total=$v WHERE id=$id AND closed_at IS NULL";
     q.Parameters.AddWithValue("$at",DateTimeOffset.Now.ToString("O"));q.Parameters.AddWithValue("$v",informed);q.Parameters.AddWithValue("$id",id.ToString());
     if(await q.ExecuteNonQueryAsync(ct)!=1) throw new InvalidOperationException("O CAIXA JÁ FOI FECHADO OU ALTERADO.");
   }
   await tx.CommitAsync(ct);
   return new(id,opening,cash,pix,debit,credit,store,receipts,withdrawal,supply,expected,informed,informed-expected);
 }'''
c=c[:start]+new+c[end:]
p.write_text(c,encoding='utf-8')

p=d/'OperationsWindow.xaml.cs'; c=p.read_text(encoding='utf-8-sig')
start=c.find(' private async void Close_Click(')
end=c.find('\n private ',start+10)
if start<0 or end<0: raise RuntimeError('Close_Click anchor missing')
new=r''' private async void Close_Click(object s,RoutedEventArgs e)
 {
   if(!decimal.TryParse(Informed.Text,System.Globalization.NumberStyles.Number,System.Globalization.CultureInfo.GetCultureInfo("pt-BR"),out var v)){MessageBox.Show("Valor informado inválido.");return;}
   if(MessageBox.Show($"Confirmar fechamento do caixa com valor contado de {v:C}?","Fechar caixa",MessageBoxButton.YesNo,MessageBoxImage.Question)!=MessageBoxResult.Yes)return;
   try{
     var x=await _ops.CloseCashAsync(_operator,v);
     ClosingText.Text=$"CAIXA FECHADO COM SUCESSO\nEsperado: {x.Expected:C}\nInformado: {x.Informed:C}\nDiferença: {x.Difference:C}";
     try{var pdf=await _ops.ClosingPdfAsync(x);ClosingText.Text+=$"\nPDF: {pdf}";}catch(Exception ex){ClosingText.Text+=$"\nAviso: caixa fechado, mas o PDF não foi gerado: {ex.Message}";}
     try{var backup=await _ops.CreateBackupAsync();ClosingText.Text+=$"\nBackup: {backup}";LoadBackups();}catch(Exception ex){ClosingText.Text+=$"\nAviso: caixa fechado, mas o backup pós-fechamento falhou: {ex.Message}";}
   }catch(Exception ex){MessageBox.Show("NÃO FOI POSSÍVEL FECHAR O CAIXA.\n\n"+ex.Message,"Fechar caixa",MessageBoxButton.OK,MessageBoxImage.Warning);}
 }'''
c=c[:start]+new+c[end:]
p.write_text(c,encoding='utf-8')

print('ONCA_026_PATCH_APPLIED=YES')
