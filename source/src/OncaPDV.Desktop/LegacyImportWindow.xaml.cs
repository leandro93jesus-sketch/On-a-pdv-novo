using System.Diagnostics;
using System.Text;
using System.Windows;
using OncaPDV.Infrastructure;
using OncaPDV.Migration;

namespace OncaPDV.Desktop;

public partial class LegacyImportWindow : Window
{
    private readonly OperationalService _operations;
    private readonly AppPaths _paths;
    private readonly LegacyImportService _importer;
    private LegacyDryRunReport? _plan;
    private string? _report;

    public LegacyImportWindow(OperationalService operations, AppPaths paths)
    {
        _operations = operations;
        _paths = paths;
        _importer = new(AppServices.Database!);
        InitializeComponent();
    }

    private void Choose_Click(object sender, RoutedEventArgs e)
    {
        var picker = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Selecione o banco SQLite do PDV antigo",
            Filter = "Banco SQLite (*.db;*.sqlite;*.sqlite3)|*.db;*.sqlite;*.sqlite3|Todos os arquivos (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };

        if (picker.ShowDialog(this) != true) return;
        SourceFile.Text = picker.FileName;
        _plan = null;
        ImportButton.IsEnabled = false;
        ReportButton.IsEnabled = false;
        Analysis.Clear();
        Status.Text = "Arquivo selecionado. Clique em VALIDAR BACKUP.";
    }

    private async void Validate_Click(object sender, RoutedEventArgs e)
    {
        if (!File.Exists(SourceFile.Text))
        {
            Status.Text = "Selecione um arquivo existente.";
            return;
        }

        ImportButton.IsEnabled = false;
        Status.Text = "Validando em somente leitura...";

        try
        {
            _plan = await _importer.DryRunAsync(SourceFile.Text);
            Analysis.Text = Format(_plan);
            _report = await SaveReport("dry-run", Analysis.Text);
            ImportButton.IsEnabled = _plan.SourcePreserved;
            ReportButton.IsEnabled = true;
            Status.Text = _plan.SourcePreserved
                ? "BACKUP VALIDADO EM SOMENTE LEITURA — confira as contagens. O botão IMPORTAR DADOS está liberado."
                : "VALIDAÇÃO FALHOU — importação bloqueada.";
        }
        catch (Exception ex)
        {
            _plan = null;
            Status.Text = "VALIDAÇÃO FALHOU — " + ex.Message;
        }
    }

    private async void Import_Click(object sender, RoutedEventArgs e)
    {
        if (_plan is null || !_plan.SourcePreserved) return;

        var warning =
            "O sistema criará um backup automático do banco atual e importará os dados validados.\n\n" +
            "Produtos com nomes iguais serão preservados. Códigos conflitantes serão tratados sem sobrescrever produtos.\n" +
            "Qualquer erro antes do commit causará rollback completo.\n\nContinuar?";

        if (MessageBox.Show(warning, "Importação do PDV antigo", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
            return;

        ImportButton.IsEnabled = false;
        Status.Text = "Criando backup de segurança e importando...";

        try
        {
            var safety = await _operations.CreateBackupAsync();
            var result = await _importer.ImportAsync(_plan.Source);
            var conflicts = _plan.Entities.Sum(x => x.Conflicts);
            var text = $"""
IMPORTAÇÃO CONCLUÍDA

Produtos: {Count(result, "products")}
Clientes: {Count(result, "customers")}
Vendas: {Count(result, "sales")}
Itens de venda: {Count(result, "sale_items")}
Pagamentos: {Count(result, "payments")}
Crediário: {Count(result, "credit")}
Recebimentos de crediário: {Count(result, "credit_payments")}
Sessões de caixa: {Count(result, "cash_sessions")}
Movimentos de caixa: {Count(result, "cash")}
Movimentos de estoque: {Count(result, "stock_movements")}
Fornecedores: {Count(result, "suppliers")}
Compras: {Count(result, "purchases")}
Itens de compra: {Count(result, "purchase_items")}
Registros legados arquivados: {Count(result, "raw_records")}
Conflitos informados no dry-run: {conflicts}

Integridade: {result.Integrity}
Backup de segurança: {safety}
Mesmo backup já importado: {(result.AlreadyImported ? "SIM — duplicação bloqueada" : "NÃO")}
""";

            Analysis.Text = text;
            _report = await SaveReport("importacao", Format(_plan) + "\n\n" + text);
            ReportButton.IsEnabled = true;
            Status.Text = result.AlreadyImported
                ? "IMPORTAÇÃO NÃO REPETIDA — o SHA-256 deste backup já consta como importado."
                : "IMPORTAÇÃO CONCLUÍDA COM SEGURANÇA";
        }
        catch (Exception ex)
        {
            Status.Text = "IMPORTAÇÃO CANCELADA — ROLLBACK COMPLETO. " + ex.Message;
            ImportButton.IsEnabled = true;
        }
    }

    private void Report_Click(object sender, RoutedEventArgs e)
    {
        if (_report is not null)
            Process.Start(new ProcessStartInfo(_report) { UseShellExecute = true });
    }

    private static long Count(LegacyImportResult result, string key) =>
        result.Imported.TryGetValue(key, out var value) ? value : 0;

    private static string Format(LegacyDryRunReport report)
    {
        var b = new StringBuilder();
        b.AppendLine("DRY-RUN — NENHUM DADO FOI IMPORTADO");
        b.AppendLine($"Formato: {report.Format}");
        b.AppendLine($"Somente leitura / SHA-256 preservado: {(report.SourcePreserved ? "SIM" : "NÃO")}");
        b.AppendLine($"SHA-256: {report.Sha256Before}");
        b.AppendLine();
        b.AppendLine("ENTIDADE                     ENCONTRADOS  IMPORTÁVEIS  EXISTENTES  CONFLITOS  IGNORADOS");
        b.AppendLine(new string('-', 86));

        foreach (var (key, label) in DisplayEntities)
        {
            var x = report.Entity(key);
            b.AppendLine($"{label,-28} {x.Found,10}  {x.Importable,11}  {x.Existing,10}  {x.Conflicts,9}  {x.Ignored,8}");
        }

        b.AppendLine();
        b.AppendLine($"Saldo de estoque encontrado: {report.Entity("products").StockTotal:0.###}");
        b.AppendLine($"Total financeiro de vendas: {report.Entity("sales").FinancialTotal:C}");
        b.AppendLine($"Conflitos totais: {report.Entities.Sum(x => x.Conflicts)}");

        if (report.Conflicts.Count > 0)
        {
            b.AppendLine();
            b.AppendLine("AVISOS:");
            foreach (var warning in report.Conflicts) b.AppendLine("- " + warning);
        }

        b.AppendLine();
        b.AppendLine("Observação: tabelas legadas sem equivalente direto no modelo atual são arquivadas em JSON auditável para evitar perda silenciosa de informação.");
        return b.ToString();
    }

    private static readonly (string Key, string Label)[] DisplayEntities =
    [
        ("products", "Produtos"),
        ("customers", "Clientes"),
        ("sales", "Vendas"),
        ("sale_items", "Itens de venda"),
        ("payments", "Pagamentos"),
        ("credit", "Contas de crediário"),
        ("credit_installments", "Parcelas de crediário"),
        ("credit_payments", "Recebimentos crediário"),
        ("cash_sessions", "Sessões de caixa"),
        ("cash", "Movimentos de caixa"),
        ("stock_movements", "Movimentos de estoque"),
        ("suppliers", "Fornecedores"),
        ("purchases", "Compras"),
        ("purchase_items", "Itens de compra"),
        ("delivery_orders", "Pedidos de entrega"),
        ("quotes", "Orçamentos"),
        ("returns", "Devoluções"),
        ("users", "Usuários")
    ];

    private async Task<string> SaveReport(string kind, string content)
    {
        _paths.EnsureCreated();
        var file = Path.Combine(_paths.Exports, $"importacao-legado-{kind}-{DateTime.Now:yyyyMMdd-HHmmss}.txt");
        await File.WriteAllTextAsync(file, content);
        return file;
    }
}
