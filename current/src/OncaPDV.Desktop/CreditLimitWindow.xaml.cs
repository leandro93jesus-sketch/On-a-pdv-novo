using System.Globalization;
using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class CreditLimitWindow : Window
{
    private readonly OperationalService _ops;
    private readonly Guid _customerId;
    private readonly Guid _userId;

    public CreditLimitWindow(OperationalService ops, Guid customerId, Guid userId)
    {
        InitializeComponent(); _ops=ops; _customerId=customerId; _userId=userId;
        Loaded+=async(_,_)=>await LoadAsync();
    }

    private async Task LoadAsync()
    {
        var p=await _ops.CustomerCreditProfileAsync(_customerId);
        CustomerText.Text=p.Customer;
        OpenText.Text=p.OpenBalance.ToString("C");
        AvailableText.Text=p.Available.ToString("C");
        LimitBox.Text=p.Limit.ToString("N2");
        BlockedBox.IsChecked=p.Blocked;
    }

    private async void Save_Click(object sender,RoutedEventArgs e)
    {
        if(!TryMoney(LimitBox.Text,out var limit)){StatusText.Text="Limite inválido.";return;}
        try
        {
            await _ops.SetCustomerCreditLimitAsync(_customerId,limit,BlockedBox.IsChecked==true,NotesBox.Text,_userId);
            DialogResult=true;
        }
        catch(Exception ex){StatusText.Text=ex.Message;}
    }

    private static bool TryMoney(string text,out decimal value)
    {
        if(decimal.TryParse(text,NumberStyles.Number|NumberStyles.AllowCurrencySymbol,CultureInfo.CurrentCulture,out value))return true;
        return decimal.TryParse((text??"").Replace("R$","",StringComparison.OrdinalIgnoreCase).Trim().Replace('.',','),NumberStyles.Number,CultureInfo.GetCultureInfo("pt-BR"),out value);
    }
}
