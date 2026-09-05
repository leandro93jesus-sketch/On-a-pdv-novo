using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using OncaPDV.Infrastructure;

namespace OncaPDV.Desktop;

public partial class SecuritySettingsWindow:Window
{
    private readonly AppPaths _paths;
    private readonly OncaDatabase _db;
    private readonly AccessControlStore _access;
    private AccessControlConfig _config=null!;

    public SecuritySettingsWindow(AppPaths paths,OncaDatabase db)
    {
        _paths=paths;_db=db;_access=new(paths);InitializeComponent();Loaded+=async(_,_)=>await LoadAllAsync();
    }

    private async Task LoadAllAsync()
    {
        _config=await _access.LoadAsync();UsersGrid.ItemsSource=null;UsersGrid.ItemsSource=_config.Users;
        var prefs=await new BackupPreferencesStore(_paths).LoadAsync();BackupEnabled.IsChecked=prefs.Enabled;ExternalFolder.Text=prefs.ExternalFolder??string.Empty;WarnHours.Text=prefs.WarnAfterHours.ToString();
        var active=_config.Users.FirstOrDefault(x=>x.Id==_config.ActiveUserId);StatusText.Text=$"Usuário atual: {active?.Name??"—"} • PIN inicial de instalação: 1234 (altere no primeiro uso).";
    }

    private async void AddUser_Click(object sender,RoutedEventArgs e)
    {
        try
        {
            var roleTag=(UserRole.SelectedItem as ComboBoxItem)?.Tag?.ToString()??"Cashier";var user=AccessControlStore.CreateUser(UserName.Text,Enum.Parse<UserRole>(roleTag),UserPin.Password);_config.Users.Add(user);await _access.SaveAsync(_config);UserName.Clear();UserPin.Clear();await LoadAllAsync();
        }
        catch(Exception ex){MessageBox.Show(ex.Message,"Usuários",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

    private async void SetActive_Click(object sender,RoutedEventArgs e)
    {
        if(UsersGrid.SelectedItem is not PdvUser user)return;await _access.SetActiveUserAsync(user.Id);await LoadAllAsync();
    }

    private async void ToggleUser_Click(object sender,RoutedEventArgs e)
    {
        if(UsersGrid.SelectedItem is not PdvUser user)return;if(user.Id==_config.ActiveUserId&&user.Active){MessageBox.Show("Não é possível desativar o usuário atual.");return;}
        var i=_config.Users.FindIndex(x=>x.Id==user.Id);_config.Users[i]=user with{Active=!user.Active};await _access.SaveAsync(_config);await LoadAllAsync();
    }

    private async void ChangePin_Click(object sender,RoutedEventArgs e)
    {
        if(UsersGrid.SelectedItem is not PdvUser user)return;var w=new SimplePinChangeWindow(user.Name){Owner=this};if(w.ShowDialog()!=true)return;var i=_config.Users.FindIndex(x=>x.Id==user.Id);_config.Users[i]=AccessControlStore.ChangePin(user,w.NewPin);await _access.SaveAsync(_config);StatusText.Text=$"PIN de {user.Name} alterado.";await LoadAllAsync();
    }

    private async void SaveBackup_Click(object sender,RoutedEventArgs e)
    {
        if(!int.TryParse(WarnHours.Text,out var hours)||hours<1)hours=30;await new BackupPreferencesStore(_paths).SaveAsync(new(BackupEnabled.IsChecked==true,hours,string.IsNullOrWhiteSpace(ExternalFolder.Text)?null:ExternalFolder.Text.Trim(),30));StatusText.Text="Configuração de backup salva.";
    }

    private async void BackupNow_Click(object sender,RoutedEventArgs e)
    {
        try{await SaveBackupInternalAsync();var health=await new AdvancedOperationsService(_db,_paths).EnsureProtectedBackupAsync();StatusText.Text=$"{health.Message} {health.LastBackup}"+(health.ExternalCopy is null?string.Empty:$" • cópia externa: {health.ExternalCopy}");}
        catch(Exception ex){MessageBox.Show(ex.Message,"Backup",MessageBoxButton.OK,MessageBoxImage.Warning);}
    }

    private async Task SaveBackupInternalAsync(){if(!int.TryParse(WarnHours.Text,out var hours)||hours<1)hours=30;await new BackupPreferencesStore(_paths).SaveAsync(new(BackupEnabled.IsChecked==true,hours,string.IsNullOrWhiteSpace(ExternalFolder.Text)?null:ExternalFolder.Text.Trim(),30));}
}

public sealed class SimplePinChangeWindow:Window
{
    private readonly PasswordBox _a=new(){FontSize=18,Padding=new Thickness(8)};private readonly PasswordBox _b=new(){FontSize=18,Padding=new Thickness(8)};public string NewPin{get;private set;}="";
    public SimplePinChangeWindow(string name)
    {
        Title=$"Alterar PIN — {name}";Width=400;Height=270;WindowStartupLocation=WindowStartupLocation.CenterOwner;ResizeMode=ResizeMode.NoResize;var grid=new Grid{Margin=new Thickness(20)};for(var i=0;i<5;i++)grid.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});var t=new TextBlock{Text="NOVO PIN",FontSize=21,FontWeight=FontWeights.Bold,Foreground=System.Windows.Media.Brushes.DarkGreen};grid.Children.Add(t);var l1=new TextBlock{Text="Novo PIN (mín. 4 dígitos)",Margin=new Thickness(0,14,0,4)};Grid.SetRow(l1,1);grid.Children.Add(l1);Grid.SetRow(_a,2);grid.Children.Add(_a);var l2=new TextBlock{Text="Confirmar PIN",Margin=new Thickness(0,10,0,4)};Grid.SetRow(l2,3);grid.Children.Add(l2);var panel=new StackPanel();panel.Children.Add(_b);var ok=new Button{Content="SALVAR PIN",Background=System.Windows.Media.Brushes.DarkGreen,Foreground=System.Windows.Media.Brushes.White,Padding=new Thickness(12,9),Margin=new Thickness(0,12,0,0)};ok.Click+=(_,_)=>{if(_a.Password.Length<4||_a.Password!=_b.Password){MessageBox.Show("Os PINs não conferem ou possuem menos de 4 dígitos.");return;}NewPin=_a.Password;DialogResult=true;};panel.Children.Add(ok);Grid.SetRow(panel,4);grid.Children.Add(panel);Content=grid;
    }
}
