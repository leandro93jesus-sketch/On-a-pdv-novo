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
        base.OnStartup(e);
        var paths=AppPaths.Default();
        var db=new OncaDatabase(paths);
        db.Migrate();
        AppServices.Database=db;
        AppServices.Paths=paths;
        var security=new PermissionService(db);
        security.EnsureSeedAsync().GetAwaiter().GetResult();

        if(e.Args.Contains("--smoke-test",StringComparer.OrdinalIgnoreCase))
        {
            AppSession.CurrentUser=new AppUser(Guid.Parse("10000000-0000-0000-0000-000000000001"),"admin","Administrador",UserRole.Admin,true,false);
            var smoke=new MainWindow();MainWindow=smoke;
            smoke.ContentRendered+=(_,_)=>{smoke.Close();Shutdown(0);};
            smoke.Show();
            return;
        }

        var login=new LoginWindow(db);
        if(login.ShowDialog()!=true || login.SelectedUser is null){Shutdown(0);return;}
        AppSession.CurrentUser=login.SelectedUser;

        if(login.SelectedUser.MustChangePin)
        {
            var change=new ChangePinWindow(db,login.SelectedUser);
            if(change.ShowDialog()!=true){MessageBox.Show("Altere o PIN inicial antes de usar o sistema.","Segurança",MessageBoxButton.OK,MessageBoxImage.Warning);Shutdown(0);return;}
        }

        var window=new MainWindow();MainWindow=window;window.Show();
    }
    private void App_DispatcherUnhandledException(object sender,DispatcherUnhandledExceptionEventArgs e)
    {
        try{var paths=AppPaths.Default();paths.EnsureCreated();File.AppendAllText(Path.Combine(paths.Logs,"fatal.log"),$"{DateTimeOffset.Now:O} {e.Exception}{Environment.NewLine}");}catch{/* logging must never hide the original failure */}
        MessageBox.Show("O ONÇA PDV encontrou um erro e registrou os detalhes. A venda pendente será recuperada na próxima abertura.","ONÇA PDV",MessageBoxButton.OK,MessageBoxImage.Error);e.Handled=true;
    }
}

