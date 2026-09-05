using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class ChangePinWindow : Window
{
    private readonly PermissionService _security;
    private readonly AppUser _user;
    public ChangePinWindow(OncaDatabase db, AppUser user)
    {
        InitializeComponent();
        _security = new(db);
        _user = user;
        Loaded += (_, _) => CurrentPin.Focus();
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (NewPin.Password != ConfirmPin.Password)
        {
            StatusText.Text = "A confirmação não confere.";
            return;
        }

        try
        {
            await _security.ChangeOwnPinAsync(_user.Id, CurrentPin.Password, NewPin.Password);
            AppSession.CurrentUser = _user with { MustChangePin = false };
            DialogResult = true;
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
        }
    }
}
