using System.Windows;
using OncaPDV.Infrastructure;
using OncaPDV.Printing;

namespace OncaPDV.Desktop;

public partial class ReceiptSettingsWindow : Window
{
    private readonly CompanyReceiptProfileStore _store;

    public ReceiptSettingsWindow(AppPaths paths)
    {
        InitializeComponent();
        _store = new(paths);
        Loaded += async (_, _) => await LoadProfileAsync();
    }

    private async Task LoadProfileAsync()
    {
        var p = await _store.LoadAsync();
        FantasyName.Text = p.FantasyName;
        LegalName.Text = p.LegalName ?? string.Empty;
        Cnpj.Text = p.Cnpj ?? string.Empty;
        StateRegistration.Text = p.StateRegistration ?? string.Empty;
        Phone.Text = p.Phone ?? string.Empty;
        AddressLine1.Text = p.AddressLine1 ?? string.Empty;
        AddressLine2.Text = p.AddressLine2 ?? string.Empty;
        FooterMessage.Text = p.FooterMessage;
        Status.Text = "Dados carregados.";
    }

    private CompanyReceiptProfile Profile() => new(
        FantasyName.Text,
        LegalName.Text,
        Cnpj.Text,
        StateRegistration.Text,
        Phone.Text,
        AddressLine1.Text,
        AddressLine2.Text,
        FooterMessage.Text);

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await _store.SaveAsync(Profile());
            Status.Text = "DADOS DO COMPROVANTE SALVOS.";
        }
        catch (Exception ex)
        {
            Status.Text = ex.Message;
        }
    }

    private void Preview_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var p = Profile();
            var doc = new ReceiptDocument(
                null,
                p.FantasyName,
                DiagnosticLines: BuildPreviewLines(p));
            new ReceiptPreviewWindow(string.Join("\r\n", doc.DiagnosticLines!), "Prévia dos dados do comprovante") { Owner = this }.ShowDialog();
        }
        catch (Exception ex)
        {
            Status.Text = ex.Message;
        }
    }

    private static IReadOnlyList<string> BuildPreviewLines(CompanyReceiptProfile p)
    {
        var lines = new List<string>
        {
            p.FantasyName,
            "COMPROVANTE NAO FISCAL"
        };
        if (!string.IsNullOrWhiteSpace(p.LegalName)) lines.Add(p.LegalName!);
        if (!string.IsNullOrWhiteSpace(p.Cnpj)) lines.Add($"CNPJ: {p.Cnpj}");
        if (!string.IsNullOrWhiteSpace(p.StateRegistration)) lines.Add($"IE: {p.StateRegistration}");
        if (!string.IsNullOrWhiteSpace(p.AddressLine1)) lines.Add(p.AddressLine1!);
        if (!string.IsNullOrWhiteSpace(p.AddressLine2)) lines.Add(p.AddressLine2!);
        if (!string.IsNullOrWhiteSpace(p.Phone)) lines.Add($"Tel: {p.Phone}");
        lines.Add("------------------------------");
        lines.Add(p.FooterMessage);
        return lines;
    }
}
