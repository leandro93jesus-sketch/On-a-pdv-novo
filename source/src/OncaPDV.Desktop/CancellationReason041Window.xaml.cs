using System;using System.Windows;
namespace OncaPDV.Desktop;
public partial class CancellationReason041Window:Window
{
    public string Reason {get;private set;}="";
    public CancellationReason041Window(long saleNumber)
    {
        InitializeComponent();
        SaleTitleText.Text=$"CANCELAR VENDA Nº {saleNumber:000000}";
        Loaded+=(_,_)=>ReasonBox.Focus();
    }
    private void Back_Click(object s,RoutedEventArgs e)=>DialogResult=false;
    private void Confirm_Click(object s,RoutedEventArgs e)
    {
        var text=ReasonBox.Text.Trim();
        if(text.Length<4){MessageBox.Show("Informe um motivo com pelo menos 4 caracteres.","Cancelamento",MessageBoxButton.OK,MessageBoxImage.Warning);ReasonBox.Focus();return;}
        Reason=text;DialogResult=true;
    }
}