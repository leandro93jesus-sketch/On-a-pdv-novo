using System.Windows;
using OncaPDV.Infrastructure;
using OncaPDV.Printing;

namespace OncaPDV.Desktop;

public partial class PrinterSettingsWindow : Window
{
    private readonly AppPaths _paths;
    private readonly TerminalPrinterProfileStore _store;
    private readonly IReadOnlyList<PrinterInfo> _printers;

    public PrinterSettingsWindow(AppPaths paths)
    {
        _paths = paths;
        _store = new(paths);
        InitializeComponent();
        _printers = WindowsPrinterDiscovery.GetInstalled();
        Printers.ItemsSource = _printers;
        Printers.SelectedItem = _printers.FirstOrDefault(x => x.QueueName == "POS-80") ?? _printers.FirstOrDefault(x => x.IsDefault) ?? _printers.FirstOrDefault();
        Status.Text = $"{_printers.Count} fila(s) encontrada(s). A impressão física fica desativada até você marcar a opção e salvar.";
    }

    private int CodePage() => Encoding.SelectedIndex switch { 1 => 858, 2 => 860, _ => 850 };
    private int PaperWidth() => Paper.SelectedIndex == 0 ? 58 : 80;
    private IReceiptRenderer Renderer() => PaperWidth() == 58
        ? new EscPos58Renderer(new CodePagePrinterEncoding(CodePage()))
        : new EscPos80Renderer(new CodePagePrinterEncoding(CodePage()));

    private ReceiptDocument Document() => new(
        null,
        "ONCA PRODUTOS DE LIMPEZA",
        OpenDrawer: Drawer.IsChecked == true,
        Cut: Cut.IsChecked == true,
        DiagnosticLines: ["ONCA PRODUTOS DE LIMPEZA", "TESTE IMPRESSAO NAO FISCAL", "IMPRESSORA OK", Cut.IsChecked == true ? "CORTE AUTOMATICO ATIVO" : "CORTE AUTOMATICO DESATIVADO"]);

    private PrinterTerminalProfile Profile()
    {
        if (Printers.SelectedItem is not PrinterInfo printer) throw new InvalidOperationException("Selecione a impressora.");
        var backend = Backend.SelectedIndex == 1 ? PrintBackend.WindowsDriver : PrintBackend.EscPosRaw;
        return new(
            TerminalId.Text,
            printer.QueueName,
            printer.PortName ?? string.Empty,
            PaperWidth(),
            backend,
            $"CP{CodePage()}",
            Cut.IsChecked == true,
            Drawer.IsChecked == true,
            Physical.IsChecked == true);
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var p = Profile();
            await _store.SaveAsync(p);
            Status.Text = p.PhysicalPrintingEnabled
                ? $"PERFIL SALVO — físico ATIVO em {p.PrinterName} • corte automático: {(p.CutEnabled ? "ATIVO" : "DESATIVADO")}."
                : $"PERFIL SALVO — físico DESATIVADO • corte automático: {(p.CutEnabled ? "ATIVO" : "DESATIVADO")}.";
        }
        catch (Exception ex) { Status.Text = ex.Message; }
    }

    private async void Load_Click(object sender, RoutedEventArgs e)
    {
        var p = await _store.LoadAsync(TerminalId.Text);
        if (p is null) { Status.Text = "Perfil não encontrado."; return; }
        Printers.SelectedItem = _printers.FirstOrDefault(x => x.QueueName == p.PrinterName);
        Paper.SelectedIndex = p.PaperWidthMm == 58 ? 0 : 1;
        Backend.SelectedIndex = p.PrintBackend == PrintBackend.WindowsDriver ? 1 : 0;
        Encoding.SelectedIndex = p.Encoding switch { "CP858" => 1, "CP860" => 2, _ => 0 };
        Cut.IsChecked = p.CutEnabled;
        Drawer.IsChecked = p.DrawerEnabled;
        Physical.IsChecked = p.PhysicalPrintingEnabled;
        Status.Text = $"PERFIL CARREGADO — físico: {(p.PhysicalPrintingEnabled ? "ATIVO" : "DESATIVADO")}.";
    }

    private void Preview_Click(object sender, RoutedEventArgs e)
    {
        var r = Renderer().Render(Document());
        new ReceiptPreviewWindow(r.Text, $"Prévia {r.Media}") { Owner = this }.ShowDialog();
    }

    private async void Mock_Click(object sender, RoutedEventArgs e)
    {
        var renderer = Renderer();
        var r = renderer.Render(Document());
        ReceiptValidator.EnsurePrintable(r);
        var result = await new MockPrintService(renderer, _paths.PrintPreview).PrintAsync(Document());
        Status.Text = $"MOCK PASS — {r.Media}, CP{CodePage()}, {r.Bytes.Length} bytes, arquivo={result.PreviewPath}";
    }

    private async void PhysicalTest_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var p = Profile();
            if (!p.PhysicalPrintingEnabled)
            {
                Status.Text = "Marque ATIVAR IMPRESSÃO FÍSICA, salve o perfil e tente novamente.";
                return;
            }
            var result = await new WindowsRawPrintService(Renderer(), _paths.Logs, true).PrintAsync(Document(), p.PrinterName);
            Status.Text = result.Success
                ? $"TESTE FÍSICO OK — enviado para {p.PrinterName}. Corte {(p.CutEnabled ? "comandado automaticamente" : "desativado")}."
                : $"TESTE FÍSICO FALHOU — {result.Error}";
        }
        catch (Exception ex) { Status.Text = ex.Message; }
    }
}
