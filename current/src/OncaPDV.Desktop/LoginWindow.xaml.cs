using System.Windows;
using System.Windows.Input;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class LoginWindow : Window
{
    private readonly PermissionService _security;
    public AppUser? SelectedUser { get; private set; }

    public LoginWindow(OncaDatabase db)
    {
        InitializeComponent();
        _security = new(db);
        Loaded += async (_, _) =>
        {
            var users = await _security.UsersAsync(false);
            UserBox.ItemsSource = users;
            UserBox.SelectedIndex = users.Count > 0 ? 0 : -1;
            FirstAccessPanel.Visibility = users.Any(x => x.Username.Equals("admin", StringComparison.OrdinalIgnoreCase) && x.MustChangePin)
                ? Visibility.Visible : Visibility.Collapsed;
            PinBox.Focus();
        };
    }

    private async Task LoginAsync()
    {
        if (UserBox.SelectedItem is not AppUser user)
        {
            StatusText.Text = "Selecione o usuário.";
            return;
        }

        var authenticated = await _security.AuthenticateAsync(user.Username, PinBox.Password);
        if (authenticated is null)
        {
            StatusText.Text = "PIN incorreto.";
            PinBox.SelectAll();
            PinBox.Focus();
            return;
        }

        SelectedUser = authenticated;
        DialogResult = true;
    }

    private async void Login_Click(object sender, RoutedEventArgs e) => await LoginAsync();
    private async void PinBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        e.Handled = true;
        await LoginAsync();
    }
}
