using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class AdminAuthorizationWindow : Window
{
    private readonly PermissionService _security;
    public string Reason { get; private set; } = string.Empty;

    public AdminAuthorizationWindow(OncaDatabase db, string action)
    {
        InitializeComponent();
        _security = new(db);
        ActionText.Text = action;
        Loaded += (_, _) => PinBox.Focus();
    }

    private async void Authorize_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(ReasonBox.Text))
        {
            StatusText.Text = "Informe o motivo da autorização.";
            ReasonBox.Focus();
            return;
        }
        if (!await _security.ValidateAdminPinAsync(PinBox.Password))
        {
            StatusText.Text = "PIN de administrador inválido.";
            PinBox.SelectAll();
            PinBox.Focus();
            return;
        }
        Reason = ReasonBox.Text.Trim();
        DialogResult = true;
    }
}
