using System.IO;
using System.Reflection;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using OncaPDV.Desktop;
using OncaPDV.Domain;
using OncaPDV.Application;
using OncaPDV.Infrastructure;

internal static class Program
{
    private static string Output="";
    [STAThread]
    private static void Main(string[] args)
    {
        Output=Path.GetFullPath(args[0]); Directory.CreateDirectory(Output);
        var root=Path.Combine(Output,"isolated-"+Guid.NewGuid().ToString("N"));
        Environment.SetEnvironmentVariable("ONCA_PDV_DATA_ROOT",root);
        CultureInfo.CurrentCulture=CultureInfo.GetCultureInfo("pt-BR");
        CultureInfo.CurrentUICulture=CultureInfo.CurrentCulture;
        FrameworkElement.LanguageProperty.OverrideMetadata(typeof(FrameworkElement),new FrameworkPropertyMetadata(System.Windows.Markup.XmlLanguage.GetLanguage("pt-BR")));
        var paths=AppPaths.Default();var db=new OncaDatabase(paths);db.Migrate();
        var pin=Random.Shared.Next(100000,999999).ToString();
        new AdminPinService040(db).CompleteOwnerRecovery043("Operador de teste",pin,pin);
        var repo=new SqliteProductRepository(db);
        foreach(var (code,name,price) in new[]{("789001","Amaciante Blue 5L",19.90m),("789002","Detergente neutro 500ml",3.50m),("789003","Água sanitária 2L",8.90m)})
            repo.SaveAsync(new(Guid.NewGuid(),code,code,name,null,null,null,1,price,0,2,"UN",null,null,true)).GetAwaiter().GetResult();
        var app=new System.Windows.Application { ShutdownMode=ShutdownMode.OnExplicitShutdown };
        var window=new MainWindow();
        window.ContentRendered+=async(_,_)=>
        {
            try
            {
                await Task.Delay(250);
                var workflow=(PosWorkflow)typeof(MainWindow).GetField("_workflow",BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(window)!;
                foreach(var scan in new[]{"789001","3*789002","3x789003"})
                {
                    ((TextBox)window.FindName("SearchBox")).Text=scan;
                    await (Task)Call(window,"AddProduct")!;
                }
                Check(workflow.Cart.Items.Count==3,"scanner and quantity formats");
                Check(workflow.Cart.Items[1].Quantity==3 && workflow.Cart.Items[2].Quantity==3,"quantity preserved");
                ((TextBox)window.FindName("DiversosNameBox")).Text="Embalagem para presente";
                ((TextBox)window.FindName("DiversosValueBox")).Text="4,50";
                Call(window,"InlineDiversosAdd_Click",window,new RoutedEventArgs());await Task.Delay(100);
                Check(workflow.Cart.Items.Count==4,"Diversos inline");
                var original=workflow.Cart.Id;
                Call(window,"NewMultiSale_Click",window,new RoutedEventArgs());await Task.Delay(100);
                Check(workflow.Cart.Items.Count==0,"new cart independent");
                await (Task)Call(window,"SwitchMultiSale037",0)!;
                Check(workflow.Cart.Id==original&&workflow.Cart.Items.Count==4,"cart switching preserves identity and items");
                for(var i=0;i<20;i++){await (Task)Call(window,"SwitchMultiSale037",1)!;await (Task)Call(window,"SwitchMultiSale037",0)!;}
                Check(workflow.Cart.Items.Count==4,"rapid cart switching");
                foreach(var size in new[]{(1366,768),(1600,900),(1920,1080)})
                {
                    window.WindowState=WindowState.Normal;window.Width=size.Item1;window.Height=size.Item2;
                    window.UpdateLayout();await Task.Delay(100);
                    var content=(FrameworkElement)window.Content;
                    content.Measure(new Size(size.Item1-16,size.Item2-39));
                    content.Arrange(new Rect(0,0,size.Item1-16,size.Item2-39));content.UpdateLayout();
                    foreach(var name in new[]{"SearchBox","CartGrid","CustomerText","TotalText","FinalizeButton030","HoldCountText"})
                    {
                        var el=(FrameworkElement)window.FindName(name);var bounds=el.TransformToAncestor(content).TransformBounds(new Rect(el.RenderSize));
                        Check(bounds.Width>0&&bounds.Height>0&&bounds.Right<=content.ActualWidth+1&&bounds.Bottom<=content.ActualHeight+1,$"{size}: {name} visible");
                    }
                    Render(content,$"checkout-{size.Item1}x{size.Item2}.png");
                }
                Call(window,"ToggleFocusMode0230");window.UpdateLayout();
                Check(((ColumnDefinition)window.FindName("NavColumn")).Width.Value==0,"F11 focus mode");
                Call(window,"ToggleFocusMode0230");
                Check(((ColumnDefinition)window.FindName("NavColumn")).Width.Value>0,"F11 restores layout");
                await workflow.CancelAsync(); Call(window,"RefreshCart");
                Console.WriteLine("UX_CHECK_PASS"); window.Close();app.Shutdown(0);
            }
            catch(Exception ex){Console.Error.WriteLine(ex);app.Shutdown(1);}
        };
        app.Run(window);
    }
    private static object? Call(object target,string name,params object[] args)=>target.GetType().GetMethod(name,BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(target,args);
    private static void Check(bool ok,string message){if(!ok)throw new Exception(message);Console.WriteLine("PASS "+message);}
    private static void Render(FrameworkElement element,string name)
    {
        var image=new RenderTargetBitmap((int)element.ActualWidth,(int)element.ActualHeight,96,96,PixelFormats.Pbgra32);image.Render(element);
        var png=new PngBitmapEncoder();png.Frames.Add(BitmapFrame.Create(image));using var file=File.Create(Path.Combine(Output,name));png.Save(file);
    }
}
