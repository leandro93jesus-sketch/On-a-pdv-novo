using System.Text;
using Microsoft.Data.Sqlite;

namespace OncaPDV.Infrastructure;

public sealed record IntegrityCheck151(string Area,string Level,string Code,string Message,long Count,string Details);
public sealed record DuplicateItem151(string Entity,string Field,string Value,long Count,string Details);
public sealed record CreditDiagnostic151(Guid AccountId,long SaleNumber,string Customer,string AccountStatus,string SaleStatus,
    decimal Original,decimal Balance,decimal Receipts,decimal Cash,int PendingIntents,int UnlinkedReceipts,bool Archived,
    string Diagnosis,string Reason);
public sealed record IntegrityReport151(DateTimeOffset GeneratedAt,string Overall,string DatabaseIntegrity,long ForeignKeyErrors,
    long Sales,long Products,long Customers,long CreditAccounts,long ActiveCreditAccounts,long OpenCashSessions,long Backups,
    string? LastBackup,IReadOnlyList<IntegrityCheck151> Checks,IReadOnlyList<DuplicateItem151> Duplicates,
    IReadOnlyList<CreditDiagnostic151> Credits);

/// <summary>
/// Read-only integrity center. It never repairs financial data automatically. The goal is to
/// make old inconsistencies visible before an administrator chooses a corrective operation.
/// </summary>
public sealed class IntegrityCenter151(OncaDatabase db,AppPaths paths)
{
    private static void Add(SqliteCommand q,string name,object? value)=>q.Parameters.AddWithValue(name,value??DBNull.Value);

    public async Task<IntegrityReport151> RunAsync(CancellationToken ct=default)
    {
        paths.EnsureCreated();
        await using var c=db.Open();
        var checks=new List<IntegrityCheck151>();
        var duplicates=new List<DuplicateItem151>();

        var integrity=await Text(c,"PRAGMA integrity_check",ct)??"erro";
        checks.Add(new("Banco",integrity.Equals("ok",StringComparison.OrdinalIgnoreCase)?"OK":"ERRO","DB-INTEGRITY",
            integrity.Equals("ok",StringComparison.OrdinalIgnoreCase)?"Banco SQLite íntegro.":"PRAGMA integrity_check encontrou problema.",
            integrity.Equals("ok",StringComparison.OrdinalIgnoreCase)?0:1,integrity));

        var foreign=await CountReader(c,"PRAGMA foreign_key_check",ct);
        checks.Add(new("Banco",foreign==0?"OK":"ERRO","DB-FK",foreign==0?"Vínculos entre tabelas conferidos.":"Existem vínculos quebrados entre registros.",foreign,
            foreign==0?"Nenhuma violação de chave estrangeira.":"Não corrija apagando registros manualmente; revise o vínculo."));

        var sales=await Number(c,"SELECT COUNT(*) FROM sales",ct);
        var products=await Number(c,"SELECT COUNT(*) FROM products",ct);
        var customers=await Number(c,"SELECT COUNT(*) FROM customers",ct);
        var credits=await Number(c,"SELECT COUNT(*) FROM credit_accounts",ct);
        var activeCredits=await Number(c,"SELECT COUNT(*) FROM credit_accounts a WHERE NOT EXISTS(SELECT 1 FROM credit_account_deletions_046 d WHERE d.account_id=a.id)",ct);
        var openCash=await Number(c,"SELECT COUNT(*) FROM cash_sessions WHERE closed_at IS NULL",ct);

        await AddCountCheck(c,checks,"Vendas","SALE-NO-ITEM","Completed sales without items",
            "SELECT COUNT(*) FROM sales s WHERE s.status='Completed' AND NOT EXISTS(SELECT 1 FROM sale_items i WHERE i.sale_id=s.id)",
            "Venda concluída sem itens.","ERRO",ct);
        await AddCountCheck(c,checks,"Vendas","SALE-NO-PAYMENT","Completed sales without payment",
            "SELECT COUNT(*) FROM sales s WHERE s.status='Completed' AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.sale_id=s.id)",
            "Venda concluída sem pagamento.","ERRO",ct);
        await AddCountCheck(c,checks,"Crediário","CREDIT-CASH-DIFF","Credit receipt/cash mismatch",
            @"SELECT COUNT(*) FROM credit_accounts a WHERE
COALESCE((SELECT SUM(r.amount) FROM credit_receipts r LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id WHERE r.account_id=a.id AND x.id IS NULL),0)
<> COALESCE((SELECT SUM(m.amount) FROM cash_movements m WHERE m.origin_id=a.id AND m.type='StoreCreditReceipt'),0)",
            "Conta com total de recebimentos diferente do caixa.","ATENÇÃO",ct);
        await AddCountCheck(c,checks,"Crediário","CREDIT-UNLINKED","Unlinked credit receipts",
            @"SELECT COUNT(*) FROM credit_receipts r
LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id
LEFT JOIN credit_receipt_cash_links_045 l ON l.receipt_id=r.id
LEFT JOIN cash_movements m ON m.id=l.cash_movement_id
WHERE x.id IS NULL AND (m.id IS NULL OR m.origin_id<>r.account_id OR m.type<>'StoreCreditReceipt' OR m.amount<>r.amount)",
            "Recebimento sem vínculo individual íntegro com o caixa.","ATENÇÃO",ct);
        await AddCountCheck(c,checks,"Crediário","CREDIT-PENDING","Pending receipt confirmations",
            "SELECT COUNT(*) FROM credit_receipt_intents_046 WHERE acknowledged_at IS NULL",
            "Operação de recebimento aguardando conferência.","ATENÇÃO",ct);
        await AddCountCheck(c,checks,"Caixa","CASH-MULTI-OPEN","More than one open session per operator",
            "SELECT COUNT(*) FROM (SELECT operator_id FROM cash_sessions WHERE closed_at IS NULL GROUP BY operator_id HAVING COUNT(*)>1)",
            "Mesmo operador com mais de um caixa aberto.","ATENÇÃO",ct);
        await AddCountCheck(c,checks,"Impressão","PRINT-PENDING","Pending/failed print jobs",
            "SELECT COUNT(*) FROM print_jobs WHERE status IN ('Pending','Printing','Failed')",
            "Trabalho de impressão pendente ou com falha.","ATENÇÃO",ct);

        await AddDuplicates(c,duplicates,"Produto","Código interno",
            "SELECT internal_code,COUNT(*) FROM products WHERE TRIM(internal_code)<>'' GROUP BY internal_code COLLATE NOCASE HAVING COUNT(*)>1",
            "Código interno deve identificar um único produto.",ct);
        await AddDuplicates(c,duplicates,"Produto","Código de barras",
            "SELECT barcode,COUNT(*) FROM products WHERE barcode IS NOT NULL AND TRIM(barcode)<>'' GROUP BY barcode COLLATE NOCASE HAVING COUNT(*)>1",
            "Código de barras deve identificar um único produto.",ct);
        await AddDuplicates(c,duplicates,"Cliente","CPF",
            "SELECT cpf,COUNT(*) FROM customers WHERE cpf IS NOT NULL AND TRIM(cpf)<>'' GROUP BY cpf HAVING COUNT(*)>1",
            "Mesmo CPF em mais de um cliente.",ct);
        await AddDuplicates(c,duplicates,"Cliente","CNPJ",
            "SELECT cnpj,COUNT(*) FROM customers WHERE cnpj IS NOT NULL AND TRIM(cnpj)<>'' GROUP BY cnpj HAVING COUNT(*)>1",
            "Mesmo CNPJ em mais de um cliente.",ct);
        await AddDuplicates(c,duplicates,"Cliente","Telefone",
            "SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,'(',''),')',''),'-',''),' ',''),'+',''),COUNT(*) FROM customers WHERE phone IS NOT NULL AND TRIM(phone)<>'' GROUP BY REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,'(',''),')',''),'-',''),' ',''),'+','') HAVING COUNT(*)>1",
            "Telefone repetido pode indicar cadastro duplicado; confirme antes de mesclar.",ct);
        await AddDuplicates(c,duplicates,"Venda","Número",
            "SELECT CAST(number AS TEXT),COUNT(*) FROM sales GROUP BY number HAVING COUNT(*)>1",
            "Número de venda duplicado.",ct);
        await AddDuplicates(c,duplicates,"Crediário","Venda",
            @"SELECT sale_id,COUNT(*) FROM credit_accounts a WHERE NOT EXISTS(SELECT 1 FROM credit_account_deletions_046 d WHERE d.account_id=a.id)
GROUP BY sale_id HAVING COUNT(*)>1",
            "Mais de uma conta ativa ligada à mesma venda; revisar antes de receber.",ct);
        await AddDuplicates(c,duplicates,"Pagamento","Potencial duplicidade",
            @"SELECT CAST(s.number AS TEXT)||' / '||p.method||' / '||CAST(p.amount AS TEXT),COUNT(*) FROM payments p JOIN sales s ON s.id=p.sale_id
GROUP BY p.sale_id,p.method,p.amount,COALESCE(p.received,-1),p.change_amount HAVING COUNT(*)>1",
            "Pagamentos idênticos na mesma venda; pode ser legítimo em pagamento misto, por isso é apenas alerta.",ct);
        await AddDuplicates(c,duplicates,"Caixa","Movimento exatamente repetido",
            @"SELECT COALESCE(origin_id,'SEM ORIGEM')||' / '||type||' / '||CAST(amount AS TEXT)||' / '||created_at,COUNT(*) FROM cash_movements
GROUP BY session_id,type,amount,COALESCE(origin_id,''),reason,created_at HAVING COUNT(*)>1",
            "Movimentos com todos os campos principais iguais; revisar possível gravação duplicada.",ct);

        checks.Add(new("Duplicidades",duplicates.Count==0?"OK":"ATENÇÃO","DUP-SUMMARY",
            duplicates.Count==0?"Nenhuma duplicidade detectada pelas regras atuais.":$"{duplicates.Count} grupo(s) de possível duplicidade encontrado(s).",
            duplicates.Sum(x=>Math.Max(1,x.Count-1)),duplicates.Count==0?"OK":"Abra a aba Duplicidades; nenhum registro é apagado automaticamente."));

        var backupFiles=Directory.Exists(paths.Backups)
            ?Directory.GetFiles(paths.Backups).Where(x=>x.EndsWith(".zip",StringComparison.OrdinalIgnoreCase)||x.EndsWith(".db",StringComparison.OrdinalIgnoreCase)).OrderByDescending(File.GetLastWriteTimeUtc).ToArray()
            :[];
        string? lastBackup=backupFiles.FirstOrDefault();
        var backupLevel="OK";var backupMessage="Backup encontrado.";long backupCount=backupFiles.LongLength;
        if(lastBackup is null){backupLevel="ATENÇÃO";backupMessage="Nenhum backup localizado.";}
        else if(DateTime.UtcNow-File.GetLastWriteTimeUtc(lastBackup)>TimeSpan.FromDays(2)){backupLevel="ATENÇÃO";backupMessage="Último backup tem mais de 48 horas.";}
        checks.Add(new("Backup",backupLevel,"BACKUP-AGE",backupMessage,backupLevel=="OK"?0:1,lastBackup is null?"Sem arquivo":$"Último: {Path.GetFileName(lastBackup)} — {File.GetLastWriteTime(lastBackup):dd/MM/yyyy HH:mm}"));

        var creditRows=await ReadCredits(c,ct);
        var overall=checks.Any(x=>x.Level=="ERRO")?"ERRO":checks.Any(x=>x.Level=="ATENÇÃO")?"ATENÇÃO":"OK";
        return new(DateTimeOffset.Now,overall,integrity,foreign,sales,products,customers,credits,activeCredits,openCash,backupCount,
            lastBackup is null?null:Path.GetFileName(lastBackup),checks,duplicates,creditRows);
    }

    public async Task<string> ExportAsync(CancellationToken ct=default)
    {
        var r=await RunAsync(ct);paths.EnsureCreated();var file=Path.Combine(paths.Exports,$"centro-integridade-{DateTime.Now:yyyyMMdd-HHmmss}.txt");
        var b=new StringBuilder();b.AppendLine("ONÇA PDV PRO — CENTRO DE INTEGRIDADE");b.AppendLine($"Gerado: {r.GeneratedAt:dd/MM/yyyy HH:mm:ss}");b.AppendLine($"Status geral: {r.Overall}");b.AppendLine($"Banco: {r.DatabaseIntegrity} | FK: {r.ForeignKeyErrors}");b.AppendLine();
        b.AppendLine("VERIFICAÇÕES");foreach(var x in r.Checks)b.AppendLine($"[{x.Level}] {x.Area} — {x.Message} | quantidade={x.Count} | {x.Details}");
        b.AppendLine();b.AppendLine("DUPLICIDADES");foreach(var x in r.Duplicates)b.AppendLine($"{x.Entity} / {x.Field}: {x.Value} ({x.Count}) — {x.Details}");
        b.AppendLine();b.AppendLine("CREDIÁRIO");foreach(var x in r.Credits)b.AppendLine($"Venda {x.SaleNumber:000000} | {x.Customer} | conta={x.AccountStatus} venda={x.SaleStatus} saldo={x.Balance:C} recibos={x.Receipts:C} caixa={x.Cash:C} | {x.Diagnosis}: {x.Reason}");
        await File.WriteAllTextAsync(file,b.ToString(),Encoding.UTF8,ct);return file;
    }

    private static async Task<IReadOnlyList<CreditDiagnostic151>> ReadCredits(SqliteConnection c,CancellationToken ct)
    {
        var list=new List<CreditDiagnostic151>();await using var q=c.CreateCommand();q.CommandText=@"
SELECT a.id,COALESCE(s.number,0),COALESCE(c.name,'CLIENTE NÃO ENCONTRADO'),a.status,COALESCE(s.status,'VENDA NÃO ENCONTRADA'),a.original_amount,a.balance,
COALESCE((SELECT SUM(r.amount) FROM credit_receipts r LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id WHERE r.account_id=a.id AND x.id IS NULL),0),
COALESCE((SELECT SUM(m.amount) FROM cash_movements m WHERE m.origin_id=a.id AND m.type='StoreCreditReceipt'),0),
(SELECT COUNT(*) FROM credit_receipt_intents_046 i WHERE i.account_id=a.id AND i.acknowledged_at IS NULL),
(SELECT COUNT(*) FROM credit_receipts r LEFT JOIN credit_receipt_reversals x ON x.receipt_id=r.id LEFT JOIN credit_receipt_cash_links_045 l ON l.receipt_id=r.id LEFT JOIN cash_movements m ON m.id=l.cash_movement_id WHERE r.account_id=a.id AND x.id IS NULL AND (m.id IS NULL OR m.origin_id<>r.account_id OR m.type<>'StoreCreditReceipt' OR m.amount<>r.amount)),
CASE WHEN d.account_id IS NULL THEN 0 ELSE 1 END
FROM credit_accounts a LEFT JOIN sales s ON s.id=a.sale_id LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN credit_account_deletions_046 d ON d.account_id=a.id
ORDER BY CASE WHEN d.account_id IS NULL THEN 0 ELSE 1 END,a.created_at DESC";
        await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))
        {
            var id=Guid.Parse(r.GetString(0));var sale=r.GetInt64(1);var customer=r.GetString(2);var ast=r.GetString(3);var sst=r.GetString(4);
            var original=r.GetDecimal(5);var balance=r.GetDecimal(6);var receipts=r.GetDecimal(7);var cash=r.GetDecimal(8);var pending=r.GetInt32(9);var unlinked=r.GetInt32(10);var archived=r.GetInt32(11)!=0;
            string diagnosis,reason;
            if(archived){diagnosis="ARQUIVADO";reason="Conta já retirada do crediário operacional; disponível apenas para auditoria.";}
            else if(customer=="CLIENTE NÃO ENCONTRADO"||sale==0||sst=="VENDA NÃO ENCONTRADA"){diagnosis="BLOQUEADO";reason="Vínculo com cliente ou venda precisa ser revisado.";}
            else if(pending>0&&unlinked>0){diagnosis="REVISAR";reason="Há recebimento pendente e vínculo de caixa inconsistente; não force exclusão.";}
            else if(receipts!=cash||unlinked>0){diagnosis="CONFIRMAÇÃO ADMIN";reason=$"Legado divergente: recibos {receipts:C}, caixa {cash:C}, vínculos irregulares {unlinked}.";}
            else if(pending>0){diagnosis="ATENÇÃO";reason=$"{pending} operação(ões) de recebimento aguardando conferência.";}
            else{diagnosis="OK";reason="Nenhum bloqueio estrutural detectado pelo Centro de Integridade.";}
            list.Add(new(id,sale,customer,ast,sst,original,balance,receipts,cash,pending,unlinked,archived,diagnosis,reason));
        }
        return list;
    }

    private static async Task AddCountCheck(SqliteConnection c,List<IntegrityCheck151> list,string area,string code,string details,string sql,string message,string severity,CancellationToken ct)
    {
        var n=await Number(c,sql,ct);list.Add(new(area,n==0?"OK":severity,code,n==0?$"OK — {message}":message,n,details));
    }
    private static async Task AddDuplicates(SqliteConnection c,List<DuplicateItem151> list,string entity,string field,string sql,string details,CancellationToken ct)
    {
        await using var q=c.CreateCommand();q.CommandText=sql;await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))list.Add(new(entity,field,r.IsDBNull(0)?"(vazio)":Convert.ToString(r.GetValue(0))??"(vazio)",Convert.ToInt64(r.GetValue(1)),details));
    }
    private static async Task<long> Number(SqliteConnection c,string sql,CancellationToken ct){await using var q=c.CreateCommand();q.CommandText=sql;return Convert.ToInt64(await q.ExecuteScalarAsync(ct));}
    private static async Task<string?> Text(SqliteConnection c,string sql,CancellationToken ct){await using var q=c.CreateCommand();q.CommandText=sql;return Convert.ToString(await q.ExecuteScalarAsync(ct));}
    private static async Task<long> CountReader(SqliteConnection c,string sql,CancellationToken ct){long n=0;await using var q=c.CreateCommand();q.CommandText=sql;await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))n++;return n;}
}
