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
    private sealed class MultiSaleSlot037
    {
        public int Number { get; init; }
        public Cart Cart { get; set; } = new();
        public string CustomerLabel { get; set; } = "CONSUMIDOR";
        public string Label { get; set; } = "";
        public Guid? OrderId { get; set; }
    }

    private readonly List<MultiSaleSlot037> _multiSales037 = new();
    private int _currentMultiSale037;
    private int _nextMultiSaleNumber037 = 2;
    private bool _multiSaleSwitching037;

    private static readonly Guid OperatorId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private readonly AppPaths _paths = AppPaths.Default();
    private readonly OncaDatabase _database;
    private readonly PosWorkflow _workflow;
    private readonly CustomerService _customers;
    private readonly OrderService022 _orders;
    private Guid? _activeOrderId;
    private readonly IPrintService _printer;
    private readonly IReceiptRenderer _renderer = new EscPos80Renderer();
    private readonly ObservableCollection<CartRow> _rows = [];
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly DispatcherTimer _saleToastTimer0230 = new() { Interval = TimeSpan.FromSeconds(5) };
    private readonly CheckoutActionGuard0230 _checkoutGuard0230 = new();
    private readonly CheckoutInsights0230 _insights0230;
    private bool _pulseBusy0230;
    private int _pulseTick0230;
    private bool _focusMode0230;
    private GridLength _navWidthBeforeFocus0230 = new(220);
    private GridLength _salesHeightBeforeFocus0230 = new(164);

    public MainWindow()
    {
        InitializeComponent();
        
        _database = new(_paths);
        AppServices.Database = _database;
        AppServices.Paths = _paths;
        _database.Migrate();
        _orders = new OrderService022(_database);
        _insights0230 = new CheckoutInsights0230(_database, _paths);

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
        _timer.Tick += Timer_Tick0230;
        _timer.Start();
        _saleToastTimer0230.Tick += (_,_) => { _saleToastTimer0230.Stop(); if(SaleToastBorder is not null) SaleToastBorder.Visibility=Visibility.Collapsed; };
        Loaded += OnLoaded;
        Activated += (_,_) => Dispatcher.BeginInvoke(() => { if(!DiversosNameBox.IsKeyboardFocusWithin) SearchBox.Focus(); });
        Closing += MainWindow_Closing;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var recovered = await _workflow.InitializeAsync();
        var recoveredTabs040 = await RestoreMultiSales040();
        // Upgrade once: permit the shop owner to replace an unknown previous PIN
        // without changing any product, sale, cash, inventory or cart data.
        var ownerRecovery043=new AdminPinService040(_database);
        if(ownerRecovery043.NeedsOwnerRecovery043)
        {
            var recovery043=new AdminRecovery043Window(_database){Owner=this};
            if(recovery043.ShowDialog()!=true)
                MessageBox.Show("A autorização administrativa não foi redefinida. A recuperação será exibida novamente na próxima abertura.","ONÇA PDV",MessageBoxButton.OK,MessageBoxImage.Warning);
        }
        RefreshCart();
        await RefreshSales();
        DatabaseStatus.Text = $"Banco: {_database.IntegrityCheck()} • {sw.ElapsedMilliseconds} ms";
        ApplySavedDisplaySettings();
        UpdateBackupStatus();
        RecoveryText.Text = recoveredTabs040 ? "ABAS DE VENDAS RECUPERADAS — RECUPERAÇÃO AUTOMÁTICA ATIVA" : (recovered ? "CARRINHO RECUPERADO — RECUPERAÇÃO AUTOMÁTICA ATIVA" : "RECUPERAÇÃO AUTOMÁTICA ATIVA");
        await RefreshOperationalPulse0230();
        await RefreshCustomerPulse0230();
        SearchBox.Focus();
    }

    private bool _adding044;
    private async Task AddProduct()
    {
        if(_adding044||_multiSaleSwitching037||_finalizing040)return;
        _adding044=true;
        try
        {
            var raw=SearchBox.Text.Trim();
            if(!ScannerCommand0230.TryParse(raw,out var query,out var quantity)||query.Length==0)return;
            if(!_workflow.AcceptScan(query))
            {
                SetStatus("LEITURA DUPLICADA BLOQUEADA — AGUARDE E LEIA NOVAMENTE");
                return;
            }

            var matches=(await _workflow.SearchAsync(query)).Where(x=>x.Active).ToArray();
            var exact=matches.FirstOrDefault(x=>
                string.Equals(x.InternalCode,query,StringComparison.OrdinalIgnoreCase)||
                string.Equals(x.Barcode,query,StringComparison.OrdinalIgnoreCase));

            Product? selected=exact;
            if(selected is null&&matches.Length==1)selected=matches[0];
            if(selected is null&&matches.Length>1)
            {
                var chooser=new ProductSelectionWindow("Escolha o produto para adicionar",matches){Owner=this};
                if(chooser.ShowDialog()!=true||chooser.Selected is null){SearchBox.SelectAll();return;}
                selected=chooser.Selected;
            }

            if(selected is null)
            {
                SetStatus("PRODUTO NÃO CADASTRADO");
                SetStatus("PRODUTO NÃO ENCONTRADO — confira a leitura ou cadastre em PRODUTO [F2]");
                SearchBox.SelectAll();return;
            }

            await _workflow.AddExistingProductAsync(selected,quantity);
            RefreshCart();
            var cartQuantity=_workflow.Cart.Items.Where(x=>x.ProductId==selected.Id).Sum(x=>x.Quantity);
            var stockAlert=StockAlert0230.Evaluate(selected,cartQuantity);
            StockAlertText.Text=stockAlert??string.Empty;
            StockAlertBorder.Visibility=stockAlert is null?Visibility.Collapsed:Visibility.Visible;
            SetStatus(quantity==1?$"{selected.Name} ADICIONADO":$"{quantity:N3} x {selected.Name} ADICIONADOS");
            if(exact is not null)System.Media.SystemSounds.Asterisk.Play();
            SearchBox.Clear();SearchBox.Focus();
        }
        finally{_adding044=false;}
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
        if(_adding044 || _editingQuantity030 || _finalizing040 || _multiSaleSwitching037 || !_checkoutGuard0230.TryEnter()) { SetStatus("OPERAÇÃO EM ANDAMENTO"); return; }
        _finalizing040=true;
        if(PaymentPanel is not null)PaymentPanel.IsEnabled=false;
        SetStatus("FINALIZANDO VENDA...");
        FinalizeButton030.Content="FINALIZANDO VENDA...";
        try
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
            Guid? claimedOrder = null;
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
            try { sale = await _workflow.CompleteAsync(dialog.Payments, OperatorId); FinalizeActiveTab040(); }
            catch { if (claimedOrder is Guid releaseId) await _orders.ReleaseClaimAsync(releaseId); throw; }
            if (claimedOrder is Guid paidId)
            {
                await _orders.MarkPaidAsync(paidId, sale.Id, sale.Number);
                _activeOrderId = null;
            }
            await RefreshSales();
            RefreshCart();

            var shouldPrint = MessageBox.Show(
                $"Venda Nº {sale.Number:000000} concluída com sucesso.\n\nDeseja imprimir o comprovante?",
                "ONÇA PDV — Venda concluída",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question) == MessageBoxResult.Yes;
            PrintResult? printed = null;
            if (shouldPrint) printed = await _printer.PrintAsync(new(sale, Cut:true));

            var cash = sale.Payments.Where(x => x.Method == PaymentMethod.Cash).ToArray();
            var received = cash.Sum(x => x.Received ?? x.Amount);
            var change = cash.Sum(x => x.Change);
            var cashSummary = cash.Length == 0 ? string.Empty : $"\nRecebido em dinheiro: {received:C}\nTroco: {change:C}";

            // Preserve all print outcomes without an extra acknowledgement on success.
            if (shouldPrint && printed?.Success != true)
                MessageBox.Show("A venda foi concluída, mas a impressão falhou. Consulte as impressões pendentes.", "Impressão", MessageBoxButton.OK, MessageBoxImage.Warning);

            await RefreshOperationalPulse0230();
            await RefreshCustomerPulse0230();
            ShowSaleToast0230(sale);
            SaleToastText.Text += cashSummary;
            SetStatus("CAIXA LIVRE — PRÓXIMA VENDA");
            SearchBox.Focus();
        }
        catch (DomainException ex)
        {
            MessageBox.Show(ex.Message, "Pagamento", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    
        }
        finally { _finalizing040=false; if(PaymentPanel is not null)PaymentPanel.IsEnabled=true; _checkoutGuard0230.Exit(); FinalizeButton030.Content="FINALIZAR VENDA — F9"; SearchBox.Focus(); }
    }

    private async void Pay_Click(object sender, RoutedEventArgs e)
    {
        if(_paymentChoiceOpen040 || _finalizing040 || _multiSaleSwitching037)return;
        _paymentChoiceOpen040=true;
        try
        {
        if (_workflow.Cart.Items.Count == 0) { SetStatus("CARRINHO VAZIO"); return; }
        await CompletePaymentAsync();
    
        }
        finally { _paymentChoiceOpen040=false; }
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
            SyncCurrentMultiSale037();
        }
        await CompletePaymentAsync(PaymentMethod.StoreCredit);
    }

    private async void Reprint_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid id }) return;
        var sale = await _workflow.GetSaleAsync(id);
        if (sale is null) return;
        if (MessageBox.Show($"Deseja imprimir novamente a venda {sale.Number:000000}?","ONÇA PDV — Confirmação de impressão",MessageBoxButton.YesNo,MessageBoxImage.Question)!=MessageBoxResult.Yes){SetStatus("IMPRESSÃO NÃO SOLICITADA");return;}
        var result = await _printer.PrintAsync(new(sale,IsReprint:true,Cut:true));
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
        SyncCurrentMultiSale037();
        await RefreshCustomerPulse0230();
        SetStatus("CLIENTE SELECIONADO — CARRINHO PRESERVADO");
    }

    private async void RemoveCustomer_Click(object sender, RoutedEventArgs e)
    {
        await _workflow.SelectCustomerAsync(null);
        CustomerText.Text = "CONSUMIDOR";
        SyncCurrentMultiSale037();
        await RefreshCustomerPulse0230();
    }

    private void CustomerManagement_Click(object sender, RoutedEventArgs e) =>
        new CustomerSearchWindow(_customers, true) { Owner = this }.ShowDialog();

    private void Credit_Click(object sender, RoutedEventArgs e) =>
        new CreditWindow(_database, OperatorId) { Owner = this }.ShowDialog();

    private void Purchases_Click(object sender, RoutedEventArgs e) =>
        new PurchasesWindow(_database) { Owner = this }.ShowDialog();

    private void Finance052_Click(object sender, RoutedEventArgs e) =>
        new Finance052Window(_database, OperatorId) { Owner = this }.ShowDialog();

    private void Integrity151_Click(object sender, RoutedEventArgs e) =>
        new IntegrityCenter151Window(_database, _paths) { Owner = this }.ShowDialog();

    private void Operations_Click(object sender, RoutedEventArgs e) =>
        new OperationsWindow(_database, _paths, OperatorId) { Owner = this }.ShowDialog();

    private async void Orders_Click(object sender, RoutedEventArgs e)
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

    private void Inventory026_Click(object sender, RoutedEventArgs e) => new InventoryWindow(_database) { Owner=this }.ShowDialog();


    private Cart CloneCart037(Cart source)
    {
        var copy = new Cart { Id = source.Id, CustomerId = source.CustomerId };
        foreach (var item in source.Items)
            copy.AddCustom(item.ProductId, item.Code, item.Name, item.Quantity, item.UnitPrice);
        copy.SetDiscount(source.Discount);
        return copy;
    }

    private void InitializeMultiSales037()
    {
        if (_multiSales037.Count != 0) return;
        _multiSales037.Add(new MultiSaleSlot037
        {
            Number = 1,
            Cart = CloneCart037(_workflow.Cart),
            CustomerLabel = string.IsNullOrWhiteSpace(CustomerText?.Text) ? "CONSUMIDOR" : CustomerText.Text,
            OrderId = _activeOrderId
        });
        _currentMultiSale037 = 0;
        RefreshMultiSaleTabs037();
    }

    private void SyncCurrentMultiSale037()
    {
        if (_multiSaleSwitching037 || _multiSales037.Count == 0) return;
        var slot = _multiSales037[_currentMultiSale037];
        slot.Cart = CloneCart037(_workflow.Cart);
        slot.CustomerLabel = string.IsNullOrWhiteSpace(CustomerText.Text) ? "CONSUMIDOR" : CustomerText.Text;
        slot.OrderId = _activeOrderId;
        RefreshMultiSaleTabs037();
        SaveMultiSales040();
    }

    private void RefreshMultiSaleTabs037()
    {
        if (MultiSaleTabsPanel is null) return;
        MultiSaleTabsPanel.Children.Clear();
        for (var i = 0; i < _multiSales037.Count; i++)
        {
            var slot = _multiSales037[i];
            var active = i == _currentMultiSale037;
            var b = new Button
            {
                Tag = i,
                Content = $"VENDA {slot.Number}{(string.IsNullOrWhiteSpace(slot.Label) ? "" : " — "+slot.Label)}   {slot.Cart.Total:C}",
                Padding = new Thickness(14, 8, 14, 8),
                Margin = new Thickness(3),
                FontWeight = active ? FontWeights.Bold : FontWeights.SemiBold,
                Background = active ? new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(11,107,58)) : System.Windows.Media.Brushes.White,
                Foreground = active ? System.Windows.Media.Brushes.White : new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(35,49,41))
            };
            b.Click += MultiSaleTab037_Click;
            MultiSaleTabsPanel.Children.Add(b);
        }
    }

    private async void MultiSaleTab037_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button b || b.Tag is not int index) return;
        await SwitchMultiSale037(index);
    }

    private async Task SwitchMultiSale037(int index)
    {
        if (_adding044||_finalizing040||index < 0 || index >= _multiSales037.Count || index == _currentMultiSale037) return;
        SyncCurrentMultiSale037();
        _multiSaleSwitching037 = true;
        try
        {
            _currentMultiSale037 = index;
            var slot = _multiSales037[index];
            await _workflow.CancelAsync();
            await _workflow.ReplaceCartAsync(CloneCart037(slot.Cart));
            _activeOrderId = slot.OrderId;
            CustomerText.Text = string.IsNullOrWhiteSpace(slot.CustomerLabel) ? "CONSUMIDOR" : slot.CustomerLabel;
            RefreshCart();
            await RefreshCustomerPulse0230();
        }
        finally { _multiSaleSwitching037 = false; }
        RefreshMultiSaleTabs037();
        SaveMultiSales040();
        SearchBox.Focus();
        SetStatus($"VENDA {_multiSales037[index].Number} ATIVA");
    }

    private async void NewMultiSale_Click(object sender, RoutedEventArgs e)
    {
        if(_adding044||_finalizing040||_multiSaleSwitching037)return;
        SyncCurrentMultiSale037();
        _multiSaleSwitching037 = true;
        try
        {
            await _workflow.CancelAsync();
            var slot = new MultiSaleSlot037 { Number = _nextMultiSaleNumber037++ };
            _multiSales037.Add(slot);
            _currentMultiSale037 = _multiSales037.Count - 1;
            _activeOrderId = null;
            CustomerText.Text = "CONSUMIDOR";
            RefreshCart();
            await RefreshCustomerPulse0230();
        }
        finally { _multiSaleSwitching037 = false; }
        RefreshMultiSaleTabs037();
        SaveMultiSales040();
        SearchBox.Focus();
        SetStatus($"VENDA {_multiSales037[_currentMultiSale037].Number} ABERTA");
    }

    private async void CloseMultiSale_Click(object sender, RoutedEventArgs e)
    {
        if(_adding044||_finalizing040||_multiSaleSwitching037)return;
        if (_multiSales037.Count == 0) return;
        SyncCurrentMultiSale037();
        var slot = _multiSales037[_currentMultiSale037];
        if (slot.Cart.Items.Count > 0 &&
            MessageBox.Show($"Fechar a aba VENDA {slot.Number}?\n\nO carrinho desta aba será descartado.", "Fechar venda", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;

        _multiSaleSwitching037 = true;
        try
        {
            await _workflow.CancelAsync();
            if (_multiSales037.Count == 1)
            {
                _multiSales037[0] = new MultiSaleSlot037 { Number = slot.Number };
                _currentMultiSale037 = 0;
                _activeOrderId = null;
                CustomerText.Text = "CONSUMIDOR";
            }
            else
            {
                _multiSales037.RemoveAt(_currentMultiSale037);
                if (_currentMultiSale037 >= _multiSales037.Count) _currentMultiSale037 = _multiSales037.Count - 1;
                var next = _multiSales037[_currentMultiSale037];
                await _workflow.ReplaceCartAsync(CloneCart037(next.Cart));
                _activeOrderId = next.OrderId;
                CustomerText.Text = string.IsNullOrWhiteSpace(next.CustomerLabel) ? "CONSUMIDOR" : next.CustomerLabel;
            }
            RefreshCart();
            await RefreshCustomerPulse0230();
        }
        finally { _multiSaleSwitching037 = false; }
        RefreshMultiSaleTabs037();
        SaveMultiSales040();
        SearchBox.Focus();
    }


    private bool _finalizing040;
    private bool _paymentChoiceOpen040;
    private bool _recoveryReadOnly040;
    private bool _recoveryWarningShown040;
    private MultiSaleRecovery040? _recovery040;

    private SaleTabsSnapshot040 SnapshotMultiSales040() => new(
        _multiSales037[_currentMultiSale037].Number,_nextMultiSaleNumber037,
        _multiSales037.Select(s=>new SaleTab040(
            s.Number,s.Label,s.CustomerLabel,s.Cart.CustomerId,s.OrderId,s.Cart.Discount,
            s.Cart.Items.Select(item=>new CartItem040(item.ProductId,item.Code,item.Name,item.Quantity,item.UnitPrice)).ToList(),s.Cart.Id
        )).ToList());

    private void SaveMultiSales040()
    {
        if(_recoveryReadOnly040||_multiSales037.Count==0||_multiSaleSwitching037)return;
        try
        {
            _recovery040 ??= new MultiSaleRecovery040(_database);
            _recovery040.Save(SnapshotMultiSales040());
            _recoveryWarningShown040=false;
        }
        catch(Exception ex)
        {
            if(!_recoveryWarningShown040)
            {
                _recoveryWarningShown040=true;
                MessageBox.Show("Não foi possível salvar automaticamente as abas. Verifique o disco e faça backup antes de fechar o PDV.\n\n"+ex.Message,
                    "RECUPERAÇÃO DE VENDAS",MessageBoxButton.OK,MessageBoxImage.Warning);
            }
        }
    }

    private async Task<bool> RestoreMultiSales040()
    {
        try
        {
            _recovery040=new MultiSaleRecovery040(_database);
            var state=_recovery040.Load();
            if(state is null){InitializeMultiSales037();return false;}
            _multiSaleSwitching037=true;
            try
            {
                _multiSales037.Clear();
                foreach(var saved in state.Tabs)
                {
                    var cart=new Cart{Id=saved.CartId is Guid savedId && savedId!=Guid.Empty?savedId:Guid.NewGuid(),CustomerId=saved.CustomerId};
                    foreach(var item in saved.Items)
                        cart.AddCustom(item.ProductId,item.Code,item.Name,item.Quantity,item.UnitPrice);
                    cart.SetDiscount(saved.Discount);
                    _multiSales037.Add(new MultiSaleSlot037{Number=saved.Number,Label=saved.Label??"",
                        CustomerLabel=saved.CustomerLabel??"CONSUMIDOR",OrderId=saved.OrderId,Cart=cart});
                }
                _nextMultiSaleNumber037=state.NextNumber;
                _currentMultiSale037=_multiSales037.FindIndex(slot=>slot.Number==state.ActiveNumber);
                var active=_multiSales037[_currentMultiSale037];
                await _workflow.ReplaceCartAsync(CloneCart037(active.Cart));
                _activeOrderId=active.OrderId;
                CustomerText.Text=string.IsNullOrWhiteSpace(active.CustomerLabel)?"CONSUMIDOR":active.CustomerLabel;
            }
            finally{_multiSaleSwitching037=false;}
            RefreshMultiSaleTabs037();
            return true;
        }
        catch(Exception ex)
        {
            // Do not overwrite a possibly damaged snapshot with a new empty one.
            _recoveryReadOnly040=true;
            MessageBox.Show("Não foi possível restaurar as abas salvas. O arquivo original não será apagado nem substituído.\n\n"+
                ex.Message+"\n\nVerifique o backup antes de continuar.","RECUPERAÇÃO DE VENDAS",MessageBoxButton.OK,MessageBoxImage.Warning);
            if(_multiSales037.Count==0)InitializeMultiSales037();
            return false;
        }
    }

    private void RenameMultiSale040_Click(object sender,RoutedEventArgs e)
    {
        if(_multiSales037.Count==0||_multiSaleSwitching037||_finalizing040)return;
        var tab=_multiSales037[_currentMultiSale037];
        var name=Microsoft.VisualBasic.Interaction.InputBox(
            $"Identificação para a VENDA {tab.Number} (ex.: João, Entrega, Balcão):","RENOMEAR ABA",tab.Label);
        if(string.IsNullOrWhiteSpace(name))return;
        name=name.Trim().Replace("\r"," ").Replace("\n"," ");
        if(name.Length>32){MessageBox.Show("Use no máximo 32 caracteres.","Renomear aba");return;}
        tab.Label=name;
        RefreshMultiSaleTabs037();
        SaveMultiSales040();
    }

    private void FinalizeActiveTab040()
    {
        if(_multiSales037.Count==0)return;
        var tab=_multiSales037[_currentMultiSale037];
        tab.Cart=new Cart();
        tab.OrderId=null;
        tab.CustomerLabel="CONSUMIDOR";
        tab.Label="";
        _activeOrderId=null;
        CustomerText.Text="CONSUMIDOR";
        SaveMultiSales040();
        RefreshMultiSaleTabs037();
    }

    private async void CancelCurrentStable_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (_workflow.Cart.Items.Count == 0)
            {
                MessageBox.Show("Esta aba não possui itens para descartar.", "Venda atual", MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            var tabNumber = _multiSales037.Count > 0 ? _multiSales037[_currentMultiSale037].Number : 1;
            if (MessageBox.Show($"Descartar somente o carrinho da VENDA {tabNumber}, no valor de {_workflow.Cart.Total:C}?\n\nAs outras abas e vendas já concluídas não serão alteradas.",
                "Confirmar descarte da aba", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
            await _workflow.CancelAsync();
            _activeOrderId = null;
            CustomerText.Text = "CONSUMIDOR";
            RefreshCart();
            RecoveryText.Text = string.Empty;
            RefreshMultiSaleTabs037();
            SearchBox.Focus();
            SetStatus($"VENDA {tabNumber} DESCARTADA — OUTRAS ABAS PRESERVADAS");
            SetStatus($"CARRINHO DA VENDA {tabNumber} DESCARTADO");
        }
        catch (Exception ex)
        {
            MessageBox.Show("Não foi possível descartar a venda desta aba.\n\n"+ex.Message,
                "Venda atual", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void CompletedSalesStable_Click(object sender, RoutedEventArgs e)
    {
        var w=new SalesManagementWindow(_database,_workflow,OperatorId,_printer,_renderer){Owner=this};
        if(w.ShowDialog()==true && w.CartChanged) RefreshCart();
    }

    private void Reports022_Click(object sender, RoutedEventArgs e) => new Reports022Window(_database,_paths) { Owner=this }.ShowDialog();

    private void ApplyAutomaticDisplaySettings()
    {
        WindowState = WindowState.Maximized;
        var width = SystemParameters.WorkArea.Width;
        if (width < 1300) { NavColumn.Width = new GridLength(170); PaymentColumn.Width = new GridLength(290); }
        else if (width < 1600) { NavColumn.Width = new GridLength(184); PaymentColumn.Width = new GridLength(310); }
        else { NavColumn.Width = new GridLength(220); PaymentColumn.Width = new GridLength(370); }
    }

    private async void HoldSale_Click(object sender, RoutedEventArgs e)
    {
        if (_adding044 || _finalizing040 || _multiSaleSwitching037) return;
        if (_workflow.Cart.Items.Count == 0) { SetStatus("CARRINHO VAZIO — NADA PARA COLOCAR EM ESPERA"); return; }
        _multiSaleSwitching037=true;
        try
        {
            var svc = new FinalFeaturesService(_database);
            await svc.HoldAsync($"Espera {DateTime.Now:HH:mm}", _workflow.Cart.CustomerId, _workflow.Cart.Items.ToArray(), _workflow.Cart.Discount);
            await _workflow.CancelAsync(); _activeOrderId=null; CustomerText.Text="CONSUMIDOR"; RefreshCart(); await RefreshCustomerPulse0230(); await RefreshContext030(); SetStatus("VENDA SALVA EM ESPERA"); SearchBox.Focus();
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, "Venda em espera", MessageBoxButton.OK, MessageBoxImage.Warning); }
        finally { _multiSaleSwitching037=false; SyncCurrentMultiSale037(); }
    }

    private async void FinalOps_Click(object sender, RoutedEventArgs e)
    {
        if (_adding044 || _finalizing040 || _multiSaleSwitching037) return;
        var w = new FinalOperationsWindow(_database, OperatorId) { Owner = this };
        if (w.ShowDialog() != true || w.SelectedHold is null) return;
        if (_workflow.Cart.Items.Count > 0 && MessageBox.Show("Substituir o carrinho atual pela venda em espera?", "ONÇA PDV", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        var h = w.SelectedHold;
        await _workflow.CancelAsync();
        var cart = new Cart { CustomerId = h.CustomerId };
        foreach (var item in h.Items) cart.AddCustom(item.ProductId, item.Code, item.Name, item.Quantity, item.UnitPrice);
        cart.SetDiscount(h.Discount);
        await _workflow.ReplaceCartAsync(cart);
        if(h.CustomerId is Guid customerId){var customer=await _customers.GetAsync(customerId);CustomerText.Text=customer?.Name??"CLIENTE";}else CustomerText.Text="CONSUMIDOR";
        await new FinalFeaturesService(_database).DeleteHoldAsync(h.Id);
        _activeOrderId=null; RefreshCart();await RefreshCustomerPulse0230(); await RefreshContext030(); SetStatus("VENDA EM ESPERA RECUPERADA"); SearchBox.Focus();
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
        _activeOrderId = null;
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
        ProductEntryTabs.SelectedIndex = 1;
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
                SetStatus("DIVERSOS — INFORME UM VALOR MAIOR QUE ZERO");
                DiversosValueBox.Focus(); DiversosValueBox.SelectAll(); return;
            }
            if (!decimal.TryParse(qtyText, System.Globalization.NumberStyles.Number, culture, out var qty) || qty <= 0)
            {
                SetStatus("DIVERSOS — INFORME UMA QUANTIDADE MAIOR QUE ZERO");
                DiversosQtyBox.Focus(); DiversosQtyBox.SelectAll(); return;
            }
            await _workflow.AddDiversosAsync(name, qty, value);
            RefreshCart();
            SetStatus($"DIVERSOS ADICIONADO — {name}");
            DiversosNameBox.Clear(); DiversosValueBox.Clear(); DiversosQtyBox.Text = "1";
            ProductEntryTabs.SelectedIndex=0; SearchBox.Focus();
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

    private async void Timer_Tick0230(object? sender, EventArgs e)
    {
        ClockText.Text=DateTime.Now.ToString("ddd, dd/MM/yyyy  HH:mm:ss");
        _pulseTick0230++;
        if(_pulseTick0230%30==0) await RefreshOperationalPulse0230();
    }

    private async Task RefreshOperationalPulse0230()
    {
        if(_pulseBusy0230)return;_pulseBusy0230=true;
        try
        {
            var p=await _insights0230.TodayAsync();
            CashPulseText.Text=$"HOJE • {p.Sales} venda(s)\nDinheiro  {p.Cash:C}     PIX  {p.Pix:C}\nDébito  {p.Debit:C}     Crédito  {p.Credit:C}\nCrediário  {p.StoreCredit:C}\nTotal vendido  {p.Net:C}\nRecebimentos  {p.CreditReceipts:C}";
            var movements=await new CashMovements030(_database).TodayAsync();
            CashPulseText.Text += $"\nSangria {movements.Withdrawals:C} • Suprimento {movements.Supplies:C}";
            await RefreshContext030();
            HealthText.Text=await Task.Run(() => _insights0230.HealthText());
            HealthText.Foreground=HealthText.Text.StartsWith("SISTEMA OK",StringComparison.OrdinalIgnoreCase)?new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(8,114,51)):new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(146,91,0));
        }
        catch(Exception ex){CashPulseText.Text="Resumo temporariamente indisponível";HealthText.Text="ATENÇÃO • diagnóstico";System.Diagnostics.Debug.WriteLine(ex);}
        finally{_pulseBusy0230=false;}
    }

    private async Task RefreshCustomerPulse0230()
    {
        if(_workflow.Cart.CustomerId is not Guid id)
        {
            CustomerPulseText.Text="Sem cliente vinculado.";
            return;
        }
        try
        {
            var p=await _insights0230.CustomerAsync(id);
            if(p is null){CustomerPulseText.Text="Cliente não encontrado.";return;}
            var customer=await _customers.GetAsync(id);
            CustomerPulseText.Text=$"{customer?.Phone ?? "Telefone não informado"} • {p.Purchases} compra(s) • Total comprado {p.Spent:C} • Crediário em aberto {p.CreditBalance:C} ({p.OpenCredits}) • Recebido {p.CreditPaid:C}";
        }
        catch{CustomerPulseText.Text="Histórico do cliente disponível em HISTÓRICO.";}
    }

    private async void CustomerHistoryQuick_Click(object sender,RoutedEventArgs e)
    {
        if(_workflow.Cart.CustomerId is not Guid id){MessageBox.Show("Selecione um cliente primeiro.","Histórico do cliente",MessageBoxButton.OK,MessageBoxImage.Information);return;}
        var customer=await _customers.GetAsync(id);
        if(customer is null){MessageBox.Show("Cliente não encontrado.","Histórico do cliente");return;}
        new CustomerHistoryWindow(customer){Owner=this}.ShowDialog();
        await RefreshCustomerPulse0230();
    }

    private async void QuickPriceScanner_Click(object sender,RoutedEventArgs e)
    {
        var w=new QuickPriceScannerWindow(_workflow){Owner=this};
        if(w.ShowDialog()==true&&w.SelectedProduct is Product p)
        {
            await _workflow.AddExistingProductAsync(p);RefreshCart();
            var q=_workflow.Cart.Items.Where(x=>x.ProductId==p.Id).Sum(x=>x.Quantity);
            var alert=StockAlert0230.Evaluate(p,q);StockAlertText.Text=alert??string.Empty;StockAlertBorder.Visibility=alert is null?Visibility.Collapsed:Visibility.Visible;
            SetStatus($"{p.Name} ADICIONADO APÓS CONSULTA");
        }
        SearchBox.Focus();
    }

    private void ToggleFocusMode_Click(object sender,RoutedEventArgs e)=>ToggleFocusMode0230();
    private void ToggleFocusMode0230()
    {
        _focusMode0230=!_focusMode0230;
        if(_focusMode0230)
        {
            _navWidthBeforeFocus0230=NavColumn.Width;_salesHeightBeforeFocus0230=SalesHistoryRow.Height;
            _windowState030=WindowState; _windowStyle030=WindowStyle; WindowStyle=WindowStyle.None; WindowState=WindowState.Maximized;
            NavColumn.Width=new GridLength(0);SalesHistoryRow.Height=new GridLength(0);LastSalesBorder.Visibility=Visibility.Collapsed;
            SetStatus("MODO CAIXA EM TELA CHEIA — F11 PARA VOLTAR");
        }
        else
        {
            WindowStyle=_windowStyle030; WindowState=_windowState030;
            NavColumn.Width=_navWidthBeforeFocus0230;SalesHistoryRow.Height=_salesHeightBeforeFocus0230;LastSalesBorder.Visibility=Visibility.Visible;
            SetStatus("MODO COMPLETO RESTAURADO");
        }
        SearchBox.Focus();
    }

    private void ShowSaleToast0230(Sale sale)
    {
        SaleToastText.Text=$"VENDA {sale.Number:000000} CONCLUÍDA • {sale.Total:C}";
        SaleToastBorder.Visibility=Visibility.Visible;_saleToastTimer0230.Stop();_saleToastTimer0230.Start();
    }

    private async Task NextMultiSale0230()
    {
        if(_multiSales037.Count<2)return;
        var next=(_currentMultiSale037+1)%_multiSales037.Count;await SwitchMultiSale037(next);
    }

    private void MainWindow_Closing(object? sender,System.ComponentModel.CancelEventArgs e)
    {
        if(_multiSales037.Count>0){SyncCurrentMultiSale037();if(_multiSales037.All(x=>x.Cart.Items.Count==0))return;}else if(_workflow.Cart.Items.Count==0)return;
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
        SubtotalText.Text = $"Subtotal: {_workflow.Cart.GrossTotal:C}";
        DiscountText.Text = $"Desconto: {_workflow.Cart.Discount:C}";
        DiscountText.Visibility = _workflow.Cart.Discount > 0 ? Visibility.Visible : Visibility.Collapsed;
        CurrentSaleText.Text = _multiSales037.Count == 0 ? "Frente de Caixa" : $"VENDA {_multiSales037[_currentMultiSale037].Number} • EM ATENDIMENTO";
        if(_workflow.Cart.Items.Count==0){StockAlertText.Text=string.Empty;StockAlertBorder.Visibility=Visibility.Collapsed;}
        SyncCurrentMultiSale037(); // MULTISALE037
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
            if (!System.IO.File.Exists(file)) { ApplyAutomaticDisplaySettings(); return; }
            var p = System.IO.File.ReadAllText(file).Split(';');
            if (p.Length < 3) { ApplyAutomaticDisplaySettings(); return; }
            if (p[2] == "AUTO") { ApplyAutomaticDisplaySettings(); return; }
            if (p[2] == "MAX") { WindowState = WindowState.Maximized; return; }
            if (double.TryParse(p[0], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var w) && double.TryParse(p[1], System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var h))
            { Width = Math.Max(1240, w); Height = Math.Max(760, h); }
        }
        catch { }
    }
    private void Diagnostic_Click(object sender, RoutedEventArgs e) => new DiagnosticWindow(new DiagnosticService(_database, _paths)) { Owner = this }.ShowDialog();

    private async void Window_KeyDown(object sender, KeyEventArgs e)
    {
        if((Keyboard.Modifiers&ModifierKeys.Control)!=0&&e.Key==Key.N){e.Handled=true;NewMultiSale_Click(sender,e);return;}
        if((Keyboard.Modifiers&ModifierKeys.Control)!=0&&e.Key==Key.Tab){e.Handled=true;await NextMultiSale0230();return;}
        if(e.Key==Key.F1){e.Handled=true;ProductEntryTabs.SelectedIndex=0;SearchBox.Focus();SearchBox.SelectAll();SetStatus("SCANNER / BUSCA PRONTO");}
        else if(e.Key==Key.F2){e.Handled=true;Product_Click(sender,e);}
        else if(e.Key==Key.F3){e.Handled=true;Customer_Click(sender,e);}
        else if(e.Key==Key.F4){e.Handled=true;FocusDiversos();}
        else if(e.Key==Key.F5){e.Handled=true;QuickPriceScanner_Click(sender,e);}
        else if(e.Key==Key.F6){e.Handled=true;HoldSale_Click(sender,e);}
        else if(e.Key==Key.F7){e.Handled=true;FinalOps_Click(sender,e);}
        else if(e.Key==Key.F8){e.Handled=true;OpenLastSale();}
        else if(e.Key==Key.F9){e.Handled=true;Pay_Click(sender,e);}
        else if(e.Key==Key.F11){e.Handled=true;ToggleFocusMode0230();}
        else if(e.Key==Key.Escape){e.Handled=true;Cancel_Click(sender,e);}
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



