using System.Globalization;
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
        Save(_target.Width, _target.Height, false);
    }
    private void Size1366_Click(object sender, RoutedEventArgs e) => SetSize(1366, 768);
    private void Size1600_Click(object sender, RoutedEventArgs e) => SetSize(1600, 900);
    private void Size1920_Click(object sender, RoutedEventArgs e) => SetSize(1920, 1080);
    private void Max_Click(object sender, RoutedEventArgs e) { _target.WindowState = WindowState.Maximized; Save(_target.Width, _target.Height, true); }
    private static void Save(double w,double h,bool max)
    {
        try { var dir=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Onca PDV Pro"); System.IO.Directory.CreateDirectory(dir); System.IO.File.WriteAllText(System.IO.Path.Combine(dir,"terminal-ui.txt"),$"{w.ToString(System.Globalization.CultureInfo.InvariantCulture)};{h.ToString(System.Globalization.CultureInfo.InvariantCulture)};{(max?"MAX":"NORMAL")}"); } catch { }
    }

    private void Apply_Click(object sender, RoutedEventArgs e)
    {
        if (!double.TryParse(WidthBox.Text, out var w) || !double.TryParse(HeightBox.Text, out var h)) { MessageBox.Show("Informe largura e altura válidas.", "Tela"); return; }
        SetSize(w, h);
    }
}
