from pathlib import Path

root=Path('work-final/ONCA-PDV-PRO').resolve()
d=root/'src'/'OncaPDV.Desktop'

# MainWindow must use the configured physical printer, not MockPrintService.
p=d/'MainWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
old='_printer = new QueuedPrintService(new MockPrintService(_renderer, _paths.PrintPreview), _database);'
new='_printer = new QueuedPrintService(new ConfiguredPhysicalPrintService(_paths), _database);'
if old not in c:
    raise RuntimeError('MainWindow mock printer anchor missing')
c=c.replace(old,new,1)
p.write_text(c,encoding='utf-8')

# Runtime adapter: loads this terminal's saved printer profile and sends ESC/POS RAW to Windows spooler.
(d/'ConfiguredPhysicalPrintService.cs').write_text(r'''using OncaPDV.Infrastructure;
using OncaPDV.Printing;

namespace OncaPDV.Desktop;

public sealed class ConfiguredPhysicalPrintService(AppPaths paths) : IPrintService
{
    private readonly AppPaths _paths = paths;

    public async Task<PrintResult> PrintAsync(ReceiptDocument document, string? printerName = null, CancellationToken ct = default)
    {
        try
        {
            var terminalId = ReadTerminalId();
            var profile = await new TerminalPrinterProfileStore(_paths).LoadAsync(terminalId);
            if (profile is null)
                return new(false, $"Impressora não configurada para o terminal {terminalId}. Abra Configurações → Impressora, selecione a impressora e clique SALVAR PERFIL.");

            var selectedPrinter = string.IsNullOrWhiteSpace(printerName) ? profile.PrinterName : printerName;
            if (string.IsNullOrWhiteSpace(selectedPrinter))
                return new(false, "Nome da impressora não configurado.");

            var cp = profile.Encoding?.ToUpperInvariant() switch
            {
                "CP858" => 858,
                "CP860" => 860,
                _ => 850
            };
            IReceiptRenderer renderer = profile.PaperWidthMm == 58
                ? new EscPos58Renderer(new CodePagePrinterEncoding(cp))
                : new EscPos80Renderer(new CodePagePrinterEncoding(cp));

            // Physical printing is enabled only when PrintAsync is called.
            // The UI continues asking the user for confirmation before calling this service.
            var service = new WindowsRawPrintService(renderer, _paths.PrintPreview, physicalPrintingEnabled: true);
            return await service.PrintAsync(document, selectedPrinter, ct);
        }
        catch (Exception ex)
        {
            return new(false, ex.Message);
        }
    }

    private string ReadTerminalId()
    {
        try
        {
            var file = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Onca PDV Pro", "printer-terminal.txt");
            if (File.Exists(file))
            {
                var value = File.ReadAllText(file).Trim();
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        }
        catch { }
        return "CAIXA-01";
    }
}
''',encoding='utf-8')

# Printer settings: clearly show physical mode enabled and provide an explicit physical test button.
p=d/'PrinterSettingsWindow.xaml'
x=p.read_text(encoding='utf-8-sig')
x=x.replace('MODO FÍSICO: BLOQUEADO','MODO FÍSICO: ATIVO — somente após sua confirmação')
x=x.replace('Foreground="#A22"','Foreground="#087233"')
needle='<Button Content="TESTE MOCK" Padding="16,10" Click="Mock_Click"/>'
if needle not in x:
    raise RuntimeError('PrinterSettings mock button anchor missing')
x=x.replace(needle, needle+'<Button Content="TESTE FÍSICO" Padding="16,10" Margin="8,0,0,0" Click="Physical_Click"/>',1)
p.write_text(x,encoding='utf-8')

p=d/'PrinterSettingsWindow.xaml.cs'
c=p.read_text(encoding='utf-8-sig')
c=c.replace('Status.Text=$"{_printers.Count} fila(s). Configuração independente por terminal; impressão física permanece bloqueada.";', 'Status.Text=$"{_printers.Count} fila(s). Configuração independente por terminal; impressão física disponível após confirmação.";')
c=c.replace('Status.Text="PERFIL DO TERMINAL SALVO — PHYSICAL_PRINTING=false";', '''var folder=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Onca PDV Pro");System.IO.Directory.CreateDirectory(folder);System.IO.File.WriteAllText(System.IO.Path.Combine(folder,"printer-terminal.txt"),TerminalId.Text.Trim());Status.Text="PERFIL DO TERMINAL SALVO — impressão física pronta";''')
insert='''
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
'''
idx=c.rfind('}')
if idx<0: raise RuntimeError('PrinterSettings class close missing')
c=c[:idx]+insert+c[idx:]
p.write_text(c,encoding='utf-8')

# Version label.
p=d/'MainWindow.xaml'
x=p.read_text(encoding='utf-8-sig').replace('v0.1.20','v0.1.21').replace('v0.1.19','v0.1.21')
p.write_text(x,encoding='utf-8')

print('PRINT021_APPLIED=YES')
