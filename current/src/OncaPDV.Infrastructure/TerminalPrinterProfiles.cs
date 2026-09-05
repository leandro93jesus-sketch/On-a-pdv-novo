using System.Text.Json;
using OncaPDV.Printing;

namespace OncaPDV.Infrastructure;
public sealed class TerminalPrinterProfileStore(AppPaths paths)
{
 private string DirectoryPath=>Path.Combine(paths.Data,"terminals");
 public async Task SaveAsync(PrinterTerminalProfile profile,CancellationToken ct=default){if(string.IsNullOrWhiteSpace(profile.TerminalId)||string.IsNullOrWhiteSpace(profile.PrinterName)||profile.PaperWidthMm is not(58 or 80))throw new ArgumentException("Perfil de terminal inválido.");Directory.CreateDirectory(DirectoryPath);var file=Path.Combine(DirectoryPath,Safe(profile.TerminalId)+".printer.json");var temp=file+".tmp";await File.WriteAllTextAsync(temp,JsonSerializer.Serialize(profile,new JsonSerializerOptions{WriteIndented=true}),ct);File.Move(temp,file,true);}
 public async Task<PrinterTerminalProfile?> LoadAsync(string terminalId,CancellationToken ct=default){var file=Path.Combine(DirectoryPath,Safe(terminalId)+".printer.json");return File.Exists(file)?JsonSerializer.Deserialize<PrinterTerminalProfile>(await File.ReadAllTextAsync(file,ct)):null;}
 private static string Safe(string value)=>string.Concat(value.Trim().ToUpperInvariant().Select(c=>char.IsLetterOrDigit(c)||c=='-'?c:'_'));
}
