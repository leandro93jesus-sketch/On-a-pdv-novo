using System.Diagnostics;
using System.Windows;
using OncaPDV.Domain;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class CustomerHistoryWindow : Window
{
    private readonly CustomerProfile _customer;
    private readonly OperationalService _ops = new(AppServices.Database, AppServices.Paths);
    private IReadOnlyList<Sale> _sales = [];

    public CustomerHistoryWindow(CustomerProfile c)
    {
        _customer=c;InitializeComponent();
        TitleText.Text=$"FICHA — {c.Name}";
        ContactText.Text=$"{c.Phone ?? c.WhatsApp ?? "Sem telefone"} • {c.TaxId ?? "Sem CPF/CNPJ"} • {c.City ?? ""} {c.State ?? ""}";
        Loaded+=async(_,_)=>await LoadAsync();
    }

    private async Task LoadAsync()
    {
        _sales=await _ops.CustomerSalesAsync(_customer.Id);
        Sales.ItemsSource=_sales.Select(s=>new SaleRow(
            s,
            s.Number,
            s.CreatedAt,
            string.Join(" | ",s.Items.Select(i=>$"{i.Name} x{i.Quantity:N2}")),
            s.Total,
            string.Join(" + ",s.Payments.Select(p=>$"{p.Method} {p.Amount:C}")))).ToArray();

        var credits=await _ops.CreditsAsync("Todos",_customer.Id);
        Credits.ItemsSource=credits;
        var profile=await _ops.CustomerCreditProfileAsync(_customer.Id);
        TotalBoughtText.Text=_sales.Sum(x=>x.Total).ToString("C");
        OpenCreditText.Text=profile.OpenBalance.ToString("C");
        OverdueText.Text=profile.OverdueAccounts.ToString();
        AvailableText.Text=profile.Available.ToString("C");
        StatusText.Text=$"{_sales.Count} compra(s) • {profile.OpenAccounts} conta(s) em aberto";
    }

    private Sale? SelectedSale()=>Sales.SelectedItem is SaleRow row?row.Sale:null;

    private async Task Pdf(bool second)
    {
        var sale=SelectedSale();
        if(sale is null){MessageBox.Show("Selecione uma venda.","Cliente",MessageBoxButton.OK,MessageBoxImage.Information);return;}
        var file=await _ops.SalePdfAsync(sale,second);
        MessageBox.Show($"PDF gerado:\n{file}","Cliente",MessageBoxButton.OK,MessageBoxImage.Information);
    }

    private async void Pdf_Click(object s,RoutedEventArgs e)=>await Pdf(false);
    private async void Second_Click(object s,RoutedEventArgs e)=>await Pdf(true);

    private void Credit_Click(object sender,RoutedEventArgs e)=>
        new CreditWindow(AppServices.Database,_customer.Id,true){Owner=this}.ShowDialog();

    private async void WhatsApp_Click(object sender,RoutedEventArgs e)
    {
        var phone=string.Concat((_customer.WhatsApp??_customer.Phone??"").Where(char.IsDigit));
        if(phone.Length<10){MessageBox.Show("Cliente sem WhatsApp válido.","WhatsApp",MessageBoxButton.OK,MessageBoxImage.Information);return;}
        var credits=await _ops.CreditsAsync("Todos",_customer.Id);
        var open=credits.Sum(x=>x.Balance);
        var text=Uri.EscapeDataString($"Olá {_customer.Name}, segue o resumo do seu crediário na Onça Produtos de Limpeza. Saldo em aberto: {open:C}.");
        var international=phone.StartsWith("55")?phone:"55"+phone;
        try{Process.Start(new ProcessStartInfo($"https://wa.me/{international}?text={text}"){UseShellExecute=true});}
        catch(Exception ex){MessageBox.Show(ex.Message,"WhatsApp",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

    private sealed record SaleRow(Sale Sale,long Number,DateTimeOffset Date,string Products,decimal Total,string Payments);
}
