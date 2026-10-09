using System;
using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class AdminRecovery043Window:Window
{
    private readonly AdminPinService040 _service;
    public AdminRecovery043Window(OncaDatabase db)
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
            _service.CompleteOwnerRecovery043(AdminNameBox.Text,PinBox.Password,ConfirmBox.Password);
            DialogResult=true;
        }
        catch(Exception ex)
        {
            MessageBox.Show(ex.Message,"Recuperação do PIN",MessageBoxButton.OK,MessageBoxImage.Warning);
            PinBox.Clear();ConfirmBox.Clear();PinBox.Focus();
        }
    }
}