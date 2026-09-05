using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using OncaPDV.Application;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;
using OncaPDV.Printing;

namespace OncaPDV.Desktop;

public partial class MainWindow : Window
{
    private const string TerminalId = "CAIXA-01";
    private Guid _operatorId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private PdvUser _activeUser = new(Guid.Parse("10000000-0000-0000-0000-000000000001"), "Administrador", UserRole.Administrator, "", "");
    private readonly AppPaths _paths = AppPaths.Default();
    private readonly OncaDatabase _database;
    private readonly PosWorkflow _workflow;
    private readonly CustomerService _customers;
    private readonly CompanyReceiptProfileStore _companyProfile;
    private readonly ObservableCollection<CartRow> _rows = [];
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };

    public MainWindow()
    {
        InitializeComponent();
        _database = new(_paths);
        AppServices.Database = _database;
        AppServices.Paths = _paths;
        _database.Migrate();
        new AdvancedOperationsService(_database, _paths).EnsureSchema();

        var products = new SqliteProductRepository(_database);
        var sales = new SqliteSaleRepository(_database, new SystemClock());
        var customerRepository = new SqliteCustomerRepository(_database);
        _customers = new(customerRepository);
        _companyProfile = new(_paths);
        _workflow = new(
            products,
            new JsonCartRecoveryStore(_paths),
            sales,
            new SqliteCashSessionRepository(_database, new SystemClock()),
            new SystemClock());
        CartGrid.ItemsSource = _rows;
        _timer.Tick += (_, _) => ClockText.Text = DateTime.Now.ToString("ddd, dd/MM/yyyy  HH:mm:ss");
        _timer.Start();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        _activeUser = await new AccessControlStore(_paths).ActiveUserAsync();
        _operatorId = _activeUser.Id;
        OperatorNameText.Text = _activeUser.Name;
        OperatorRoleText.Text = RoleName(_activeUser.Role);
        var recovered = await _workflow.InitializeAsync();
        RefreshCart();
        await RefreshSales();
        var backup = await new AdvancedOperationsService(_database, _paths).EnsureProtectedBackupAsync();
        DatabaseStatus.Text = $"Banco: {_database.IntegrityCheck()} • abertura {sw.ElapsedMilliseconds} ms • {backup.Message}";
        RecoveryText.Text = recovered ? "⚠ CARRINHO RECUPERADO DE UMA SESSÃO ANTERIOR" : "✓ Venda atual protegida por recuperação automática";
        SearchBox.Focus();
    }

    private async Task AddProduct()
    {
        var query = SearchBox.Text.Trim();
        if (query.Length == 0) return;

        var result = await _workflow.ScanAsync(query);
        if (result.Status == ScanStatus.DuplicateBlocked)
        {
            SetStatus("LEITURA DUPLICADA BLOQUEADA");
            return;
        }

        if (result.Status == ScanStatus.NotFound)
        {
            SetStatus("PRODUTO NÃO CADASTRADO");
            if (MessageBox.Show(
                    "PRODUTO NÃO CADASTRADO\n\nCadastrar agora?\n\nO carrinho será preservado.",
                    "ONÇA PDV",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Question) == MessageBoxResult.Yes)
            {
                await OpenProduct(query, true);
            }

            SearchBox.SelectAll();
            return;
        }

        RefreshCart();
        SetStatus(result.Product!.Name);
        SearchBox.Clear();
        SearchBox.Focus();
    }

    private async Task OpenProduct(string? barcode = null, bool add = false)
    {
        var dialog = new ProductWindow(barcode) { Owner = this };
        if (dialog.ShowDialog() != true) return;

        try
        {
            await _workflow.AddProductAsync(dialog.Product!, add);
            await new AdvancedOperationsService(_database, _paths).SaveProductMetadataAsync(dialog.Product!.Id, dialog.ShelfLocation);
            if (add) RefreshCart();
            SetStatus("PRODUTO CADASTRADO");
        }
        catch (Exception ex) when (ex is DuplicateProductException or DomainException)
        {
            MessageBox.Show(ex.Message, "Cadastro", MessageBoxButton.OK, MessageBoxImage.Warning);
        }

        SearchBox.Focus();
    }

    private async Task CompletePaymentAsync(PaymentMethod? initialMethod = null)
    {
        if (_workflow.Cart.Items.Count == 0)
        {
            SetStatus("CARRINHO VAZIO");
            return;
        }

        var dialog = new PaymentWindow(_workflow.Cart.Total, initialMethod ?? PaymentMethod.Cash) { Owner = this };
        if (dialog.ShowDialog() != true) return;

        try
        {
            if (dialog.Payments.Any(x => x.Method == PaymentMethod.StoreCredit) && _workflow.Cart.CustomerId is Guid customerId)
            {
                var account = await new AdvancedOperationsService(_database, _paths).CustomerAccountAsync(customerId);
                var storeAmount = dialog.Payments.Where(x => x.Method == PaymentMethod.StoreCredit).Sum(x => x.Amount);
                if (account.CreditLimit > 0 && storeAmount > account.AvailableLimit)
                    throw new DomainException($"Limite de crediário insuficiente. Disponível: {account.AvailableLimit:C}.");
            }
            var sale = await _workflow.CompleteAsync(dialog.Payments, _operatorId);
            var printed = await PrintSaleAsync(sale);
            await RefreshSales();
            RefreshCart();

            var cash = sale.Payments.Where(x => x.Method == PaymentMethod.Cash).ToArray();
            var received = cash.Sum(x => x.Received ?? x.Amount);
            var change = cash.Sum(x => x.Change);
            var cashSummary = cash.Length == 0 ? string.Empty : $"\nRecebido em dinheiro: {received:C}\nTroco: {change:C}";

            MessageBox.Show(
                $"VENDA CONCLUÍDA\n\nVenda Nº {sale.Number:000000}\nTotal: {sale.Total:C}\nPagamento: {string.Join(" + ", sale.Payments.Select(x => x.Method))}{cashSummary}\nComprovante não fiscal: {(printed.Result.Success ? (printed.Physical ? "IMPRESSO" : "PRÉVIA/MOCK OK") : "FALHOU")}\n{printed.Mode}" +
                (printed.Result.Success ? string.Empty : $"\n\nA venda foi salva. Erro de impressão: {printed.Result.Error}"),
                "ONÇA PDV",
                MessageBoxButton.OK,
                MessageBoxImage.Information);

            SetStatus("CAIXA LIVRE — PRÓXIMA VENDA");
            SearchBox.Focus();
        }
        catch (DomainException ex)
        {
            MessageBox.Show(ex.Message, "Pagamento", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void Pay_Click(object sender, RoutedEventArgs e) => await CompletePaymentAsync();
    private async void PayCash_Click(object sender, RoutedEventArgs e) => await CompletePaymentAsync(PaymentMethod.Cash);
    private async void PayPix_Click(object sender, RoutedEventArgs e) => await CompletePaymentAsync(PaymentMethod.Pix);
    private async void PayDebit_Click(object sender, RoutedEventArgs e) => await CompletePaymentAsync(PaymentMethod.Debit);
    private async void PayCredit_Click(object sender, RoutedEventArgs e) => await CompletePaymentAsync(PaymentMethod.Credit);
    private async void PayStoreCredit_Click(object sender, RoutedEventArgs e) => await CompletePaymentAsync(PaymentMethod.StoreCredit);

    private async void Reprint_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid id }) return;
        var sale = await _workflow.GetSaleAsync(id);
        if (sale is null) return;
        var result = await PrintSaleAsync(sale, true);
        SetStatus(result.Result.Success ? $"VENDA {sale.Number:000000} — {(result.Physical ? "REIMPRESSA" : "PRÉVIA/MOCK GERADA")}" : result.Result.Error ?? "FALHA");
    }

    private async void ViewSale_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid id }) return;
        var sale = await _workflow.GetSaleAsync(id);
        if (sale is not null)
        {
            var profile = await new TerminalPrinterProfileStore(_paths).LoadAsync(TerminalId);
            var renderer = RendererFor(profile);
            var document = await CreateReceiptDocumentAsync(sale);
            new ReceiptPreviewWindow(renderer.Render(document).Text, $"Comprovante não fiscal {profile?.PaperWidthMm ?? 80} mm") { Owner = this }.ShowDialog();
        }
    }

    private async void Customer_Click(object sender, RoutedEventArgs e)
    {
        var w = new CustomerSearchWindow(_customers) { Owner = this };
        if (w.ShowDialog() != true || w.Selected is null) return;
        await _workflow.SelectCustomerAsync(w.Selected.Id);
        CustomerText.Text = w.Selected.Name;
        SetStatus("CLIENTE SELECIONADO — CARRINHO PRESERVADO");
    }

    private async void RemoveCustomer_Click(object sender, RoutedEventArgs e)
    {
        await _workflow.SelectCustomerAsync(null);
        CustomerText.Text = "CONSUMIDOR";
    }

    private void CustomerManagement_Click(object sender, RoutedEventArgs e) =>
        new CustomerSearchWindow(_customers, true) { Owner = this }.ShowDialog();

    private void Credit_Click(object sender, RoutedEventArgs e) =>
        new CreditWindow(_database, _operatorId) { Owner = this }.ShowDialog();

    private void Purchases_Click(object sender, RoutedEventArgs e) =>
        new PurchasesWindow(_database) { Owner = this }.ShowDialog();

    private void Operations_Click(object sender, RoutedEventArgs e) =>
        new OperationsWindow(_database, _paths, _operatorId, OperationsSection.Sales) { Owner = this }.ShowDialog();

    private async void Reports_Click(object sender, RoutedEventArgs e)
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
    }

    private async void Stock_Click(object sender, RoutedEventArgs e)
    {
        _activeUser = await new AccessControlStore(_paths).ActiveUserAsync();
        if (!AccessControlStore.HasPermission(_activeUser.Role, UserRole.Stockkeeper))
        {
            var auth = new AdminPinWindow(_paths, "Acesso ao estoque exige Administrador ou Estoquista.") { Owner = this };
            if (auth.ShowDialog() != true || !auth.Authorized) return;
        }
        new OperationsWindow(_database, _paths, _operatorId, OperationsSection.Stock) { Owner = this }.ShowDialog();
    }

    private void Cash_Click(object sender, RoutedEventArgs e) =>
        new OperationsWindow(_database, _paths, _operatorId, OperationsSection.Cash) { Owner = this }.ShowDialog();

    private async void Preview_Click(object sender, RoutedEventArgs e)
    {
        if (_workflow.Cart.Items.Count == 0)
        {
            SetStatus("CUPOM VAZIO BLOQUEADO");
            return;
        }

        var d = new Sale(
            Guid.NewGuid(),
            0,
            DateTimeOffset.Now,
            _operatorId,
            _workflow.Cart.CustomerId,
            _workflow.Cart.Items,
            [new(PaymentMethod.Cash, _workflow.Cart.Total, _workflow.Cart.Total)],
            _workflow.Cart.Discount,
            _workflow.Cart.Total);
        var profile = await new TerminalPrinterProfileStore(_paths).LoadAsync(TerminalId);
        var renderer = RendererFor(profile);
        var document = await CreateReceiptDocumentAsync(d);
        new ReceiptPreviewWindow(renderer.Render(document).Text, $"Prévia comprovante não fiscal {profile?.PaperWidthMm ?? 80} mm") { Owner = this }.ShowDialog();
    }

    private async Task<ReceiptDocument> CreateReceiptDocumentAsync(Sale sale, bool isReprint = false)
    {
        var company = await _companyProfile.LoadAsync();
        var profile = await new TerminalPrinterProfileStore(_paths).LoadAsync(TerminalId);
        return new ReceiptDocument(
            sale,
            company.FantasyName,
            OpenDrawer: profile?.DrawerEnabled == true,
            Cut: profile?.CutEnabled == true,
            OperatorName: _activeUser.Name,
            IsReprint: isReprint,
            Company: new ReceiptCompany(
                company.FantasyName,
                company.LegalName,
                company.Cnpj,
                company.StateRegistration,
                company.Phone,
                company.AddressLine1,
                company.AddressLine2,
                company.FooterMessage));
    }

    private static IReceiptRenderer RendererFor(PrinterTerminalProfile? profile)
    {
        var codePage = profile?.Encoding switch { "CP858" => 858, "CP860" => 860, _ => 850 };
        return profile?.PaperWidthMm == 58
            ? new EscPos58Renderer(new CodePagePrinterEncoding(codePage))
            : new EscPos80Renderer(new CodePagePrinterEncoding(codePage));
    }

    private async Task<(PrintResult Result, bool Physical, string Mode)> PrintSaleAsync(Sale sale, bool reprint = false)
    {
        var profile = await new TerminalPrinterProfileStore(_paths).LoadAsync(TerminalId);
        var renderer = RendererFor(profile);
        var document = await CreateReceiptDocumentAsync(sale, reprint);

        if (profile?.PhysicalPrintingEnabled == true && !string.IsNullOrWhiteSpace(profile.PrinterName))
        {
            var physical = new QueuedPrintService(new WindowsRawPrintService(renderer, _paths.Logs, true), _database);
            var result = await physical.PrintAsync(document, profile.PrinterName);
            return (result, true, $"Impressora: {profile.PrinterName}");
        }

        var mock = new QueuedPrintService(new MockPrintService(renderer, _paths.PrintPreview), _database);
        var preview = await mock.PrintAsync(document);
        return (preview, false, "Impressão física desativada em Configurações > Impressora.");
    }

    private async void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (_workflow.Cart.Items.Count == 0) return;
        if (MessageBox.Show("Cancelar explicitamente esta venda?", "ONÇA PDV", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;

        await _workflow.CancelAsync();
        RefreshCart();
        RecoveryText.Text = string.Empty;
        SetStatus("VENDA CANCELADA");
        SearchBox.Focus();
    }

    private async void CartGrid_CellEditEnding(object sender, DataGridCellEditEndingEventArgs e)
    {
        if (e.Column.DisplayIndex != 2 || e.Row.Item is not CartRow row || e.EditingElement is not TextBox box || !decimal.TryParse(box.Text, out var q))
            return;

        try
        {
            await _workflow.ChangeQuantityAsync(row.ProductId, q);
            _ = Dispatcher.BeginInvoke(RefreshCart);
        }
        catch (DomainException ex)
        {
            MessageBox.Show(ex.Message);
            _ = Dispatcher.BeginInvoke(RefreshCart);
        }
    }

    private async Task RefreshSales() => SalesGrid.ItemsSource = await _workflow.LastSalesAsync();

    private void RefreshCart()
    {
        _rows.Clear();
        foreach (var i in _workflow.Cart.Items)
            _rows.Add(new(i.ProductId, i.Code, i.Name, i.Quantity, i.UnitPrice, i.Subtotal));
        TotalText.Text = _workflow.Cart.Total.ToString("C");
        var lines = _workflow.Cart.Items.Count;
        var quantity = _workflow.Cart.Items.Sum(x => x.Quantity);
        CartSummaryText.Text = lines == 0
            ? "Carrinho vazio • salvo automaticamente"
            : $"{lines} item(ns) • {quantity:N3} unidade(s) • carrinho salvo automaticamente";
        CartSavedText.Text = lines == 0
            ? "Pronto para a próxima venda"
            : $"Subtotal {_workflow.Cart.GrossTotal:C} • recuperação automática ativa";
    }

    private void SetStatus(string value) => StatusText.Text = value;

    private async void Add_Click(object sender, RoutedEventArgs e) => await AddProduct();

    private async void SearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        await AddProduct();
    }

    private async void Product_Click(object sender, RoutedEventArgs e)
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

    private static string RoleName(UserRole role) => role switch { UserRole.Administrator => "Administrador", UserRole.Cashier => "Caixa", UserRole.Stockkeeper => "Estoquista", _ => role.ToString() };

    private void QuickLookup_Click(object sender, RoutedEventArgs e)
    {
        new ProductLookupWindow(_workflow, SearchBox.Text) { Owner = this }.ShowDialog();
        SearchBox.Focus();
        SearchBox.SelectAll();
    }

    private CartRow? SelectedCartRow() => CartGrid.SelectedItem as CartRow;

    private async Task ChangeSelectedQuantityAsync(decimal delta)
    {
        var row = SelectedCartRow();
        if (row is null)
        {
            SetStatus("SELECIONE UM ITEM DO CARRINHO");
            return;
        }

        var next = row.Quantity + delta;
        if (next <= 0)
        {
            await _workflow.RemoveItemAsync(row.ProductId);
            SetStatus($"ITEM REMOVIDO: {row.Name}");
        }
        else
        {
            await _workflow.ChangeQuantityAsync(row.ProductId, next);
            SetStatus($"{row.Name} • QTD {next:N3}");
        }

        RefreshCart();
        SearchBox.Focus();
    }

    private async void IncreaseSelected_Click(object sender, RoutedEventArgs e) => await ChangeSelectedQuantityAsync(1);
    private async void DecreaseSelected_Click(object sender, RoutedEventArgs e) => await ChangeSelectedQuantityAsync(-1);

    private async void RemoveSelected_Click(object sender, RoutedEventArgs e)
    {
        var row = SelectedCartRow();
        if (row is null)
        {
            SetStatus("SELECIONE UM ITEM DO CARRINHO");
            return;
        }
        await _workflow.RemoveItemAsync(row.ProductId);
        RefreshCart();
        SetStatus($"ITEM REMOVIDO: {row.Name}");
        SearchBox.Focus();
    }

    private async void CartGrid_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Delete) return;
        e.Handled = true;
        RemoveSelected_Click(sender, e);
        await Task.CompletedTask;
    }

    private void Printer_Click(object sender, RoutedEventArgs e) => new PrinterSettingsWindow(_paths) { Owner = this }.ShowDialog();
    private void ReceiptSettings_Click(object sender, RoutedEventArgs e) => new ReceiptSettingsWindow(_paths) { Owner = this }.ShowDialog();
    private void Diagnostic_Click(object sender, RoutedEventArgs e) => new DiagnosticWindow(new DiagnosticService(_database, _paths)) { Owner = this }.ShowDialog();

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (Keyboard.Modifiers == ModifierKeys.Control && e.Key == Key.L)
        {
            SearchBox.Focus();
            SearchBox.SelectAll();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.F1) Product_Click(sender, e);
        else if (e.Key == Key.F2) Pay_Click(sender, e);
        else if (e.Key == Key.F3) QuickLookup_Click(sender, e);
        else if (e.Key == Key.F4) Customer_Click(sender, e);
        else if (e.Key == Key.F5) PayCash_Click(sender, e);
        else if (e.Key == Key.F6) PayPix_Click(sender, e);
        else if (e.Key == Key.F7) PayDebit_Click(sender, e);
        else if (e.Key == Key.F8) PayCredit_Click(sender, e);
        else if (e.Key == Key.F9) PayStoreCredit_Click(sender, e);
        else if (e.Key == Key.Escape) Cancel_Click(sender, e);
    }

    private sealed record CartRow(Guid ProductId, string Code, string Name, decimal Quantity, decimal UnitPrice, decimal Subtotal);
}
