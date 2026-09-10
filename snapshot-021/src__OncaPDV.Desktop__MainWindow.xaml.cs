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
    private static readonly Guid OperatorId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private readonly AppPaths _paths = AppPaths.Default();
    private readonly OncaDatabase _database;
    private readonly PosWorkflow _workflow;
    private readonly CustomerService _customers;
    private readonly IPrintService _printer;
    private readonly IReceiptRenderer _renderer = new EscPos80Renderer();
    private readonly ObservableCollection<CartRow> _rows = [];
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };

    public MainWindow()
    {
        InitializeComponent();
        _database = new(_paths);
        AppServices.Database = _database;
        AppServices.Paths = _paths;
        _database.Migrate();

        var products = new SqliteProductRepository(_database);
        var sales = new SqliteSaleRepository(_database, new SystemClock());
        var customerRepository = new SqliteCustomerRepository(_database);
        _customers = new(customerRepository);
        _workflow = new(
            products,
            new JsonCartRecoveryStore(_paths),
            sales,
            new SqliteCashSessionRepository(_database, new SystemClock()),
            new SystemClock());
        _printer = new QueuedPrintService(new ConfiguredPhysicalPrintService(_paths), _database);

        CartGrid.ItemsSource = _rows;
        _timer.Tick += (_, _) => ClockText.Text = DateTime.Now.ToString("ddd, dd/MM/yyyy  HH:mm:ss");
        _timer.Start();
        Loaded += OnLoaded;
        Closing += MainWindow_Closing;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var recovered = await _workflow.InitializeAsync();
        RefreshCart();
        await RefreshSales();
        DatabaseStatus.Text = $"Banco: {_database.IntegrityCheck()} • {sw.ElapsedMilliseconds} ms";
        ApplySavedDisplaySettings();
        UpdateBackupStatus();
        RecoveryText.Text = recovered ? "CARRINHO RECUPERADO" : string.Empty;
        SearchBox.Focus();
    }

    private async Task AddProduct()
    {
        var query = SearchBox.Text.Trim();
        if (query.Length == 0) return;
        if (!_workflow.AcceptScan(query))
        {
            SetStatus("LEITURA DUPLICADA BLOQUEADA");
            return;
        }

        var matches = (await _workflow.SearchAsync(query)).Where(x => x.Active).ToArray();
        var exact = matches.FirstOrDefault(x =>
            string.Equals(x.InternalCode, query, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(x.Barcode, query, StringComparison.OrdinalIgnoreCase));

        Product? selected = exact;
        if (selected is null && matches.Length == 1) selected = matches[0];
        if (selected is null && matches.Length > 1)
        {
            var chooser = new ProductSelectionWindow("Escolha o produto para adicionar", matches) { Owner = this };
            if (chooser.ShowDialog() != true || chooser.Selected is null)
            {
                SearchBox.SelectAll();
                return;
            }
            selected = chooser.Selected;
        }

        if (selected is null)
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

        await _workflow.AddExistingProductAsync(selected);
        RefreshCart();
        SetStatus(selected.Name);
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
            var sale = await _workflow.CompleteAsync(dialog.Payments, OperatorId);
            await RefreshSales();
            RefreshCart();

            var shouldPrint = MessageBox.Show(
                $"Venda Nº {sale.Number:000000} concluída com sucesso.\n\nDeseja imprimir o comprovante?",
                "ONÇA PDV — Venda concluída",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question) == MessageBoxResult.Yes;
            PrintResult? printed = null;
            if (shouldPrint) printed = await _printer.PrintAsync(new(sale));

            var cash = sale.Payments.Where(x => x.Method == PaymentMethod.Cash).ToArray();
            var received = cash.Sum(x => x.Received ?? x.Amount);
            var change = cash.Sum(x => x.Change);
            var cashSummary = cash.Length == 0 ? string.Empty : $"\nRecebido em dinheiro: {received:C}\nTroco: {change:C}";

            MessageBox.Show(
                $"VENDA CONCLUÍDA\n\nVenda Nº {sale.Number:000000}\nTotal: {sale.Total:C}\nPagamento: {string.Join(" + ", sale.Payments.Select(x => x.Method))}{cashSummary}\nImpressão: {(shouldPrint ? (printed?.Success == true ? "OK" : "FALHOU") : "NÃO SOLICITADA")}",
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
    private async void PayStoreCredit_Click(object sender, RoutedEventArgs e)
    {
        if (_workflow.Cart.CustomerId is null)
        {
            MessageBox.Show("Para vender no crediário, selecione o cliente primeiro.", "Crediário", MessageBoxButton.OK, MessageBoxImage.Information);
            var w = new CustomerSearchWindow(_customers) { Owner = this };
            if (w.ShowDialog() != true || w.Selected is null) return;
            await _workflow.SelectCustomerAsync(w.Selected.Id);
            CustomerText.Text = w.Selected.Name;
        }
        await CompletePaymentAsync(PaymentMethod.StoreCredit);
    }

    private async void Reprint_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid id }) return;
        var sale = await _workflow.GetSaleAsync(id);
        if (sale is null) return;
        if (MessageBox.Show($"Deseja imprimir novamente a venda {sale.Number:000000}?","ONÇA PDV — Confirmação de impressão",MessageBoxButton.YesNo,MessageBoxImage.Question)!=MessageBoxResult.Yes){SetStatus("IMPRESSÃO NÃO SOLICITADA");return;}
        var result = await _printer.PrintAsync(new(sale,IsReprint:true));
        SetStatus(result.Success ? $"VENDA {sale.Number:000000} REIMPRESSA" : result.Error ?? "FALHA");
    }

    private async void ViewSale_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid id }) return;
        var sale = await _workflow.GetSaleAsync(id);
        if (sale is not null)
            new ReceiptPreviewWindow(_renderer.Render(new(sale)).Text, "Cupom 80 mm") { Owner = this }.ShowDialog();
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
        new CreditWindow(_database, OperatorId) { Owner = this }.ShowDialog();

    private void Purchases_Click(object sender, RoutedEventArgs e) =>
        new PurchasesWindow(_database) { Owner = this }.ShowDialog();

    private void Operations_Click(object sender, RoutedEventArgs e) =>
        new OperationsWindow(_database, _paths, OperatorId) { Owner = this }.ShowDialog();

    private async void HoldSale_Click(object sender, RoutedEventArgs e)
    {
        if (_workflow.Cart.Items.Count == 0) { FinalOps_Click(sender, e); return; }
        try
        {
            var svc = new FinalFeaturesService(_database);
            await svc.HoldAsync($"Espera {DateTime.Now:HH:mm}", _workflow.Cart.CustomerId, _workflow.Cart.Items.ToArray(), _workflow.Cart.Discount);
            await _workflow.CancelAsync(); RefreshCart(); SetStatus("VENDA SALVA EM ESPERA"); SearchBox.Focus();
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, "Venda em espera", MessageBoxButton.OK, MessageBoxImage.Warning); }
    }

    private async void FinalOps_Click(object sender, RoutedEventArgs e)
    {
        var w = new FinalOperationsWindow(_database, OperatorId) { Owner = this };
        if (w.ShowDialog() != true || w.SelectedHold is null) return;
        if (_workflow.Cart.Items.Count > 0 && MessageBox.Show("Substituir o carrinho atual pela venda em espera?", "ONÇA PDV", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        var h = w.SelectedHold;
        await _workflow.CancelAsync();
        var cart = new Cart { CustomerId = h.CustomerId };
        foreach (var item in h.Items) cart.AddCustom(item.ProductId, item.Code, item.Name, item.Quantity, item.UnitPrice);
        cart.SetDiscount(h.Discount);
        await _workflow.ReplaceCartAsync(cart);
        await new FinalFeaturesService(_database).DeleteHoldAsync(h.Id);
        RefreshCart(); SetStatus("VENDA EM ESPERA RECUPERADA");
    }
    private void Preview_Click(object sender, RoutedEventArgs e)
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
            OperatorId,
            _workflow.Cart.CustomerId,
            _workflow.Cart.Items,
            [new(PaymentMethod.Cash, _workflow.Cart.Total, _workflow.Cart.Total)],
            _workflow.Cart.Discount,
            _workflow.Cart.Total);
        new ReceiptPreviewWindow(_renderer.Render(new(d)).Text, "Prévia 80 mm") { Owner = this }.ShowDialog();
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
        if (e.Row.Item is not CartRow row || e.EditingElement is not TextBox box) return;
        try
        {
            if (e.Column.DisplayIndex == 1)
                await _workflow.EditCartItemAtAsync(row.Index, name: box.Text);
            else if (e.Column.DisplayIndex == 2 && decimal.TryParse(box.Text, out var q))
                await _workflow.EditCartItemAtAsync(row.Index, quantity: q);
            else if (e.Column.DisplayIndex == 3 && decimal.TryParse(box.Text, out var price))
                await _workflow.EditCartItemAtAsync(row.Index, unitPrice: price);
            else
                return;
            _ = Dispatcher.BeginInvoke(RefreshCart);
        }
        catch (DomainException ex)
        {
            MessageBox.Show(ex.Message, "Carrinho", MessageBoxButton.OK, MessageBoxImage.Warning);
            _ = Dispatcher.BeginInvoke(RefreshCart);
        }
    }

    private async void RemoveCartItem_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: int index }) return;
        await _workflow.RemoveCartItemAtAsync(index);
        RefreshCart();
        SetStatus("ITEM REMOVIDO");
        SearchBox.Focus();
    }

    private void FocusDiversos()
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

    private async void Diversos_Click(object sender, RoutedEventArgs e)
    {
        var w = new DiversosWindow { Owner = this };
        if (w.ShowDialog() != true) return;
        await _workflow.AddDiversosAsync(w.Description ?? "DIVERSOS", w.Quantity, w.UnitPrice);
        RefreshCart();
        SetStatus($"DIVERSOS — {w.Description}");
        SearchBox.Focus();
    }

    private async void PriceLookup_Click(object sender, RoutedEventArgs e)
    {
        var query = SearchBox.Text.Trim();
        if (query.Length == 0)
        {
            MessageBox.Show("Digite o código, código de barras ou nome do produto.", "Consulta de preço", MessageBoxButton.OK, MessageBoxImage.Information);
            SearchBox.Focus();
            return;
        }
        var matches = (await _workflow.SearchAsync(query)).Where(x => x.Active).ToArray();
        if (matches.Length == 0)
        {
            MessageBox.Show("Produto não encontrado.", "Consulta de preço", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        Product? selected = matches.FirstOrDefault(x => string.Equals(x.InternalCode, query, StringComparison.OrdinalIgnoreCase) || string.Equals(x.Barcode, query, StringComparison.OrdinalIgnoreCase));
        if (selected is null && matches.Length == 1) selected = matches[0];
        if (selected is null)
        {
            var chooser = new ProductSelectionWindow("Consulta de preço", matches) { Owner = this };
            if (chooser.ShowDialog() != true || chooser.Selected is null) return;
            selected = chooser.Selected;
        }
        var price = selected.CurrentPrice(DateTimeOffset.Now);
        var priceWindow = new QuickPriceWindow(selected) { Owner = this };
        if (priceWindow.ShowDialog() == true)
        {
            await _workflow.AddExistingProductAsync(selected);
            RefreshCart();
            SetStatus($"{selected.Name} ADICIONADO AO CARRINHO");
        }
        SearchBox.SelectAll();
        SearchBox.Focus();
    }

    private async void SalePdf_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid id }) return;
        var sale = await _workflow.GetSaleAsync(id);
        if (sale is null) return;
        var pdf = await new OperationalService(_database, _paths).SalePdfAsync(sale);
        MessageBox.Show($"PDF GERADO\n\n{pdf}", "Venda", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private async void ManageSales_Click(object sender,RoutedEventArgs e)
    {
        var w=new SalesManagementWindow(_database,_workflow,OperatorId,_printer,_renderer){Owner=this};
        w.ShowDialog();if(w.CartChanged){RefreshCart();RecoveryText.Text="VENDA CARREGADA PARA EDIÇÃO";SetStatus("EDITE E FINALIZE A NOVA VENDA");}
        await RefreshSales();
    }

    private void Documents_Click(object sender,RoutedEventArgs e)
    {
        var w=new DocumentsWindow(_database,_workflow){Owner=this};w.ShowDialog();if(w.CartChanged){RefreshCart();RecoveryText.Text="ORÇAMENTO CARREGADO";SetStatus("ORÇAMENTO NO CARRINHO — FINALIZE QUANDO QUISER");}
    }

    private async void SaveQuote_Click(object sender,RoutedEventArgs e)
    {
        try{var q=await new AdvancedOperationsService(_database).SaveQuoteAsync(_workflow.Cart);MessageBox.Show($"Orçamento Nº {q.Number:000000} salvo. O estoque não foi baixado.","Orçamento",MessageBoxButton.OK,MessageBoxImage.Information);}
        catch(Exception ex){MessageBox.Show(ex.Message,"Orçamento",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

    private async void OpenLastSale()
    {
        var sale=(await _workflow.LastSalesAsync(1)).FirstOrDefault();if(sale is null){SetStatus("NENHUMA VENDA ENCONTRADA");return;}new ReceiptPreviewWindow(_renderer.Render(new(sale)).Text,$"Última venda {sale.Number:000000}"){Owner=this}.ShowDialog();
    }

    private void MainWindow_Closing(object? sender,System.ComponentModel.CancelEventArgs e)
    {
        if(_workflow.Cart.Items.Count==0)return;
        if(MessageBox.Show("Existe uma venda aberta no carrinho.\n\nEla está salva para recuperação, mas deseja realmente fechar o PDV?","ONÇA PDV",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)e.Cancel=true;
    }

    private async Task RefreshSales() => SalesGrid.ItemsSource = await _workflow.LastSalesAsync();

    private void RefreshCart()
    {
        _rows.Clear();
        for (var index = 0; index < _workflow.Cart.Items.Count; index++)
        {
            var i = _workflow.Cart.Items[index];
            _rows.Add(new(index, i.ProductId, i.Code, i.Name, i.Quantity, i.UnitPrice, i.Subtotal));
        }
        TotalText.Text = _workflow.Cart.Total.ToString("C");
    }

    private void SetStatus(string value) => StatusText.Text = value;

    private async void Add_Click(object sender, RoutedEventArgs e) => await AddProduct();

    private async void SearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        await AddProduct();
    }

    private async void Product_Click(object sender, RoutedEventArgs e) => await OpenProduct();
    private void Printer_Click(object sender, RoutedEventArgs e) => new PrinterSettingsWindow(_paths) { Owner = this }.ShowDialog();
    private void BackupCenter_Click(object sender, RoutedEventArgs e)
    {
        new BackupWindow(_database, _paths) { Owner = this }.ShowDialog();
        UpdateBackupStatus();
    }
    private void DisplaySettings_Click(object sender, RoutedEventArgs e) => new DisplaySettingsWindow(this) { Owner = this }.ShowDialog();
    private void Calculator_Click(object sender, RoutedEventArgs e) => new CalculatorWindow { Owner = this }.ShowDialog();

    private void UpdateBackupStatus()
    {
        try
        {
            _paths.EnsureCreated();
            var f = System.IO.Directory.GetFiles(_paths.Backups, "*.zip").OrderByDescending(System.IO.File.GetLastWriteTime).FirstOrDefault();
            LastBackupText.Text = f is null ? "Backup: nenhum" : $"Backup: {System.IO.File.GetLastWriteTime(f):dd/MM HH:mm}";
        }
        catch { LastBackupText.Text = "Backup: verificar"; }
    }

    private void ApplySavedDisplaySettings()
    {
        try
        {
            var file = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Onca PDV Pro", "terminal-ui.txt");
            if (!System.IO.File.Exists(file)) return;
            var p = System.IO.File.ReadAllText(file).Split(';');
            if (p.Length < 3) return;
            if (p[2] == "MAX") { WindowState = WindowState.Maximized; return; }
            if (double.TryParse(p[0], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var w) && double.TryParse(p[1], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var h))
            { Width = Math.Max(1240, w); Height = Math.Max(760, h); }
        }
        catch { }
    }
    private void Diagnostic_Click(object sender, RoutedEventArgs e) => new DiagnosticWindow(new DiagnosticService(_database, _paths)) { Owner = this }.ShowDialog();

    private void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F1) Product_Click(sender, e);
        else if (e.Key == Key.F2) Pay_Click(sender, e);
        else if (e.Key == Key.F3) PriceLookup_Click(sender, e);
        else if (e.Key == Key.F4) FocusDiversos();
        else if (e.Key == Key.F5) Calculator_Click(sender, e);
        else if (e.Key == Key.F8) OpenLastSale();
        else if (e.Key == Key.Escape) Cancel_Click(sender, e);
    }

    private sealed class CartRow
    {
        public int Index { get; }
        public Guid ProductId { get; }
        public string Code { get; set; }
        public string Name { get; set; }
        public decimal Quantity { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal Subtotal { get; set; }
        public CartRow(int index, Guid productId, string code, string name, decimal quantity, decimal unitPrice, decimal subtotal)
        { Index=index; ProductId=productId; Code=code; Name=name; Quantity=quantity; UnitPrice=unitPrice; Subtotal=subtotal; }
    }
}



