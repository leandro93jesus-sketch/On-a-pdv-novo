from pathlib import Path
import re

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'
i=root/'src'/'OncaPDV.Infrastructure'

# Reuse ONLY the proven inventory portion from the later patch.
src=Path('scripts/apply_fix_026_stock_cash.py').read_text(encoding='utf-8')
a=src.index("# --- Inventory service:")
b=src.index("# --- Cash closing fix:", a)
segment=src[a:b]
exec(segment, {'Path':Path,'root':root,'d':d,'i':i})

# Inventory must show whole quantities and expose product registration.
p=d/'InventoryWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
x=x.replace('StringFormat=N3','StringFormat=N0')
x=x.replace('Text="PRODUTOS / ESTOQUE"','Text="ESTOQUE"')
x=x.replace('Title="Produtos / Estoque — ONÇA PDV PRO 0.1.26"','Title="ESTOQUE — ONÇA PDV PRO"')
if 'Click="NewProduct_Click"' not in x:
    x=x.replace('<Button Content="EDITAR PRODUTO"','<Button Content="CADASTRAR PRODUTO" Padding="14,10" Margin="4" Background="#0B6B3A" Foreground="White" Click="NewProduct_Click"/><Button Content="EDITAR / ALTERAR PREÇO"',1)
p.write_text(x,encoding='utf-8')

p=d/'InventoryWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
if 'NewProduct_Click' not in c:
    anchor='    private async void Edit_Click'
    handler='''    private async void NewProduct_Click(object s,RoutedEventArgs e){var w=new ProductWindow(null){Owner=this};if(w.ShowDialog()!=true||w.Product is null)return;try{await _svc.SaveProductAsync(w.Product);SearchBox.Text="";await Refresh();MessageBox.Show("Produto cadastrado.","ESTOQUE");}catch(Exception ex){MessageBox.Show(ex.Message,"ESTOQUE",MessageBoxButton.OK,MessageBoxImage.Warning);}}\n'''
    if anchor not in c: raise RuntimeError('Inventory edit anchor missing')
    c=c.replace(anchor,handler+anchor,1)
p.write_text(c,encoding='utf-8')

# Empty inventory search must list all registered products.
p=i/'InventoryService026.cs'
c=p.read_text(encoding='utf-8-sig')
old='''    public Task<IReadOnlyList<Product>> SearchAsync(string term, CancellationToken ct=default)
        => new SqliteProductRepository(_db).SearchAsync(term ?? "", ct);'''
new='''    public async Task<IReadOnlyList<Product>> SearchAsync(string term, CancellationToken ct=default)
    {
        var repo=new SqliteProductRepository(_db);
        if(!string.IsNullOrWhiteSpace(term)) return await repo.SearchAsync(term.Trim(),ct);
        var all=new List<Product>();
        foreach(var prefix in new[]{"","0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"})
            foreach(var p in await repo.SearchAsync(prefix,ct))
                if(!all.Any(x=>x.Id==p.Id)) all.Add(p);
        return all.OrderBy(x=>x.Name,StringComparer.CurrentCultureIgnoreCase).ToList();
    }'''
if old in c: c=c.replace(old,new,1)
p.write_text(c,encoding='utf-8')

# Main navigation: preserve everything already present and add explicit requested actions.
p=d/'MainWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
orders='<Button Style="{StaticResource NavButton}" Content="📦   Pedidos" Click="Orders_Click"/>'
extras='''<Button Style="{StaticResource NavButton}" Content="⏸   VENDA EM ESPERA" Click="HoldSale_Click"/>
                    <Button Style="{StaticResource NavButton}" Content="✖   CANCELAR VENDA ATUAL" Click="CancelCurrentStable_Click"/>
                    <Button Style="{StaticResource NavButton}" Content="🧾   VENDAS REALIZADAS" Click="CompletedSalesStable_Click"/>'''
if 'Click="CancelCurrentStable_Click"' not in x:
    if orders not in x: raise RuntimeError('Orders navigation anchor missing')
    x=x.replace(orders,orders+'\n                    '+extras,1)

# Route the existing product button to the inventory screen, avoiding two confusing stock areas.
x=x.replace('Content="▦   Produtos" Click="Product_Click"','Content="▦   ESTOQUE" Click="Inventory026_Click"',1)
# Remove only the extra inventory button inserted by the reused segment if present.
x=re.sub(r'\s*<Button Style="\{StaticResource NavButton\}" Content="📦\s+Produtos / Estoque" Click="Inventory026_Click"/>','',x)
p.write_text(x,encoding='utf-8')

# Re-enable the original held-sales tab that 0.1.22 had hidden.
p=d/'FinalOperationsWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
x=x.replace('<TabItem Header="VENDAS EM ESPERA" Visibility="Collapsed">','<TabItem Header="VENDAS EM ESPERA">',1)
p.write_text(x,encoding='utf-8')

# Add safe current-cart cancellation and direct access to already completed sales.
p=d/'MainWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
anchor='    private void Reports022_Click'
if anchor not in c: raise RuntimeError('Main handler anchor missing')
handlers=r'''    private async void CancelCurrentStable_Click(object sender, RoutedEventArgs e)
    {
        if (_workflow.Cart.Items.Count == 0) { MessageBox.Show("Não há venda atual para cancelar.","Cancelar venda"); return; }
        if (MessageBox.Show($"Cancelar a venda atual de {_workflow.Cart.Total:C}?\n\nSomente o carrinho atual será limpo. Vendas já concluídas não serão alteradas.","Cancelar venda atual",MessageBoxButton.YesNo,MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        await _workflow.CancelAsync();
        _activeOrderId = null;
        RefreshCart();
        RecoveryText.Text = string.Empty;
        SearchBox.Focus();
        SetStatus("VENDA ATUAL CANCELADA");
    }

    private void CompletedSalesStable_Click(object sender, RoutedEventArgs e)
    {
        var w=new SalesManagementWindow(_database,_workflow,OperatorId,_printer,_renderer){Owner=this};
        if(w.ShowDialog()==true && w.CartChanged) RefreshCart();
    }

'''
if 'CancelCurrentStable_Click(object' not in c:
    c=c.replace(anchor,handlers+anchor,1)
p.write_text(c,encoding='utf-8')

print('ONCA_STABLE_PLUS_APPLIED=YES')
