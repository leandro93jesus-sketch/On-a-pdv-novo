using System.Windows;
using System.Windows.Input;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class AdminPinWindow:Window
{
    private readonly AccessControlStore _store;
    public bool Authorized{get;private set;}
    public AdminPinWindow(AppPaths paths,string reason)
    {
        InitializeComponent();_store=new(paths);ReasonText.Text=reason;Loaded+=(_,_)=>Pin.Focus();
    }
    private async Task AuthorizeAsync()
    {
        if(await _store.ValidatePinAsync(Pin.Password,UserRole.Administrator)){Authorized=true;DialogResult=true;return;}
        MessageBox.Show("PIN de administrador inválido.","Autorização",MessageBoxButton.OK,MessageBoxImage.Warning);Pin.Clear();Pin.Focus();
    }
    private async void Authorize_Click(object sender,RoutedEventArgs e)=>await AuthorizeAsync();
    private async void Pin_KeyDown(object sender,KeyEventArgs e){if(e.Key==Key.Enter){e.Handled=true;await AuthorizeAsync();}}
}
