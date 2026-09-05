using System.Globalization;
using System.Windows;
using System.Windows.Input;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;
using OncaPDV.Printing;

namespace OncaPDV.Desktop;

public enum OperationsSection { Sales=0, Stock=1, Cash=2, Backup=3 }

public partial class OperationsWindow : Window
{
    private const string TerminalId = "CAIXA-01";
    private readonly OperationalService _ops;
    private readonly AppPaths _paths;
    private readonly OncaDatabase _db;
    private readonly Guid _operator;
    private DateTimeOffset _from = DateTimeOffset.Now.Date;
    private DateTimeOffset _to = DateTimeOffset.Now.Date.AddDays(1);
    private SalesSummary? _summary;
    private CashSnapshot? _cash;

    public OperationsWindow(OncaDatabase db, AppPaths paths, Guid op, OperationsSection section = OperationsSection.Sales)
    {
        _db = db;
        _ops = new(db, paths);
        _paths = paths;
        _operator = op;
        InitializeComponent();
        MainTabs.SelectedIndex = (int)section;
        From.SelectedDate = _from.Date;
        To.SelectedDate = _to.AddDays(-1).Date;
        Loaded += async (_, _) =>
        {
            await LoadSales();
            await LoadStock();
            await LoadCash();
            LoadBackups();
        };
    }

    private async Task LoadSales()
    {
        try
        {
            var paymentTag = (PaymentFilter.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Tag?.ToString() ?? "Todos";
            var statusTag = (SaleStatusFilter.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Tag?.ToString() ?? "Concluidas";
            PaymentMethod? method = paymentTag == "Todos" ? null : Enum.Parse<PaymentMethod>(paymentTag);
            _summary = await _ops.SalesSummaryFilteredAsync(_from, _to, statusTag, method);
            var rows = await _ops.SalesHistoryAsync(_from, _to, SalesSearch.Text, paymentTag, statusTag);
            SalesHistoryGrid.ItemsSource = rows;

            SalesCountText.Text = _summary.Quantity.ToString("N0");
            SalesItemsText.Text = rows.Sum(x => x.ItemQuantity).ToString("N2");
            SalesGrossText.Text = _summary.Gross.ToString("C");
            SalesDiscountText.Text = _summary.Discounts.ToString("C");
            SalesNetText.Text = _summary.Net.ToString("C");
            SalesCashText.Text = _summary.Cash.ToString("C");
            SalesDigitalText.Text = (_summary.Pix + _summary.Debit + _summary.Credit).ToString("C");
            SalesCreditText.Text = _summary.StoreCredit.ToString("C");
            SalesPeriodText.Text = $"Período: {_from:dd/MM/yyyy} até {_to.AddTicks(-1):dd/MM/yyyy} • PIX {_summary.Pix:C} • Débito {_summary.Debit:C} • Crédito {_summary.Credit:C} • filtros aplicados";
            HeaderStatus.Text = $"Histórico detalhado atualizado • {rows.Count} venda(s) exibida(s)";
        }
        catch (Exception ex)
        {
            HeaderStatus.Text = $"Falha ao carregar vendas: {ex.Message}";
        }
    }

    private async Task LoadStock()
    {
        try
        {
            var status = (StockStatusCombo.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Tag?.ToString() ?? "Todos";
            var rows = await _ops.StockAsync(false, StockSearch.Text, status);
            StockGrid.ItemsSource = rows;
            StockProductsText.Text = rows.Count.ToString("N0");
            StockLowText.Text = rows.Count(x => x.Status == "ESTOQUE BAIXO").ToString("N0");
            StockOutText.Text = rows.Count(x => x.Status == "SEM ESTOQUE").ToString("N0");
            StockUnitsText.Text = rows.Sum(x => x.Stock).ToString("N2");
            StockCostText.Text = rows.Sum(x => x.EstimatedCost).ToString("C");
            StockSaleText.Text = rows.Sum(x => x.EstimatedSale).ToString("C");
            HeaderStatus.Text = $"Estoque atualizado • {rows.Count} produto(s) exibido(s)";
            SelectedStockText.Text = StockGrid.SelectedItem is StockView selected ? $"{selected.Product} • {selected.Stock:N3} {selected.Unit}" : "Selecione um produto para ajustar ou ver movimentos";
        }
        catch (Exception ex)
        {
            HeaderStatus.Text = $"Falha ao carregar estoque: {ex.Message}";
        }
    }

    private async Task LoadCash()
    {
        try
        {
            _cash = await _ops.CashSnapshotAsync(_operator);
            OpenCashButton.Visibility = Visibility.Collapsed;
            CashOpenedText.Text = $"Aberto em {_cash.OpenedAt.ToLocalTime():dd/MM/yyyy HH:mm} • {_cash.SalesCount} venda(s) neste caixa";
            CashOpeningText.Text = _cash.Opening.ToString("C");
            CashTotalSalesText.Text = _cash.TotalSales.ToString("C");
            CashSalesText.Text = _cash.CashSales.ToString("C");
            CashPixText.Text = _cash.Pix.ToString("C");
            CashDebitText.Text = _cash.Debit.ToString("C");
            CashCreditCardText.Text = _cash.Credit.ToString("C");
            CashStoreCreditText.Text = _cash.StoreCreditGenerated.ToString("C");
            CashCreditReceiptsText.Text = _cash.CreditReceipts.ToString("C");
            CashSuppliesText.Text = _cash.Supplies.ToString("C");
            CashWithdrawalsText.Text = _cash.Withdrawals.ToString("C");
            CashExpectedText.Text = _cash.ExpectedCash.ToString("C");
            CloseOpeningText.Text = _cash.Opening.ToString("C");
            CloseCashSalesText.Text = _cash.CashSales.ToString("C");
            CloseEntriesText.Text = (_cash.CreditReceipts + _cash.Supplies).ToString("C");
            CloseWithdrawalsText.Text = _cash.Withdrawals.ToString("C");
            CloseExpectedText.Text = _cash.ExpectedCash.ToString("C");
            CashMovementsGrid.ItemsSource = await _ops.CashMovementsAsync(_cash.SessionId);
            CashHistoryGrid.ItemsSource = await _ops.CashSessionHistoryAsync(_operator, 12);

            // Fechamento simples: o valor esperado já vem preenchido.
            // O operador só altera se a contagem física da gaveta for diferente.
            Informed.Text = _cash.ExpectedCash.ToString("N2");
            RefreshDifference();
        }
        catch (InvalidOperationException)
        {
            _cash = null;
            OpenCashButton.Visibility = Visibility.Visible;
            var last = await _ops.LastClosedCashBalanceAsync(_operator);
            CashOpenedText.Text = $"Nenhum caixa aberto. Você pode abrir agora com o último saldo fechado ({last:C}) ou deixar a próxima venda abrir automaticamente.";
            CashOpeningText.Text = last.ToString("C");
            CashTotalSalesText.Text = CashSalesText.Text = CashPixText.Text =
                CashDebitText.Text = CashCreditCardText.Text = CashStoreCreditText.Text =
                CashCreditReceiptsText.Text = CashSuppliesText.Text = CashWithdrawalsText.Text = "R$ 0,00";
            CashExpectedText.Text = CloseOpeningText.Text = CloseExpectedText.Text = last.ToString("C");
            CloseCashSalesText.Text = CloseEntriesText.Text = CloseWithdrawalsText.Text = "R$ 0,00";
            CloseDifferenceText.Text = "R$ 0,00";
            Informed.Text = string.Empty;
            CashMovementsGrid.ItemsSource = null;
            CashHistoryGrid.ItemsSource = await _ops.CashSessionHistoryAsync(_operator, 12);
        }
        catch (Exception ex)
        {
            HeaderStatus.Text = $"Falha ao carregar caixa: {ex.Message}";
        }
    }

    private async void Today_Click(object sender, RoutedEventArgs e)
    {
        _from = DateTimeOffset.Now.Date;
        _to = _from.AddDays(1);
        From.SelectedDate = _from.Date;
        To.SelectedDate = _from.Date;
        await LoadSales();
    }

    private async void Yesterday_Click(object sender, RoutedEventArgs e)
    {
        _to = DateTimeOffset.Now.Date;
        _from = _to.AddDays(-1);
        From.SelectedDate = _from.Date;
        To.SelectedDate = _from.Date;
        await LoadSales();
    }

    private async void Month_Click(object sender, RoutedEventArgs e)
    {
        var n = DateTimeOffset.Now;
        _from = new DateTimeOffset(n.Year, n.Month, 1, 0, 0, 0, n.Offset);
        _to = _from.AddMonths(1);
        From.SelectedDate = _from.Date;
        To.SelectedDate = _to.AddDays(-1).Date;
        await LoadSales();
    }

    private async void Period_Click(object sender, RoutedEventArgs e)
    {
        if (From.SelectedDate is not DateTime f || To.SelectedDate is not DateTime t) return;
        if (t.Date < f.Date)
        {
            MessageBox.Show("A data final não pode ser anterior à data inicial.", "Período", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        _from = new DateTimeOffset(f.Date);
        _to = new DateTimeOffset(t.Date.AddDays(1));
        await LoadSales();
    }

    private async void SearchSales_Click(object sender, RoutedEventArgs e) => await LoadSales();

    private async void SalesFilter_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (IsLoaded) await LoadSales();
    }

    private async void ExportSalesCsv_Click(object sender, RoutedEventArgs e)
    {
        var rows = SalesHistoryGrid.ItemsSource?.Cast<SalesHistoryView>().ToArray() ?? [];
        if (rows.Length == 0)
        {
            MessageBox.Show("Não há vendas exibidas para exportar.", "Histórico", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        var file = await _ops.SalesCsvAsync(rows, _from, _to);
        MessageBox.Show($"CSV detalhado gerado:\n\n{file}", "Histórico de vendas", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private async void SalesSearch_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        await LoadSales();
    }

    private async void StockStatus_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (IsLoaded) await LoadStock();
    }

    private async void StockSearch_Click(object sender, RoutedEventArgs e) => await LoadStock();

    private async void StockSearch_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        await LoadStock();
    }

    private async void EditStockProduct_Click(object sender, RoutedEventArgs e) => await EditSelectedStockProductAsync();

    private async void StockGrid_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (StockGrid.SelectedItem is StockView) await OpenStockControlAsync();
    }

    private void StockGrid_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        SelectedStockText.Text = StockGrid.SelectedItem is StockView row
            ? $"{row.Product} • {row.Stock:N3} {row.Unit} • {row.Status}"
            : "Selecione um produto para ajustar ou ver movimentos";
    }

    private async void StockControl_Click(object sender, RoutedEventArgs e) => await OpenStockControlAsync();

    private async Task OpenStockControlAsync()
    {
        if (StockGrid.SelectedItem is not StockView row)
        {
            MessageBox.Show("Selecione um produto no estoque.", "Estoque", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        new StockControlWindow(_ops, row, _operator) { Owner = this }.ShowDialog();
        await LoadStock();
    }

    private async Task EditSelectedStockProductAsync()
    {
        if (StockGrid.SelectedItem is not StockView row)
        {
            MessageBox.Show("Selecione um produto no estoque.", "Estoque", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var repo = new SqliteProductRepository(_db);
        var product = await repo.FindAsync(row.Code);
        if (product is null)
        {
            MessageBox.Show("Produto não encontrado no cadastro.", "Estoque", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var advanced = new AdvancedOperationsService(_db, _paths);
        var metadata = await advanced.ProductMetadataAsync(product.Id);
        var dialog = new ProductWindow(existing: product, shelfLocation: metadata.ShelfLocation) { Owner = this };
        if (dialog.ShowDialog() != true || dialog.Product is null) return;
        try
        {
            await repo.SaveAsync(dialog.Product);
            await advanced.SaveProductMetadataAsync(dialog.Product.Id, dialog.ShelfLocation);
            await LoadStock();
            HeaderStatus.Text = $"Produto {dialog.Product.Name} atualizado. Estoque preservado.";
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Editar produto", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private SalesHistoryView? SelectedSaleRow() => SalesHistoryGrid.SelectedItem as SalesHistoryView;

    private async Task<Sale?> SelectedSaleAsync()
    {
        var row = SelectedSaleRow();
        if (row is null)
        {
            MessageBox.Show("Selecione uma venda no histórico.", "Histórico", MessageBoxButton.OK, MessageBoxImage.Information);
            return null;
        }
        return await _ops.SaleAsync(row.Id);
    }

    private async void SaleDetails_Click(object sender, RoutedEventArgs e)
    {
        var row = SelectedSaleRow();
        var sale = await SelectedSaleAsync();
        if (sale is null || row is null) return;
        new SaleDetailWindow(sale, row.Customer) { Owner = this }.ShowDialog();
    }

    private async void SalesHistoryGrid_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (SelectedSaleRow() is null) return;
        SaleDetails_Click(sender, e);
        await Task.CompletedTask;
    }

    private async void SelectedSalePdf_Click(object sender, RoutedEventArgs e)
    {
        var sale = await SelectedSaleAsync();
        if (sale is null) return;
        var file = await _ops.SalePdfAsync(sale, true);
        MessageBox.Show($"PDF gerado com sucesso:\n\n{file}", "Histórico de vendas", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private async void SelectedSaleReprint_Click(object sender, RoutedEventArgs e)
    {
        var row = SelectedSaleRow();
        var sale = await SelectedSaleAsync();
        if (sale is null || row is null) return;

        if (row.Status == "CANCELADA")
        {
            MessageBox.Show("Venda cancelada não pode ser reimpressa como comprovante válido.", "Histórico", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var result = await PrintSaleAsync(sale, row.Customer, true);
        MessageBox.Show(
            result.Result.Success
                ? $"Comprovante da venda {sale.Number:000000} enviado com sucesso.\n{result.Mode}"
                : $"A venda continua salva, mas a impressão falhou.\n\n{result.Result.Error}",
            "Reimpressão",
            MessageBoxButton.OK,
            result.Result.Success ? MessageBoxImage.Information : MessageBoxImage.Warning);
    }

    private async Task<(PrintResult Result, bool Physical, string Mode)> PrintSaleAsync(Sale sale, string? customer, bool reprint)
    {
        var printerProfile = await new TerminalPrinterProfileStore(_paths).LoadAsync(TerminalId);
        var company = await new CompanyReceiptProfileStore(_paths).LoadAsync();
        var codePage = printerProfile?.Encoding switch { "CP858" => 858, "CP860" => 860, _ => 850 };
        IReceiptRenderer renderer = printerProfile?.PaperWidthMm == 58
            ? new EscPos58Renderer(new CodePagePrinterEncoding(codePage))
            : new EscPos80Renderer(new CodePagePrinterEncoding(codePage));

        var document = new ReceiptDocument(
            sale,
            company.FantasyName,
            CustomerName: customer == "CONSUMIDOR" ? null : customer,
            OpenDrawer: printerProfile?.DrawerEnabled == true,
            Cut: printerProfile?.CutEnabled == true,
            IsReprint: reprint,
            Company: new ReceiptCompany(
                company.FantasyName, company.LegalName, company.Cnpj, company.StateRegistration,
                company.Phone, company.AddressLine1, company.AddressLine2, company.FooterMessage));

        if (printerProfile?.PhysicalPrintingEnabled == true && !string.IsNullOrWhiteSpace(printerProfile.PrinterName))
        {
            var service = new QueuedPrintService(new WindowsRawPrintService(renderer, _paths.Logs, true), _db);
            var result = await service.PrintAsync(document, printerProfile.PrinterName);
            return (result, true, $"Impressora: {printerProfile.PrinterName} • corte: {(printerProfile.CutEnabled ? "automático" : "desativado")}");
        }

        var mock = new QueuedPrintService(new MockPrintService(renderer, _paths.PrintPreview), _db);
        var preview = await mock.PrintAsync(document);
        return (preview, false, "Impressão física desativada; foi gerada uma prévia/mock.");
    }

    private async void ReportPdf_Click(object sender, RoutedEventArgs e)
    {
        if (_summary is null) return;
        var file = await _ops.SalesReportPdfAsync(_summary, _from, _to);
        MessageBox.Show($"PDF do período gerado:\n\n{file}", "Relatório de vendas", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private async void RefreshCash_Click(object sender, RoutedEventArgs e) => await LoadCash();

    private async void OpenCash_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await _ops.OpenCashAsync(_operator);
            await LoadCash();
            HeaderStatus.Text = "Caixa aberto com o último saldo fechado.";
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Abrir caixa", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void Supply_Click(object sender, RoutedEventArgs e) => await RegisterMovement(CashMovementType.Supply);
    private async void Withdrawal_Click(object sender, RoutedEventArgs e) => await RegisterMovement(CashMovementType.Withdrawal);

    private async Task RegisterMovement(CashMovementType type)
    {
        if (!TryMoney(MovementValue.Text, out var value) || value <= 0)
        {
            MessageBox.Show("Informe um valor válido maior que zero.", "Caixa", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var label = type == CashMovementType.Supply ? "suprimento" : "sangria";
        if (MessageBox.Show($"Confirmar {label} de {value:C}?", "Caixa", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;

        try
        {
            await _ops.RegisterCashMovementAsync(_operator, type, value, MovementReason.Text);
            MovementValue.Clear();
            MovementReason.Clear();
            await LoadCash();
            HeaderStatus.Text = $"{label.ToUpperInvariant()} registrado com sucesso.";
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Caixa", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void Informed_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e) => RefreshDifference();

    private void RefreshDifference()
    {
        if (CloseDifferenceText is null) return;
        var informed = TryMoney(Informed?.Text ?? string.Empty, out var v) ? v : 0m;
        var expected = _cash?.ExpectedCash ?? 0m;
        CloseDifferenceText.Text = (informed - expected).ToString("C");
        CloseDifferenceText.Foreground = informed == 0m || informed == expected
            ? System.Windows.Media.Brushes.DarkGreen
            : System.Windows.Media.Brushes.DarkRed;
    }

    private void UseExpected_Click(object sender, RoutedEventArgs e)
    {
        if (_cash is null) return;
        Informed.Text = _cash.ExpectedCash.ToString("N2");
        Informed.Focus();
        Informed.SelectAll();
    }

    private async void Close_Click(object sender, RoutedEventArgs e)
    {
        if (_cash is null)
        {
            MessageBox.Show("Não existe caixa aberto para fechar.", "Fechamento", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        if (!TryMoney(Informed.Text, out var value))
        {
            MessageBox.Show("Informe o dinheiro contado na gaveta.", "Fechamento", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (MessageBox.Show($"Fechar o caixa agora?\n\nEsperado: {_cash.ExpectedCash:C}\nInformado: {value:C}\nDiferença: {(value - _cash.ExpectedCash):C}", "Fechamento de caixa", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;

        try
        {
            var closing = await _ops.CloseCashAsync(_operator, value);
            var pdf = await _ops.ClosingPdfAsync(closing);
            var backup = await _ops.CreateBackupAsync();
            ClosingText.Text = $"CAIXA FECHADO • Esperado {closing.Expected:C} • Informado {closing.Informed:C} • Diferença {closing.Difference:C}\nPDF: {pdf}\nBackup: {backup}";
            await LoadCash();
            LoadBackups();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Fechamento", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void Backup_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            BackupStatus.Text = $"Backup válido criado em: {await _ops.CreateBackupAsync()}";
            LoadBackups();
        }
        catch (Exception ex) { BackupStatus.Text = ex.Message; }
    }

    private void LegacyImport_Click(object sender, RoutedEventArgs e) =>
        new LegacyImportWindow(_ops, _paths) { Owner = this }.ShowDialog();

    private async void Restore_Click(object sender, RoutedEventArgs e)
    {
        if (Backups.SelectedItem is not string file) return;
        if (MessageBox.Show("Validar e restaurar este backup?\n\nUm backup de segurança do banco atual será criado antes.", "Restauração", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;
        try
        {
            await _ops.RestoreAsync(file);
            BackupStatus.Text = "RESTAURAÇÃO CONCLUÍDA — migrations e integrity_check OK";
            await LoadSales();
            await LoadStock();
            await LoadCash();
        }
        catch (Exception ex)
        {
            BackupStatus.Text = $"RESTAURAÇÃO CANCELADA — banco atual preservado. {ex.Message}";
        }
    }

    private void LoadBackups()
    {
        _paths.EnsureCreated();
        Backups.ItemsSource = Directory.GetFiles(_paths.Backups, "*.zip").OrderByDescending(File.GetCreationTimeUtc).ToArray();
    }

    private static bool TryMoney(string text, out decimal value)
    {
        if (decimal.TryParse(text, NumberStyles.Number | NumberStyles.AllowCurrencySymbol, CultureInfo.CurrentCulture, out value)) return true;
        var normalized = (text ?? string.Empty).Replace("R$", string.Empty, StringComparison.OrdinalIgnoreCase).Trim().Replace('.', ',');
        return decimal.TryParse(normalized, NumberStyles.Number, CultureInfo.GetCultureInfo("pt-BR"), out value);
    }
}
