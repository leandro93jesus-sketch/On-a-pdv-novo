using System.Windows;
using System.Windows.Controls;
using OncaPDV.Application;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class CreditWindow : Window
{
    private readonly OncaDatabase _db;
    private readonly Guid _operator;
    private readonly Guid? _customer;
    private readonly OperationalService _ops;
    private IReadOnlyList<CreditView> _current = [];
    private string _status = "Todos";

    public CreditWindow(OncaDatabase db, Guid operatorId) : this(db, null, operatorId) { }

    public CreditWindow(OncaDatabase db, Guid customerId, bool customerFilter)
        : this(db, customerFilter ? customerId : null, Guid.Parse("10000000-0000-0000-0000-000000000001")) { }

    private CreditWindow(OncaDatabase db, Guid? customer, Guid op)
    {
        _db = db;
        _operator = op;
        _customer = customer;
        _ops = new(db, AppServices.Paths);
        InitializeComponent();
        Loaded += async (_, _) => await Refresh();
    }

    private async Task Refresh()
    {
        _current = await _ops.CreditsAsync(_status, _customer);
        ApplySearch();
        UpdateSummary(_current);
    }

    private void ApplySearch()
    {
        if (Accounts is null) return;
        var term = SearchBox?.Text?.Trim() ?? string.Empty;
        Accounts.ItemsSource = string.IsNullOrWhiteSpace(term)
            ? _current
            : _current.Where(x => x.Customer.Contains(term, StringComparison.CurrentCultureIgnoreCase)).ToArray();
    }

    private void UpdateSummary(IReadOnlyList<CreditView> items)
    {
        TotalOpenText.Text = items.Where(x => x.Status is not CreditStatus.Paid and not CreditStatus.Cancelled).Sum(x => x.Balance).ToString("C");
        TotalPaidText.Text = items.Sum(x => x.Paid).ToString("C");
        OverdueText.Text = items.Count(x => x.Status == CreditStatus.Overdue).ToString();
        AccountsCountText.Text = items.Count.ToString();
    }

    private async void FilterButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button button) return;
        _status = Convert.ToString(button.Tag) ?? "Todos";
        ActiveFilterText.Text = $"Filtro: {button.Content}";
        await Refresh();
    }

    private void Search_Changed(object sender, TextChangedEventArgs e) => ApplySearch();

    private async void Account_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (Accounts.SelectedItem is not CreditView account)
        {
            Movements.ItemsSource = null;
            SelectedCustomerText.Text = "Selecione uma conta";
            SelectedSaleText.Text = "Venda: —";
            SelectedOriginalText.Text = 0m.ToString("C");
            SelectedPaidText.Text = 0m.ToString("C");
            SelectedBalanceText.Text = 0m.ToString("C");
            SelectedDueText.Text = "—";
            SelectedStatusText.Text = "—";
            return;
        }

        SelectedCustomerText.Text = account.Customer;
        SelectedSaleText.Text = $"Venda: {account.SaleNumber:000000}";
        SelectedOriginalText.Text = account.Original.ToString("C");
        SelectedPaidText.Text = account.Paid.ToString("C");
        SelectedBalanceText.Text = account.Balance.ToString("C");
        SelectedDueText.Text = account.DueAt.ToString("dd/MM/yyyy");
        SelectedStatusText.Text = StatusLabel(account.Status);
        Movements.ItemsSource = await _ops.CreditMovementsAsync(account.Id);
    }

    private async void Receive_Click(object sender, RoutedEventArgs e)
    {
        if (Accounts.SelectedItem is not CreditView account || account.Balance <= 0)
        {
            MessageBox.Show("Selecione uma conta com saldo em aberto.", "Crediário", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var window = new ReceiveCreditWindow(account) { Owner = this };
        if (window.ShowDialog() != true) return;

        try
        {
            var previousBalance = account.Balance;
            var session = await new SqliteCashSessionRepository(_db, new SystemClock()).GetOrOpenAsync(_operator);
            var receipt = await new SqliteCreditRepository(_db, new SystemClock())
                .ReceiveAsync(account.Id, window.Amount, window.Method, _operator, session.Id, window.Notes);

            await Refresh();
            var updated = (await _ops.CreditsAsync("Todos", account.CustomerId)).First(x => x.Id == account.Id);
            var status = StatusLabel(updated.Status);

            var answer = MessageBox.Show(
                $"RECEBIMENTO CONFIRMADO\n\nCliente: {updated.Customer}\nSaldo anterior: {previousBalance:C}\nRecebido: {receipt.Amount:C}\nSaldo restante: {updated.Balance:C}\nStatus: {status}\n\nDeseja gerar o comprovante em PDF?",
                "Crediário",
                MessageBoxButton.YesNo,
                MessageBoxImage.Information);

            if (answer == MessageBoxResult.Yes)
            {
                var pdf = await _ops.ReceiptPdfAsync(updated, receipt);
                MessageBox.Show($"COMPROVANTE GERADO\n\n{pdf}", "Crediário", MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Crediário — não foi possível receber", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void Pdf_Click(object sender, RoutedEventArgs e)
    {
        if (Accounts.SelectedItem is not CreditView account)
        {
            MessageBox.Show("Selecione uma conta para gerar o extrato.", "Crediário", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var pdf = await _ops.CreditPdfAsync(account, await _ops.CreditMovementsAsync(account.Id));
        MessageBox.Show($"EXTRATO GERADO\n\n{pdf}", "Crediário", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private async void ReverseReceipt_Click(object sender,RoutedEventArgs e)
    {
        if(Movements.SelectedItem is not CreditMovement movement){MessageBox.Show("Selecione um recebimento na lista de movimentos.");return;}
        var reason=Microsoft.VisualBasic.Interaction.InputBox("Motivo obrigatório do estorno:","Estornar recebimento","");if(string.IsNullOrWhiteSpace(reason))return;
        if(MessageBox.Show($"Estornar o recebimento de {movement.Amount:C}? O saldo do cliente e o caixa serão corrigidos.","Crediário",MessageBoxButton.YesNo,MessageBoxImage.Warning)!=MessageBoxResult.Yes)return;
        try{await new AdvancedOperationsService(_db).ReverseCreditReceiptAsync(movement.Id,_operator,reason);await Refresh();MessageBox.Show("Recebimento estornado e saldo recalculado.");}catch(Exception ex){MessageBox.Show(ex.Message,"Crediário",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

    private async void WhatsApp_Click(object sender,RoutedEventArgs e)
    {
        if(Accounts.SelectedItem is not CreditView account){MessageBox.Show("Selecione uma conta.");return;}
        var pdf=await _ops.CreditPdfAsync(account,await _ops.CreditMovementsAsync(account.Id));
        var text=Uri.EscapeDataString($"Onça Produtos de Limpeza - Extrato de crediário\nCliente: {account.Customer}\nSaldo: {account.Balance:C}\nArquivo gerado: {pdf}");
        try{System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo($"https://wa.me/?text={text}"){UseShellExecute=true});}catch{System.Windows.Clipboard.SetText($"Extrato: {pdf}");MessageBox.Show("Não foi possível abrir o WhatsApp. O caminho do extrato foi copiado.");}
    }

    private static string StatusLabel(CreditStatus status) => status switch
    {
        CreditStatus.Open => "Em aberto",
        CreditStatus.Partial => "Parcial",
        CreditStatus.Paid => "Pago",
        CreditStatus.Overdue => "Vencido",
        CreditStatus.Cancelled => "Cancelado",
        _ => status.ToString()
    };
}
