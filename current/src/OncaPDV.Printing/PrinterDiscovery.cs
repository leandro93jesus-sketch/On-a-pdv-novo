using System.Runtime.InteropServices;using System.Text;
namespace OncaPDV.Printing;
public sealed record PrinterInfo(string QueueName,string? DriverName,string? PortName,bool IsDefault,string Status="Desconhecido",string Paper="Não informado"){public override string ToString()=>$"{QueueName}{(IsDefault?" (Padrão)":"")}";}
public static class WindowsPrinterDiscovery
{
 [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]private static extern bool GetDefaultPrinter(StringBuilder? name,ref int size);
 public static IReadOnlyList<PrinterInfo> GetInstalled(){if(!OperatingSystem.IsWindows())return[];var def=DefaultName();var result=new List<PrinterInfo>();try{using var root=Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Print\Printers");foreach(var name in root?.GetSubKeyNames()??[]){using var key=root!.OpenSubKey(name);var status=Convert.ToInt32(key?.GetValue("Status")??0)==0?"Normal":"Atenção";var paper=name.Contains("POS-80",StringComparison.OrdinalIgnoreCase)?"80 mm":"Não informado";result.Add(new(name,Convert.ToString(key?.GetValue("Printer Driver")),Convert.ToString(key?.GetValue("Port")),string.Equals(name,def,StringComparison.OrdinalIgnoreCase),status,paper));}}catch{}return result.OrderByDescending(x=>x.IsDefault).ThenBy(x=>x.QueueName).ToArray();}
 private static string? DefaultName(){var size=0;GetDefaultPrinter(null,ref size);if(size<=0)return null;var b=new StringBuilder(size);return GetDefaultPrinter(b,ref size)?b.ToString():null;}
}
