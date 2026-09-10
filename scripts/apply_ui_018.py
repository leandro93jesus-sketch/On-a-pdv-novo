from pathlib import Path
import re

root = Path('work-final/ONCA-PDV-PRO').resolve()
desktop = root / 'src' / 'OncaPDV.Desktop'

# Force pt-BR globally so currency formatting uses R$.
app = desktop / 'App.xaml.cs'
t = app.read_text(encoding='utf-8-sig')
if 'DefaultThreadCurrentCulture' not in t:
    pat = r'(\s*protected override void OnStartup\(StartupEventArgs e\)\s*\{)'
    m = re.search(pat, t)
    if not m:
        raise RuntimeError('App OnStartup anchor missing')
    inject = '''
    protected override void OnStartup(StartupEventArgs e)
    {
        var culture = System.Globalization.CultureInfo.GetCultureInfo("pt-BR");
        System.Globalization.CultureInfo.DefaultThreadCurrentCulture = culture;
        System.Globalization.CultureInfo.DefaultThreadCurrentUICulture = culture;
        System.Threading.Thread.CurrentThread.CurrentCulture = culture;
        System.Threading.Thread.CurrentThread.CurrentUICulture = culture;
        System.Windows.FrameworkElement.LanguageProperty.OverrideMetadata(
            typeof(System.Windows.FrameworkElement),
            new System.Windows.FrameworkPropertyMetadata(System.Windows.Markup.XmlLanguage.GetLanguage("pt-BR")));
'''
    t = t[:m.start()] + inject + t[m.end():]
    app.write_text(t, encoding='utf-8')

# Polished DIVERSOS dialog, same behavior/code-behind.
(desktop / 'DiversosWindow.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.DiversosWindow"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Adicionar item diverso" Width="520" Height="410" MinWidth="500" MinHeight="390"
        WindowStartupLocation="CenterOwner" Background="#F7F9F8" FontFamily="Segoe UI">
    <Window.Resources>
        <Style x:Key="ActionButton" TargetType="Button">
            <Setter Property="Padding" Value="20,12"/><Setter Property="Margin" Value="5"/>
            <Setter Property="FontWeight" Value="SemiBold"/><Setter Property="FontSize" Value="15"/>
            <Setter Property="BorderThickness" Value="0"/><Setter Property="Cursor" Value="Hand"/>
        </Style>
    </Window.Resources>
    <Grid>
        <Grid.RowDefinitions><RowDefinition Height="92"/><RowDefinition Height="*"/></Grid.RowDefinitions>
        <Border Background="#0B6B3A" CornerRadius="0,0,18,18">
            <StackPanel Margin="26,18">
                <TextBlock Text="DIVERSOS" Foreground="White" FontSize="27" FontWeight="Bold"/>
                <TextBlock Text="Venda rápida de item sem cadastro e sem movimentar estoque" Foreground="#DDEFE5" FontSize="14" Margin="0,5,0,0"/>
            </StackPanel>
        </Border>
        <Border Grid.Row="1" Margin="24,18,24,24" Background="White" CornerRadius="14" BorderBrush="#DCE5DF" BorderThickness="1" Padding="22">
            <Grid>
                <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
                <TextBlock Text="VALOR DO ITEM" FontWeight="SemiBold" Foreground="#526159" FontSize="13"/>
                <Border Grid.Row="1" Margin="0,7,0,16" BorderBrush="#B8C8BE" BorderThickness="1.2" CornerRadius="9" Background="#FBFCFB">
                    <Grid><Grid.ColumnDefinitions><ColumnDefinition Width="65"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
                        <Border Background="#EDF6F0" CornerRadius="8,0,0,8"><TextBlock Text="R$" VerticalAlignment="Center" HorizontalAlignment="Center" FontSize="22" FontWeight="Bold" Foreground="#0B6B3A"/></Border>
                        <TextBox Grid.Column="1" x:Name="PriceBox" BorderThickness="0" Background="Transparent" FontSize="27" FontWeight="SemiBold" Padding="12,9" VerticalContentAlignment="Center" KeyDown="PriceBox_KeyDown"/>
                    </Grid>
                </Border>
                <TextBlock Grid.Row="2" Text="DESCRIÇÃO DO PRODUTO" FontWeight="SemiBold" Foreground="#526159" FontSize="13"/>
                <TextBox Grid.Row="3" x:Name="DescriptionBox" Margin="0,7,0,4" Padding="11" FontSize="16" MinHeight="44" BorderBrush="#B8C8BE" ToolTip="Ex.: detergente avulso, pano especial, produto sem cadastro"/>
                <TextBlock Grid.Row="4" Text="A descrição é opcional. Se ficar vazia, será usado DIVERSOS." Foreground="#7A8780" FontSize="12" Margin="2,4,0,0"/>
                <Grid Grid.Row="5" Margin="0,16,0,0"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="*"/></Grid.ColumnDefinitions>
                    <Button Grid.Column="0" Style="{StaticResource ActionButton}" Content="CANCELAR" Background="#EEF1EF" Foreground="#33423A" IsCancel="True"/>
                    <Button Grid.Column="1" Style="{StaticResource ActionButton}" Content="ADICIONAR AO CARRINHO" Background="#0B6B3A" Foreground="White" Click="Add_Click" IsDefault="True"/>
                </Grid>
            </Grid>
        </Border>
    </Grid>
</Window>
''', encoding='utf-8')

(desktop / 'BackupWindow.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.BackupWindow"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="ONÇA PDV PRO - Backup" Width="900" Height="650" MinWidth="760" MinHeight="540"
        WindowStartupLocation="CenterOwner" Background="#F7F9F8" FontFamily="Segoe UI">
    <Grid Margin="22">
        <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
        <StackPanel><TextBlock Text="BACKUP E RESTAURAÇÃO" FontSize="27" FontWeight="Bold" Foreground="#0B6B3A"/><TextBlock Text="Central única para proteger, localizar e restaurar os dados do ONÇA PDV." Foreground="#66746C" Margin="0,4,0,0"/></StackPanel>
        <WrapPanel Grid.Row="1" Margin="0,18,0,14">
            <Button Content="💾 CRIAR BACKUP AGORA" Padding="18,12" Margin="0,0,8,8" Background="#0B6B3A" Foreground="White" FontWeight="SemiBold" Click="Backup_Click"/>
            <Button Content="↥ IMPORTAR PDV ANTIGO" Padding="18,12" Margin="0,0,8,8" Click="Legacy_Click"/>
            <Button Content="📁 ABRIR PASTA" Padding="18,12" Margin="0,0,8,8" Click="Folder_Click"/>
            <Button Content="↻ ATUALIZAR LISTA" Padding="18,12" Margin="0,0,8,8" Click="Refresh_Click"/>
        </WrapPanel>
        <Border Grid.Row="2" Background="White" BorderBrush="#DCE5DF" BorderThickness="1" CornerRadius="12" Padding="14">
            <Grid><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
                <TextBlock Text="BACKUPS DISPONÍVEIS" FontWeight="Bold" Foreground="#33423A" Margin="2,0,0,10"/>
                <ListBox Grid.Row="1" x:Name="Backups" FontSize="14" BorderThickness="0" ScrollViewer.HorizontalScrollBarVisibility="Auto"/>
            </Grid>
        </Border>
        <Grid Grid.Row="3" Margin="0,14,0,0"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
            <TextBlock x:Name="Status" Text="Selecione um backup para restaurar ou crie um novo." Foreground="#55645C" TextWrapping="Wrap" VerticalAlignment="Center" Margin="0,0,15,0"/>
            <Button Grid.Column="1" Content="RESTAURAR SELECIONADO" Padding="20,12" Background="#D28A14" Foreground="White" FontWeight="Bold" Click="Restore_Click"/>
        </Grid>
    </Grid>
</Window>
''', encoding='utf-8')

(desktop / 'BackupWindow.xaml.cs').write_text(r'''using System;
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
''', encoding='utf-8')

(desktop / 'DisplaySettingsWindow.xaml').write_text(r'''<Window x:Class="OncaPDV.Desktop.DisplaySettingsWindow" xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Tela e tamanho" Width="610" Height="500" MinWidth="560" MinHeight="450" WindowStartupLocation="CenterOwner" Background="#F7F9F8" FontFamily="Segoe UI">
    <ScrollViewer VerticalScrollBarVisibility="Auto"><StackPanel Margin="24">
        <TextBlock Text="TELA E TAMANHO" FontSize="26" FontWeight="Bold" Foreground="#0B6B3A"/>
        <TextBlock Text="Ajuste o tamanho da janela sem esconder funções ou sobrepor botões." Foreground="#66746C" Margin="0,5,0,18" TextWrapping="Wrap"/>
        <Border Background="White" BorderBrush="#DCE5DF" BorderThickness="1" CornerRadius="12" Padding="18">
            <StackPanel>
                <TextBlock Text="TAMANHOS RÁPIDOS" FontWeight="Bold" Foreground="#33423A"/>
                <UniformGrid Columns="2" Margin="0,10,0,10">
                    <Button Content="1366 × 768" Margin="5" Padding="12" Click="Size1366_Click"/>
                    <Button Content="1600 × 900" Margin="5" Padding="12" Click="Size1600_Click"/>
                    <Button Content="1920 × 1080" Margin="5" Padding="12" Click="Size1920_Click"/>
                    <Button Content="MAXIMIZAR" Margin="5" Padding="12" Background="#0B6B3A" Foreground="White" Click="Max_Click"/>
                </UniformGrid>
                <Separator Margin="0,8"/>
                <TextBlock Text="TAMANHO PERSONALIZADO" FontWeight="Bold" Margin="0,8,0,8"/>
                <Grid><Grid.ColumnDefinitions><ColumnDefinition/><ColumnDefinition/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
                    <TextBox x:Name="WidthBox" Margin="4" Padding="9" FontSize="16" ToolTip="Largura"/>
                    <TextBox x:Name="HeightBox" Grid.Column="1" Margin="4" Padding="9" FontSize="16" ToolTip="Altura"/>
                    <Button Grid.Column="2" Content="APLICAR" Margin="4" Padding="18,9" Click="Apply_Click"/>
                </Grid>
                <TextBlock Text="Mínimo seguro recomendado: 1240 × 760. Para telas menores, use maximizado." Foreground="#7A8780" FontSize="12" Margin="4,10,0,0" TextWrapping="Wrap"/>
            </StackPanel>
        </Border>
    </StackPanel></ScrollViewer>
</Window>
''', encoding='utf-8')

(desktop / 'DisplaySettingsWindow.xaml.cs').write_text(r'''using System.Globalization;
using System.Windows;

namespace OncaPDV.Desktop;

public partial class DisplaySettingsWindow : Window
{
    private readonly Window _target;
    public DisplaySettingsWindow(Window target)
    {
        _target = target; InitializeComponent();
        WidthBox.Text = Math.Round(target.ActualWidth > 0 ? target.ActualWidth : target.Width).ToString(CultureInfo.InvariantCulture);
        HeightBox.Text = Math.Round(target.ActualHeight > 0 ? target.ActualHeight : target.Height).ToString(CultureInfo.InvariantCulture);
    }
    private void SetSize(double w, double h)
    {
        _target.WindowState = WindowState.Normal;
        _target.Width = Math.Max(1240, w);
        _target.Height = Math.Max(760, h);
        _target.Left = Math.Max(0, (SystemParameters.WorkArea.Width - _target.Width) / 2);
        _target.Top = Math.Max(0, (SystemParameters.WorkArea.Height - _target.Height) / 2);
    }
    private void Size1366_Click(object sender, RoutedEventArgs e) => SetSize(1366, 768);
    private void Size1600_Click(object sender, RoutedEventArgs e) => SetSize(1600, 900);
    private void Size1920_Click(object sender, RoutedEventArgs e) => SetSize(1920, 1080);
    private void Max_Click(object sender, RoutedEventArgs e) => _target.WindowState = WindowState.Maximized;
    private void Apply_Click(object sender, RoutedEventArgs e)
    {
        if (!double.TryParse(WidthBox.Text, out var w) || !double.TryParse(HeightBox.Text, out var h)) { MessageBox.Show("Informe largura e altura válidas.", "Tela"); return; }
        SetSize(w, h);
    }
}
''', encoding='utf-8')

# Main menu entries.
main_xaml = desktop / 'MainWindow.xaml'
x = main_xaml.read_text(encoding='utf-8-sig')
x = x.replace('Content="Caixa / Backup"', 'Content="Caixa"')
if 'Click="BackupCenter_Click"' not in x:
    anchor = '<Button Style="{StaticResource NavButton}" Content="⚙   Configurações" Click="Printer_Click"/>'
    if anchor not in x:
        raise RuntimeError('MainWindow settings nav anchor missing')
    extra = anchor + '\n                    <Button Style="{StaticResource NavButton}" Content="💾   Backup" Click="BackupCenter_Click"/>\n                    <Button Style="{StaticResource NavButton}" Content="🖥   Tela / Tamanho" Click="DisplaySettings_Click"/>'
    x = x.replace(anchor, extra)
main_xaml.write_text(x, encoding='utf-8')

main_cs = desktop / 'MainWindow.xaml.cs'
c = main_cs.read_text(encoding='utf-8-sig')
if 'BackupCenter_Click(object sender' not in c:
    anchor = '    private void Printer_Click(object sender, RoutedEventArgs e) => new PrinterSettingsWindow(_paths) { Owner = this }.ShowDialog();'
    if anchor not in c:
        raise RuntimeError('MainWindow Printer_Click anchor missing')
    extra = anchor + '\n    private void BackupCenter_Click(object sender, RoutedEventArgs e) => new BackupWindow(_database, _paths) { Owner = this }.ShowDialog();\n    private void DisplaySettings_Click(object sender, RoutedEventArgs e) => new DisplaySettingsWindow(this) { Owner = this }.ShowDialog();'
    c = c.replace(anchor, extra)
main_cs.write_text(c, encoding='utf-8')

print('UI018_APPLIED=YES')
