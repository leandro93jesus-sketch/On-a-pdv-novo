using System.Windows;using System.Windows.Controls;using OncaPDV.Infrastructure;using OncaPDV.Printing;
namespace OncaPDV.Desktop;
public partial class PrinterSettingsWindow:Window
{
 private readonly AppPaths _paths;private readonly TerminalPrinterProfileStore _store;private readonly IReadOnlyList<PrinterInfo> _printers;
 public PrinterSettingsWindow(AppPaths paths){_paths=paths;_store=new(paths);InitializeComponent();_printers=WindowsPrinterDiscovery.GetInstalled();Printers.ItemsSource=_printers;Printers.SelectedItem=_printers.FirstOrDefault(x=>x.QueueName=="POS-80")??_printers.FirstOrDefault(x=>x.IsDefault)??_printers.FirstOrDefault();Status.Text=$"{_printers.Count} fila(s). Configuração independente por terminal; impressão física disponível após confirmação.";}
 private int CodePage()=>Encoding.SelectedIndex switch{1=>858,2=>860,_=>850};private int PaperWidth()=>Paper.SelectedIndex==0?58:80;private IReceiptRenderer Renderer()=>PaperWidth()==58?new EscPos58Renderer(new CodePagePrinterEncoding(CodePage())):new EscPos80Renderer(new CodePagePrinterEncoding(CodePage()));private ReceiptDocument Document()=>new(null,"ONCA",OpenDrawer:false,Cut:false,DiagnosticLines:["ONCA","TESTE MOCK","IMPRESSORA OK"]);
 private PrinterTerminalProfile Profile(){if(Printers.SelectedItem is not PrinterInfo printer)throw new InvalidOperationException("Selecione a impressora.");var backend=Backend.SelectedIndex==1?PrintBackend.WindowsDriver:PrintBackend.EscPosRaw;return new(TerminalId.Text,printer.QueueName,printer.PortName??"",PaperWidth(),backend,$"CP{CodePage()}",false,false);}
 private async void Save_Click(object sender,RoutedEventArgs e){try{await _store.SaveAsync(Profile());var folder=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Onca PDV Pro");System.IO.Directory.CreateDirectory(folder);System.IO.File.WriteAllText(System.IO.Path.Combine(folder,"printer-terminal.txt"),TerminalId.Text.Trim());Status.Text="PERFIL DO TERMINAL SALVO — impressão física pronta";}catch(Exception ex){Status.Text=ex.Message;}}
 private async void Load_Click(object sender,RoutedEventArgs e){var p=await _store.LoadAsync(TerminalId.Text);if(p is null){Status.Text="Perfil não encontrado.";return;}Printers.SelectedItem=_printers.FirstOrDefault(x=>x.QueueName==p.PrinterName);Paper.SelectedIndex=p.PaperWidthMm==58?0:1;Backend.SelectedIndex=p.PrintBackend==PrintBackend.WindowsDriver?1:0;Encoding.SelectedIndex=p.Encoding switch{"CP858"=>1,"CP860"=>2,_=>0};Status.Text="PERFIL CARREGADO";}
 private void Preview_Click(object sender,RoutedEventArgs e){var r=Renderer().Render(Document());new ReceiptPreviewWindow(r.Text,$"Prévia {r.Media}"){Owner=this}.ShowDialog();}
 private async void Mock_Click(object sender,RoutedEventArgs e){var renderer=Renderer();var r=renderer.Render(Document());ReceiptValidator.EnsurePrintable(r);var result=await new MockPrintService(renderer,_paths.PrintPreview).PrintAsync(Document());Status.Text=$"MOCK PASS — {r.Media}, CP{CodePage()}, {r.Bytes.Length} bytes, arquivo={result.PreviewPath}";}

 private async void Physical_Click(object sender,RoutedEventArgs e)
 {
  try
  {
   var profile=Profile();
   if(MessageBox.Show($"Enviar teste físico para:\n\n{profile.PrinterName}\nPorta: {profile.PrinterPort}\nPapel: {profile.PaperWidthMm} mm\n\nContinuar?","ONÇA PDV — Teste de impressão",MessageBoxButton.YesNo,MessageBoxImage.Question)!=MessageBoxResult.Yes){Status.Text="TESTE FÍSICO CANCELADO";return;}
   await _store.SaveAsync(profile);
   var folder=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Onca PDV Pro");System.IO.Directory.CreateDirectory(folder);System.IO.File.WriteAllText(System.IO.Path.Combine(folder,"printer-terminal.txt"),TerminalId.Text.Trim());
   var document=new ReceiptDocument(null,"ONCA",OpenDrawer:false,Cut:false,DiagnosticLines:["ONCA","TESTE DE IMPRESSAO","IMPRESSORA OK"]);
   var result=await new WindowsRawPrintService(Renderer(),_paths.PrintPreview,true).PrintAsync(document,profile.PrinterName);
   Status.Text=result.Success?$"TESTE FÍSICO ENVIADO COM SUCESSO — {profile.PrinterName}":$"FALHA NO TESTE FÍSICO — {result.Error}";
  }
  catch(Exception ex){Status.Text="FALHA NO TESTE FÍSICO — "+ex.Message;}
 }
}
