from pathlib import Path

ROOT=Path('current')

def replace(path,old,new):
    p=ROOT/path
    s=p.read_text(encoding='utf-8-sig')
    if old not in s:
        raise SystemExit(f'pattern not found in {p}: {old[:100]!r}')
    p.write_text(s.replace(old,new),encoding='utf-8')

# MainWindow code: dynamic user/operator, protected backup, advanced handlers.
p=ROOT/'src/OncaPDV.Desktop/MainWindow.xaml.cs'
s=p.read_text(encoding='utf-8-sig')
s=s.replace('private static readonly Guid OperatorId = Guid.Parse("10000000-0000-0000-0000-000000000001");',
'''private Guid _operatorId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private PdvUser _activeUser = new(Guid.Parse("10000000-0000-0000-0000-000000000001"), "Administrador", UserRole.Administrator, "", "");''')
s=s.replace('_database.Migrate();','''_database.Migrate();
        new AdvancedOperationsService(_database, _paths).EnsureSchema();''',1)
s=s.replace('''        var recovered = await _workflow.InitializeAsync();
        RefreshCart();
        await RefreshSales();
        await new OperationalService(_database, _paths).EnsureDailyBackupAsync();
        DatabaseStatus.Text = $"Banco: {_database.IntegrityCheck()} • abertura {sw.ElapsedMilliseconds} ms • backup diário OK";''',
'''        _activeUser = await new AccessControlStore(_paths).ActiveUserAsync();
        _operatorId = _activeUser.Id;
        OperatorNameText.Text = _activeUser.Name;
        OperatorRoleText.Text = RoleName(_activeUser.Role);
        var recovered = await _workflow.InitializeAsync();
        RefreshCart();
        await RefreshSales();
        var backup = await new AdvancedOperationsService(_database, _paths).EnsureProtectedBackupAsync();
        DatabaseStatus.Text = $"Banco: {_database.IntegrityCheck()} • abertura {sw.ElapsedMilliseconds} ms • {backup.Message}";''')
s=s.replace('OperatorId','_operatorId')
s=s.replace('''            await _workflow.AddProductAsync(dialog.Product!, add);
            if (add) RefreshCart();''',
'''            await _workflow.AddProductAsync(dialog.Product!, add);
            await new AdvancedOperationsService(_database, _paths).SaveProductMetadataAsync(dialog.Product!.Id, dialog.ShelfLocation);
            if (add) RefreshCart();''')
s=s.replace('''        try
        {
            var sale = await _workflow.CompleteAsync(dialog.Payments, _operatorId);''',
'''        try
        {
            if (dialog.Payments.Any(x => x.Method == PaymentMethod.StoreCredit) && _workflow.Cart.CustomerId is Guid customerId)
            {
                var account = await new AdvancedOperationsService(_database, _paths).CustomerAccountAsync(customerId);
                var storeAmount = dialog.Payments.Where(x => x.Method == PaymentMethod.StoreCredit).Sum(x => x.Amount);
                if (account.CreditLimit > 0 && storeAmount > account.AvailableLimit)
                    throw new DomainException($"Limite de crediário insuficiente. Disponível: {account.AvailableLimit:C}.");
            }
            var sale = await _workflow.CompleteAsync(dialog.Payments, _operatorId);''')
s=s.replace('''    private void CustomerManagement_Click(object sender, RoutedEventArgs e) =>
        new CustomerSearchWindow(_customers, true) { Owner = this }.ShowDialog();''',
'''    private void CustomerManagement_Click(object sender, RoutedEventArgs e) =>
        new CustomerSearchWindow(_customers, true) { Owner = this }.ShowDialog();''')
s=s.replace('''    private void Reports_Click(object sender, RoutedEventArgs e) =>
        new OperationsWindow(_database, _paths, _operatorId, OperationsSection.Sales) { Owner = this }.ShowDialog();''',
'''    private async void Reports_Click(object sender, RoutedEventArgs e)
    {
        var w = new SaleManagementWindow(_database, _paths, _operatorId) { Owner = this };
        w.ShowDialog();
        if (w.CorrectionPrepared)
        {
            await _workflow.InitializeAsync();
            RefreshCart();
            SetStatus("VENDA CARREGADA PARA CORREÇÃO — CONFIRA E FINALIZE NOVAMENTE");
        }
        await RefreshSales();
        SearchBox.Focus();
    }''')
s=s.replace('''    private async void Product_Click(object sender, RoutedEventArgs e) => await OpenProduct();''',
'''    private async void Product_Click(object sender, RoutedEventArgs e)
    {
        if (!await CanManageProductsAsync()) return;
        await OpenProduct();
    }

    private async Task<bool> CanManageProductsAsync()
    {
        _activeUser = await new AccessControlStore(_paths).ActiveUserAsync();
        if (AccessControlStore.HasPermission(_activeUser.Role, UserRole.Stockkeeper)) return true;
        var auth = new AdminPinWindow(_paths, "Cadastro e alteração de produtos exigem Administrador ou Estoquista.") { Owner = this };
        return auth.ShowDialog() == true && auth.Authorized;
    }

    private async void SecuritySettings_Click(object sender, RoutedEventArgs e)
    {
        var auth = new AdminPinWindow(_paths, "Gerenciar usuários, permissões e backup automático.") { Owner = this };
        if (auth.ShowDialog() != true || !auth.Authorized) return;
        new SecuritySettingsWindow(_paths, _database) { Owner = this }.ShowDialog();
        _activeUser = await new AccessControlStore(_paths).ActiveUserAsync();
        _operatorId = _activeUser.Id;
        OperatorNameText.Text = _activeUser.Name;
        OperatorRoleText.Text = RoleName(_activeUser.Role);
    }

    private async void Discount_Click(object sender, RoutedEventArgs e)
    {
        if (_workflow.Cart.Items.Count == 0) return;
        if (!AuthorizeAdmin("Aplicar ou alterar desconto na venda.")) return;
        var w = new MoneyPromptWindow("Desconto da venda", _workflow.Cart.Discount) { Owner = this };
        if (w.ShowDialog() != true) return;
        try { await _workflow.SetDiscountAsync(w.Value); RefreshCart(); SetStatus($"DESCONTO APLICADO: {w.Value:C}"); }
        catch (DomainException ex) { MessageBox.Show(ex.Message, "Desconto", MessageBoxButton.OK, MessageBoxImage.Warning); }
        SearchBox.Focus();
    }

    private async void ChangePrice_Click(object sender, RoutedEventArgs e)
    {
        var row = SelectedCartRow();
        if (row is null) { SetStatus("SELECIONE UM ITEM PARA ALTERAR O PREÇO"); return; }
        if (!AuthorizeAdmin("Alterar preço unitário dentro da venda.")) return;
        var w = new MoneyPromptWindow($"Preço unitário — {row.Name}", row.UnitPrice) { Owner = this };
        if (w.ShowDialog() != true) return;
        await _workflow.ChangeUnitPriceAsync(row.ProductId, w.Value);
        RefreshCart(); SetStatus($"PREÇO ALTERADO: {row.Name} • {w.Value:C}"); SearchBox.Focus();
    }

    private bool AuthorizeAdmin(string reason)
    {
        if (_activeUser.Role == UserRole.Administrator) return true;
        var auth = new AdminPinWindow(_paths, reason) { Owner = this };
        return auth.ShowDialog() == true && auth.Authorized;
    }

    private static string RoleName(UserRole role) => role switch { UserRole.Administrator => "Administrador", UserRole.Cashier => "Caixa", UserRole.Stockkeeper => "Estoquista", _ => role.ToString() };''')
s=s.replace('''    private void Stock_Click(object sender, RoutedEventArgs e) =>
        new OperationsWindow(_database, _paths, _operatorId, OperationsSection.Stock) { Owner = this }.ShowDialog();''',
'''    private async void Stock_Click(object sender, RoutedEventArgs e)
    {
        _activeUser = await new AccessControlStore(_paths).ActiveUserAsync();
        if (!AccessControlStore.HasPermission(_activeUser.Role, UserRole.Stockkeeper))
        {
            var auth = new AdminPinWindow(_paths, "Acesso ao estoque exige Administrador ou Estoquista.") { Owner = this };
            if (auth.ShowDialog() != true || !auth.Authorized) return;
        }
        new OperationsWindow(_database, _paths, _operatorId, OperationsSection.Stock) { Owner = this }.ShowDialog();
    }''')
s=s.replace('''            IsReprint: isReprint,
            Company:''','''            OperatorName: _activeUser.Name,
            IsReprint: isReprint,
            Company:''')
p.write_text(s,encoding='utf-8')

# MainWindow visual wiring.
p=ROOT/'src/OncaPDV.Desktop/MainWindow.xaml'
s=p.read_text(encoding='utf-8-sig')
s=s.replace('''                    <Button Style="{StaticResource NavButton}" Content="⚙   Impressora" Click="Printer_Click"/>
                    <Button Style="{StaticResource NavButton}" Content="✓   Diagnóstico" Click="Diagnostic_Click"/>''',
'''                    <Button Style="{StaticResource NavButton}" Content="⚙   Impressora" Click="Printer_Click"/>
                    <Button Style="{StaticResource NavButton}" Content="🔐   Usuários / Backup" Click="SecuritySettings_Click"/>
                    <Button Style="{StaticResource NavButton}" Content="✓   Diagnóstico" Click="Diagnostic_Click"/>''')
s=s.replace('''<StackPanel><TextBlock Text="Caixa" FontSize="11" Foreground="#7B8881"/><TextBlock Text="Administrador" FontWeight="Bold" Foreground="#29352F"/></StackPanel>''',
'''<StackPanel><TextBlock x:Name="OperatorRoleText" Text="Administrador" FontSize="11" Foreground="#7B8881"/><TextBlock x:Name="OperatorNameText" Text="Administrador" FontWeight="Bold" Foreground="#29352F"/></StackPanel>''')
s=s.replace('''<Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>''',
'''<Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>''',1)
s=s.replace('''                        <Button Grid.Column="4" Style="{StaticResource SoftButton}" Content="👤 CLIENTE [F4]" Click="Customer_Click"/>
                        <Button Grid.Column="5" Style="{StaticResource SoftButton}" Content="🧾 CUPOM" Click="Preview_Click"/>''',
'''                        <Button Grid.Column="4" Style="{StaticResource SoftButton}" Content="% DESCONTO" Click="Discount_Click"/>
                        <Button Grid.Column="5" Style="{StaticResource SoftButton}" Content="R$ PREÇO" Click="ChangePrice_Click"/>
                        <Button Grid.Column="6" Style="{StaticResource SoftButton}" Content="👤 CLIENTE [F4]" Click="Customer_Click"/>
                        <Button Grid.Column="7" Style="{StaticResource SoftButton}" Content="🧾 CUPOM" Click="Preview_Click"/>''')
p.write_text(s,encoding='utf-8')

# Operations product metadata shelf load/save.
p=ROOT/'src/OncaPDV.Desktop/OperationsWindow.xaml.cs'
s=p.read_text(encoding='utf-8-sig')
s=s.replace('''        var dialog = new ProductWindow(existing: product) { Owner = this };
        if (dialog.ShowDialog() != true || dialog.Product is null) return;
        try
        {
            await repo.SaveAsync(dialog.Product);''',
'''        var advanced = new AdvancedOperationsService(_db, _paths);
        var metadata = await advanced.ProductMetadataAsync(product.Id);
        var dialog = new ProductWindow(existing: product, shelfLocation: metadata.ShelfLocation) { Owner = this };
        if (dialog.ShowDialog() != true || dialog.Product is null) return;
        try
        {
            await repo.SaveAsync(dialog.Product);
            await advanced.SaveProductMetadataAsync(dialog.Product.Id, dialog.ShelfLocation);''')
p.write_text(s,encoding='utf-8')

# Customer management: double-click/history already opens enhanced account; add clearer title via XAML.
p=ROOT/'src/OncaPDV.Desktop/CustomerSearchWindow.xaml'
s=p.read_text(encoding='utf-8-sig')
s=s.replace('Histórico','Cliente / Crediário')
p.write_text(s,encoding='utf-8')

print('0.1.6 wiring applied')
