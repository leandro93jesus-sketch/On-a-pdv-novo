using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace OncaPDV.Desktop;

public sealed class MoneyPromptWindow:Window
{
    private readonly TextBox _input=new(){FontSize=28,FontWeight=FontWeights.Bold,Padding=new Thickness(10),HorizontalContentAlignment=HorizontalAlignment.Right};
    public decimal Value{get;private set;}
    public MoneyPromptWindow(string title,decimal current=0)
    {
        Title=title;Width=430;Height=260;WindowStartupLocation=WindowStartupLocation.CenterOwner;ResizeMode=ResizeMode.NoResize;Background=System.Windows.Media.Brushes.WhiteSmoke;
        var g=new Grid{Margin=new Thickness(22)};g.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});g.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});g.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});
        var t=new TextBlock{Text=title.ToUpperInvariant(),FontSize=21,FontWeight=FontWeights.Bold,Foreground=System.Windows.Media.Brushes.DarkGreen};g.Children.Add(t);_input.Text=current.ToString("N2");_input.Margin=new Thickness(0,18,0,18);_input.KeyDown+=Input_KeyDown;Grid.SetRow(_input,1);g.Children.Add(_input);
        var p=new StackPanel{Orientation=Orientation.Horizontal,HorizontalAlignment=HorizontalAlignment.Right};var cancel=new Button{Content="CANCELAR",IsCancel=true,Padding=new Thickness(13,9),Margin=new Thickness(4)};var ok=new Button{Content="CONFIRMAR",Padding=new Thickness(13,9),Margin=new Thickness(4),Background=System.Windows.Media.Brushes.DarkGreen,Foreground=System.Windows.Media.Brushes.White};ok.Click+=(_,_)=>Confirm();p.Children.Add(cancel);p.Children.Add(ok);Grid.SetRow(p,2);g.Children.Add(p);Content=g;Loaded+=(_,_)=>{_input.Focus();_input.SelectAll();};
    }
    private void Input_KeyDown(object sender,KeyEventArgs e){if(e.Key==Key.Enter){e.Handled=true;Confirm();}}
    private void Confirm(){var text=_input.Text.Replace("R$",string.Empty,StringComparison.OrdinalIgnoreCase).Trim();if(!decimal.TryParse(text,NumberStyles.Number,CultureInfo.CurrentCulture,out var v)&&!decimal.TryParse(text.Replace('.',','),NumberStyles.Number,CultureInfo.GetCultureInfo("pt-BR"),out v)){MessageBox.Show("Informe um valor válido.");return;}if(v<0){MessageBox.Show("O valor não pode ser negativo.");return;}Value=v;DialogResult=true;}
}
