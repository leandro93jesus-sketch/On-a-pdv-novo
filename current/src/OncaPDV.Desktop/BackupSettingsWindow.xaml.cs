using System.Windows;
using Microsoft.Win32;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class BackupSettingsWindow : Window
{
    private readonly AppPaths _paths;
    private readonly AutomaticBackupSettingsStore _store;
    private readonly OperationalService _ops;

    public BackupSettingsWindow(OncaDatabase db, AppPaths paths)
    {
        InitializeComponent();
        _paths = paths;
        _store = new(paths);
        _ops = new(db, paths);
        Loaded += async (_, _) => await LoadAsync();
    }

    private async Task LoadAsync()
    {
        var settings = await _store.LoadAsync();
        EnabledBox.IsChecked = settings.Enabled;
        RetentionBox.Text = settings.Retention.ToString();
        ExternalFolderBox.Text = settings.ExternalFolder ?? string.Empty;
        var status = await _ops.BackupStatusAsync();
        LastBackupText.Text = status.LastBackup is null
            ? "Ainda não há backup automático registrado."
            : $"{status.LastBackup.Value.ToLocalTime():dd/MM/yyyy HH:mm:ss} • {status.Status}" +
              (string.IsNullOrWhiteSpace(status.ExternalPath) ? "" : $"\nCópia externa: {status.ExternalPath}");
    }

    private void Browse_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Escolha a pasta externa para backup" };
        if (dialog.ShowDialog() == true) ExternalFolderBox.Text = dialog.FolderName;
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!int.TryParse(RetentionBox.Text, out var retention))
        {
            StatusText.Text = "Retenção inválida.";
            return;
        }
        try
        {
            await _store.SaveAsync(new(EnabledBox.IsChecked == true, retention, ExternalFolderBox.Text));
            StatusText.Text = "Configuração de backup salva.";
            await LoadAsync();
        }
        catch (Exception ex) { StatusText.Text = ex.Message; }
    }

    private async void BackupNow_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var settings = await _store.LoadAsync();
            var file = await _ops.CreateBackupAsync(settings.Retention);
            if (!string.IsNullOrWhiteSpace(settings.ExternalFolder))
            {
                Directory.CreateDirectory(settings.ExternalFolder);
                var ext = Path.Combine(settings.ExternalFolder, Path.GetFileName(file));
                if (!File.Exists(ext)) File.Copy(file, ext);
            }
            StatusText.Text = $"Backup gerado com sucesso:\n{file}";
            await LoadAsync();
        }
        catch (Exception ex) { StatusText.Text = $"Falha: {ex.Message}"; }
    }
}
