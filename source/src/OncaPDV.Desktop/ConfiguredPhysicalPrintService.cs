using OncaPDV.Infrastructure;
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
