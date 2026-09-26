using System;
using System.Windows;
using OncaPDV.Infrastructure;
namespace OncaPDV.Desktop;
public partial class AdminAuthorization040Window : Window
{
    private readonly AdminPinService040 _service;
    private readonly bool _firstSetup;
    public string AuthorizedName {get;private set;}="";
    public AdminAuthorization040Window(OncaDatabase db)
    {
        _service=new AdminPinService040(db);
        _firstSetup=!_service.IsConfigured;
        InitializeComponent();
        if(_firstSetup)
        {
            HeaderText.Text="PRIMEIRO USO — CONFIGURE O PIN DO RESPONSÁVEL";
            MessageBox.Show("O responsável pela loja deve definir um PIN de administrador. Não há senha padrão. Guarde o PIN em local seguro.","ONÇA PDV — Primeiro uso",MessageBoxButton.OK,MessageBoxImage.Information);
        }
        else
        {
            HeaderText.Text="CANCELAMENTO/EDIÇÃO EXIGE PIN";
            AdminNameBox.Text=_service.AdministratorName;
            AdminNameBox.IsReadOnly=true;
            ConfirmPanel.Visibility=Visibility.Collapsed;
        }
        Loaded+=(_,_)=> (_firstSetup ? AdminNameBox : PinBox).Focus();
    }
    private void Cancel_Click(object s,RoutedEventArgs e)=>DialogResult=false;
    private void Authorize_Click(object s,RoutedEventArgs e)
    {
        try
        {
            if(_firstSetup)
            {
                _service.Configure(AdminNameBox.Text,PinBox.Password,ConfirmBox.Password);
                AuthorizedName=_service.AdministratorName;
            }
            else
            {
                if(!_service.Verify(PinBox.Password)){PinBox.Clear();MessageBox.Show("PIN incorreto. Cancelamento não autorizado.","ONÇA PDV",MessageBoxButton.OK,MessageBoxImage.Warning);return;}
                AuthorizedName=_service.AdministratorName;
            }
            DialogResult=true;
        }
        catch(Exception ex){MessageBox.Show(ex.Message,"Autorização de administrador",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }
}
