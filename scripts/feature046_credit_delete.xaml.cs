using System.Windows;
namespace OncaPDV.Desktop;
public partial class CreditExclusion046Window:Window
{
    public string Reason {get;private set;}="";
    public CreditExclusion046Window(string customer,long saleNumber,decimal balance,decimal paid)
    {
        InitializeComponent();
        AccountText.Text=$"Cliente: {customer}  |  Venda {saleNumber:000000}\nSaldo a excluir: {balance:C}  |  Pagamentos preservados: {paid:C}";
        Loaded+=(_,_)=>ReasonBox.Focus();
    }
    private void Back_Click(object s,RoutedEventArgs e)=>DialogResult=false;
    private void Confirm_Click(object s,RoutedEventArgs e)
    {
        var value=ReasonBox.Text.Trim();
        if(value.Length<4){MessageBox.Show("Informe um motivo com pelo menos 4 caracteres.","Excluir crediário",MessageBoxButton.OK,MessageBoxImage.Warning);return;}
        Reason=value;DialogResult=true;
    }
}