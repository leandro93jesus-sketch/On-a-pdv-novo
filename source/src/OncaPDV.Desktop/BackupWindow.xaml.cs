using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class BackupWindow : Window
{
    private readonly OperationalService _ops;
    private readonly AppPaths _paths;
    public BackupWindow(OncaDatabase db, AppPaths paths)
    {
        _paths = paths; _ops = new OperationalService(db, paths); InitializeComponent();
        Loaded += (_, _) => LoadBackups();
    }
    private void LoadBackups()
    {
        _paths.EnsureCreated();
        Backups.ItemsSource = Directory.GetFiles(_paths.Backups, "*.zip").OrderByDescending(File.GetCreationTimeUtc).ToArray();
        Status.Text = $"Pasta: {_paths.Backups}  •  {Backups.Items.Count} backup(s) encontrado(s).";
    }
    private async void Backup_Click(object sender, RoutedEventArgs e)
    {
        try { var file = await _ops.CreateBackupAsync(); LoadBackups(); Status.Text = $"BACKUP CRIADO E VALIDADO: {file}"; }
        catch (Exception ex) { Status.Text = "Falha ao criar backup: " + ex.Message; }
    }
    private async void Restore_Click(object sender, RoutedEventArgs e)
    {
        if (Backups.SelectedItem is not string file) { MessageBox.Show("Selecione um backup na lista.", "Backup"); return; }
        if (MessageBox.Show("Restaurar este backup? Um backup de segurança do banco atual será criado antes da restauração.", "Confirmar restauração", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        try { await _ops.RestoreAsync(file); Status.Text = "RESTAURAÇÃO CONCLUÍDA — integridade do banco validada."; MessageBox.Show("Backup restaurado com sucesso.", "ONÇA PDV", MessageBoxButton.OK, MessageBoxImage.Information); }
        catch (Exception ex) { Status.Text = "RESTAURAÇÃO CANCELADA: " + ex.Message; }
    }
    private void Folder_Click(object sender, RoutedEventArgs e) { _paths.EnsureCreated(); Process.Start(new ProcessStartInfo("explorer.exe", _paths.Backups) { UseShellExecute = true }); }
    private void Legacy_Click(object sender, RoutedEventArgs e) => new LegacyImportWindow(_ops, _paths) { Owner = this }.ShowDialog();
    private void Refresh_Click(object sender, RoutedEventArgs e) => LoadBackups();
}
