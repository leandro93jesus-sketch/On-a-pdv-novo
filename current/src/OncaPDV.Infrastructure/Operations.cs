using System.Reflection;
using Microsoft.Data.Sqlite;
using OncaPDV.Domain;
using OncaPDV.Printing;

namespace OncaPDV.Infrastructure;

public sealed class QueuedPrintService(IPrintService inner,OncaDatabase database):IPrintService
{
    public async Task<PrintResult> PrintAsync(ReceiptDocument document,string? printerName=null,CancellationToken ct=default)
    {
        var id=Guid.NewGuid().ToString();var now=DateTimeOffset.Now.ToString("O");await Write("INSERT INTO print_jobs(id,sale_id,status,attempts,created_at,updated_at) VALUES($id,$sale,'Pending',0,$at,$at)",id,document.Sale?.Id.ToString(),now,null,ct);
        await Write("UPDATE print_jobs SET status='Printing',attempts=attempts+1,updated_at=$at WHERE id=$id",id,null,DateTimeOffset.Now.ToString("O"),null,ct);
        try{var result=await inner.PrintAsync(document,printerName,ct);await Write("UPDATE print_jobs SET status=$status,last_error=$error,updated_at=$at WHERE id=$id",id,null,DateTimeOffset.Now.ToString("O"),result.Error,ct,result.Success?"Success":"Failed");return result;}
        catch(Exception ex){await Write("UPDATE print_jobs SET status='Failed',last_error=$error,updated_at=$at WHERE id=$id",id,null,DateTimeOffset.Now.ToString("O"),ex.Message,ct);throw;}
    }
    private async Task Write(string sql,string id,string? sale,string at,string? error,CancellationToken ct,string? status=null){await using var c=database.Open();await using var q=c.CreateCommand();q.CommandText=sql;q.Parameters.AddWithValue("$id",id);q.Parameters.AddWithValue("$sale",(object?)sale??DBNull.Value);q.Parameters.AddWithValue("$at",at);q.Parameters.AddWithValue("$error",(object?)error??DBNull.Value);q.Parameters.AddWithValue("$status",(object?)status??DBNull.Value);await q.ExecuteNonQueryAsync(ct);}
}

public sealed record DiagnosticSnapshot(string Version,string DatabasePath,string Integrity,string JournalMode,long ForeignKeys,string[] Printers,string? ConfiguredPrinter,string PhysicalMode,long PendingPrints,string? LastError,string? LastBackup,long FreeDiskBytes,string Paper,string Encoding,string Renderer,string? LastPrint,int LastBytesSent);
public sealed class DiagnosticService(OncaDatabase database,AppPaths paths)
{
    public async Task<DiagnosticSnapshot> ReadAsync(CancellationToken ct=default)
    {
        await using var c=database.Open();var wal=await Scalar(c,"PRAGMA journal_mode",ct);var fk=Convert.ToInt64(await Scalar(c,"PRAGMA foreign_keys",ct));var pending=Convert.ToInt64(await Scalar(c,"SELECT COUNT(*) FROM print_jobs WHERE status IN ('Pending','Printing','Failed')",ct));
        var lastError=Directory.Exists(paths.Logs)?Directory.GetFiles(paths.Logs,"*.log").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault():null;var backup=Directory.Exists(paths.Backups)?Directory.GetFiles(paths.Backups,"*.db").OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault():null;
        var printers=WindowsPrinterDiscovery.GetInstalled();var printLog=Path.Combine(paths.Logs,"printing-physical.log");var lastPrint=File.Exists(printLog)?File.ReadLines(printLog).LastOrDefault():null;var bytes=0;if(lastPrint is not null){var match=System.Text.RegularExpressions.Regex.Match(lastPrint,@"bytes=(\d+)");if(match.Success)int.TryParse(match.Groups[1].Value,out bytes);}return new(Assembly.GetEntryAssembly()?.GetName().Version?.ToString()??"0.1.0",database.DatabasePath,database.IntegrityCheck(),Convert.ToString(wal)??"unknown",fk,printers.Select(x=>$"fila={x.QueueName} | driver={x.DriverName} | porta={x.PortName} | status={x.Status} | papel={x.Paper} | padrão={x.IsDefault}").ToArray(),printers.FirstOrDefault(x=>x.IsDefault)?.QueueName,"BLOQUEADO (PHYSICAL_PRINTING=false)",pending,lastError is null?null:Path.GetFileName(lastError),backup is null?null:Path.GetFileName(backup),new DriveInfo(Path.GetPathRoot(paths.Root)!).AvailableFreeSpace,"80 mm","CP850 (CP858/CP860 disponíveis)","EscPos80Renderer",lastPrint,bytes);
    }
    public async Task<string> ExportAsync(CancellationToken ct=default){var d=await ReadAsync(ct);paths.EnsureCreated();var target=Path.Combine(paths.Exports,$"diagnostico-{DateTime.Now:yyyyMMdd-HHmmss}.txt");await File.WriteAllTextAsync(target,System.Text.Json.JsonSerializer.Serialize(d,new System.Text.Json.JsonSerializerOptions{WriteIndented=true}),ct);return target;}
    private static async Task<object?> Scalar(SqliteConnection c,string sql,CancellationToken ct){await using var q=c.CreateCommand();q.CommandText=sql;return await q.ExecuteScalarAsync(ct);}
}
