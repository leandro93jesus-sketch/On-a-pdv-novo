using Microsoft.Data.Sqlite;
using System.Security.Cryptography;

namespace OncaPDV.Migration;

public sealed record LegacyAnalysis(string Source,IReadOnlyDictionary<string,long?> Counts,IReadOnlyList<string> Tables,DateTimeOffset AnalyzedAt);
public sealed record LegacyProductDryRun(string Source,string SourceSha256Before,string SourceSha256After,string? ProductTable,long Rows,long MissingInternalCode,long DuplicateInternalCodes,long DuplicateBarcodes,long DuplicateNames,bool ImportExecuted,IReadOnlyList<string> Warnings);
public sealed class LegacyAnalyzer
{
    private static readonly string[] Candidates=["products","clientes","customers","sales","vendas","sale_items","itens_venda","payments","pagamentos","cash_movements","movimentos_caixa","cash_sessions","sessoes_caixa","stock_movements","movimentos_estoque","suppliers","fornecedores","settings","configuracoes"];
    public async Task<LegacyAnalysis> AnalyzeAsync(string source,CancellationToken ct=default)
    {
        var full=Path.GetFullPath(source);if(!File.Exists(full))throw new FileNotFoundException("Banco legado não encontrado.",full);
        var cs=new SqliteConnectionStringBuilder{DataSource=full,Mode=SqliteOpenMode.ReadOnly,Cache=SqliteCacheMode.Private}.ToString();
        await using var c=new SqliteConnection(cs);await c.OpenAsync(ct);await using(var q=c.CreateCommand()){q.CommandText="PRAGMA query_only=ON;";await q.ExecuteNonQueryAsync(ct);}
        var tables=new List<string>();await using(var q=c.CreateCommand()){q.CommandText="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name";await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))tables.Add(r.GetString(0));}
        var counts=new Dictionary<string,long?>();foreach(var name in Candidates.Intersect(tables,StringComparer.OrdinalIgnoreCase)){if(!IsSafeIdentifier(name))continue;await using var q=c.CreateCommand();q.CommandText=$"SELECT COUNT(*) FROM \"{name}\"";counts[name]=Convert.ToInt64(await q.ExecuteScalarAsync(ct));}
        return new(full,counts,tables,DateTimeOffset.Now);
    }
    public async Task<LegacyProductDryRun> AnalyzeProductsDryRunAsync(string source,CancellationToken ct=default)
    {
        var full=Path.GetFullPath(source);if(!File.Exists(full))throw new FileNotFoundException("Banco legado não encontrado.",full);var before=await HashAsync(full,ct);var warnings=new List<string>();var cs=new SqliteConnectionStringBuilder{DataSource=full,Mode=SqliteOpenMode.ReadOnly,Cache=SqliteCacheMode.Private}.ToString();await using var c=new SqliteConnection(cs);await c.OpenAsync(ct);await using(var lockRead=c.CreateCommand()){lockRead.CommandText="PRAGMA query_only=ON";await lockRead.ExecuteNonQueryAsync(ct);}var table=await ExistingAsync(c,"products",ct)?"products":await ExistingAsync(c,"produtos",ct)?"produtos":null;if(table is null){warnings.Add("Tabela de produtos não localizada.");return new(full,before,await HashAsync(full,ct),null,0,0,0,0,0,false,warnings);}
        var columns=new HashSet<string>(StringComparer.OrdinalIgnoreCase);await using(var q=c.CreateCommand()){q.CommandText=$"PRAGMA table_info(\"{table}\")";await using var r=await q.ExecuteReaderAsync(ct);while(await r.ReadAsync(ct))columns.Add(r.GetString(1));}
        string? Pick(params string[] names)=>names.FirstOrDefault(columns.Contains);var code=Pick("internal_code","codigo","code");var barcode=Pick("barcode","codigo_barras","ean");var name=Pick("name","nome","descricao");if(code is null)warnings.Add("Coluna de código interno não localizada.");if(name is null)warnings.Add("Coluna de nome não localizada.");var rows=await Scalar(c,$"SELECT COUNT(*) FROM \"{table}\"",ct);var missing=code is null?rows:await Scalar(c,$"SELECT COUNT(*) FROM \"{table}\" WHERE \"{code}\" IS NULL OR TRIM(\"{code}\")=''",ct);var duplicateCodes=code is null?0:await Duplicates(c,table,code,ct);var duplicateBarcodes=barcode is null?0:await Duplicates(c,table,barcode,ct);var duplicateNames=name is null?0:await Duplicates(c,table,name,ct);if(duplicateCodes>0)warnings.Add("Códigos internos duplicados exigem resolução antes da importação.");if(duplicateBarcodes>0)warnings.Add("Códigos de barras duplicados exigem resolução antes da importação.");var after=await HashAsync(full,ct);if(before!=after)throw new IOException("A origem foi alterada durante o dry-run.");return new(full,before,after,table,rows,missing,duplicateCodes,duplicateBarcodes,duplicateNames,false,warnings);
    }
    private static async Task<bool> ExistingAsync(SqliteConnection c,string table,CancellationToken ct){await using var q=c.CreateCommand();q.CommandText="SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$name COLLATE NOCASE";q.Parameters.AddWithValue("$name",table);return Convert.ToInt64(await q.ExecuteScalarAsync(ct))>0;}
    private static async Task<long> Duplicates(SqliteConnection c,string table,string column,CancellationToken ct)=>await Scalar(c,$"SELECT COUNT(*) FROM (SELECT \"{column}\" FROM \"{table}\" WHERE \"{column}\" IS NOT NULL AND TRIM(\"{column}\")<>'' GROUP BY \"{column}\" COLLATE NOCASE HAVING COUNT(*)>1)",ct);
    private static async Task<long> Scalar(SqliteConnection c,string sql,CancellationToken ct){await using var q=c.CreateCommand();q.CommandText=sql;return Convert.ToInt64(await q.ExecuteScalarAsync(ct));}
    private static async Task<string> HashAsync(string file,CancellationToken ct){await using var input=File.Open(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite);return Convert.ToHexString(await SHA256.HashDataAsync(input,ct));}
    private static bool IsSafeIdentifier(string value)=>value.All(c=>char.IsLetterOrDigit(c)||c=='_');
}
