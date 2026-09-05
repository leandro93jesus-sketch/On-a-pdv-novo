using System.Globalization;
using System.Windows;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class CustomerHistoryWindow:Window
{
    private static readonly Guid AdminOperator=Guid.Parse("10000000-0000-0000-0000-000000000001");
    private readonly CustomerProfile _customer;
    private readonly OperationalService _ops=new(AppServices.Database,AppServices.Paths);
    private readonly AdvancedOperationsService _advanced=new(AppServices.Database,AppServices.Paths);

    public CustomerHistoryWindow(CustomerProfile c)
    {
        _customer=c;InitializeComponent();TitleText.Text=c.Name;ContactText.Text=$"{c.TaxId??"Sem CPF/CNPJ"} • {c.Phone??c.Whatsapp??"Sem telefone"} • {c.Address??"Sem endereço"}";Loaded+=async(_,_)=>await LoadAsync();
    }

    private async Task LoadAsync()
    {
        _advanced.EnsureSchema();var account=await _advanced.CustomerAccountAsync(_customer.Id);LimitText.Text=account.CreditLimit.ToString("C");OpenText.Text=account.OpenBalance.ToString("C");OverdueText.Text=account.OverdueBalance.ToString("C");AvailableText.Text=account.AvailableLimit.ToString("C");NewLimit.Text=account.CreditLimit.ToString("N2");Sales.ItemsSource=await _ops.CustomerSalesAsync(_customer.Id);Credits.ItemsSource=await _ops.CreditsAsync("Todos",_customer.Id);
    }

    private async Task Pdf(bool second){if(Sales.SelectedItem is not Sale s){MessageBox.Show("Selecione uma venda.");return;}var file=await _ops.SalePdfAsync(s,second);MessageBox.Show($"PDF gerado:\n{file}");}
    private async void Pdf_Click(object s,RoutedEventArgs e)=>await Pdf(false);
    private async void Second_Click(object s,RoutedEventArgs e)=>await Pdf(true);
    private void Credit_Click(object s,RoutedEventArgs e)=>new CreditWindow(AppServices.Database,_customer.Id,true){Owner=this}.ShowDialog();
    private async void Limit_Click(object sender,RoutedEventArgs e)
    {
        if(!decimal.TryParse(NewLimit.Text,NumberStyles.Number,CultureInfo.CurrentCulture,out var limit)||limit<0){MessageBox.Show("Informe um limite válido.");return;}var auth=new AdminPinWindow(AppServices.Paths,"Alterar limite de crediário do cliente."){Owner=this};if(auth.ShowDialog()!=true||!auth.Authorized)return;var reason=new ReasonPromptWindow("Motivo da alteração do limite"){Owner=this};if(reason.ShowDialog()!=true)return;await _advanced.SetCustomerCreditLimitAsync(_customer.Id,limit,AdminOperator,reason.Reason);await LoadAsync();
    }
}
