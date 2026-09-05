using System.Configuration;
using System.Data;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : System.Windows.Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);var window=new MainWindow();MainWindow=window;
        if(e.Args.Contains("--smoke-test",StringComparer.OrdinalIgnoreCase))window.ContentRendered+=(_,_)=>{window.Close();Shutdown(0);};
        window.Show();
    }
    private void App_DispatcherUnhandledException(object sender,DispatcherUnhandledExceptionEventArgs e)
    {
        try{var paths=AppPaths.Default();paths.EnsureCreated();File.AppendAllText(Path.Combine(paths.Logs,"fatal.log"),$"{DateTimeOffset.Now:O} {e.Exception}{Environment.NewLine}");}catch{/* logging must never hide the original failure */}
        MessageBox.Show("O ONÇA PDV encontrou um erro e registrou os detalhes. A venda pendente será recuperada na próxima abertura.","ONÇA PDV",MessageBoxButton.OK,MessageBoxImage.Error);e.Handled=true;
    }
}

