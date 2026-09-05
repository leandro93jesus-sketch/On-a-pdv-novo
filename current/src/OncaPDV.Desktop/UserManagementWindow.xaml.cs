using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class UserManagementWindow : Window
{
    private readonly OncaDatabase _db;
    private readonly PermissionService _security;
    public UserManagementWindow(OncaDatabase db)
    {
        InitializeComponent();
        _db = db;
        _security = new(db);
        Loaded += async (_, _) => await LoadAsync();
    }
    private async Task LoadAsync() => UsersGrid.ItemsSource = await _security.UsersAsync(true);
    private async void New_Click(object sender, RoutedEventArgs e)
    {
        var w = new UserEditWindow(_db) { Owner = this };
        if (w.ShowDialog() == true) await LoadAsync();
    }
    private async void Edit_Click(object sender, RoutedEventArgs e)
    {
        if (UsersGrid.SelectedItem is not AppUser user) return;
        var w = new UserEditWindow(_db, user) { Owner = this };
        if (w.ShowDialog() == true) await LoadAsync();
    }
}
