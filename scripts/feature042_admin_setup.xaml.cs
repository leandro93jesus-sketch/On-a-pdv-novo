using System;
using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class AdminPinSetup042Window:Window
{
    private readonly AdminPinService040 _service;
    public AdminPinSetup042Window(OncaDatabase db)
    {
        _service=new AdminPinService040(db);
        InitializeComponent();
        Loaded+=(_,_)=>PinBox.Focus();
    }
    private void Later_Click(object sender,RoutedEventArgs e)=>DialogResult=false;
    private void Save_Click(object sender,RoutedEventArgs e)
    {
        try
        {
            _service.ConfigureOwnerPinOnce042(AdminNameBox.Text,PinBox.Password,ConfirmBox.Password);
            MessageBox.Show("Novo PIN administrativo salvo. A partir de agora, use-o para autorizar cancelamentos.","ONÇA PDV",MessageBoxButton.OK,MessageBoxImage.Information);
            DialogResult=true;
        }
        catch(Exception ex)
        {
            MessageBox.Show(ex.Message,"Não foi possível configurar o PIN",MessageBoxButton.OK,MessageBoxImage.Warning);
            PinBox.Clear();ConfirmBox.Clear();PinBox.Focus();
        }
    }
}