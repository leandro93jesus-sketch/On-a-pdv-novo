using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class UserEditWindow : Window
{
    private readonly PermissionService _security;
    private readonly AppUser _user;
    public UserEditWindow(OncaDatabase db, AppUser? user = null)
    {
        InitializeComponent();
        _security = new(db);
        _user = user ?? new AppUser(Guid.NewGuid(), "", "", UserRole.Caixa, true, false);
        RoleBox.ItemsSource = Enum.GetValues<UserRole>();
        DisplayNameBox.Text = _user.DisplayName;
        UsernameBox.Text = _user.Username;
        RoleBox.SelectedItem = _user.Role;
        ActiveBox.IsChecked = _user.Active;
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var role = RoleBox.SelectedItem is UserRole r ? r : UserRole.Caixa;
            var updated = _user with
            {
                DisplayName = DisplayNameBox.Text.Trim(),
                Username = UsernameBox.Text.Trim(),
                Role = role,
                Active = ActiveBox.IsChecked == true
            };
            await _security.SaveUserAsync(updated, string.IsNullOrWhiteSpace(PinBox.Password) ? null : PinBox.Password);
            DialogResult = true;
        }
        catch (Exception ex) { StatusText.Text = ex.Message; }
    }
}
