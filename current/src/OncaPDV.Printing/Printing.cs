using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using OncaPDV.Domain;

namespace OncaPDV.Printing;

public sealed record ReceiptCompany(string DisplayName, string? LegalName=null, string? Cnpj=null, string? StateRegistration=null, string? Phone=null, string? AddressLine1=null, string? AddressLine2=null, string FooterMessage="OBRIGADO PELA PREFERENCIA");
public sealed record ReceiptDocument(Sale? Sale, string CompanyName="ONCA PRODUTOS DE LIMPEZA", string? CustomerName=null, bool OpenDrawer=false, bool Cut=false, IReadOnlyList<string>? DiagnosticLines=null, string? OperatorName=null, bool IsReprint=false, string? SaleLabel=null, ReceiptCompany? Company=null);
public sealed record RenderedReceipt(byte[] Bytes,string Text,string Media);
public sealed record SpoolerTrace(bool OpenPrinter,bool StartDocPrinter,bool StartPagePrinter,bool WritePrinter,bool EndPagePrinter,bool EndDocPrinter,int BytesRequested,int BytesWritten,int Win32Error,int JobId=0);
public sealed record PrintResult(bool Success,string? Error=null,string? PreviewPath=null,SpoolerTrace? Trace=null);
public enum PrintBackend { EscPosRaw, WindowsDriver }
public sealed record PrinterTerminalProfile(string TerminalId,string PrinterName,string PrinterPort,int PaperWidthMm,PrintBackend PrintBackend,string Encoding,bool CutEnabled,bool DrawerEnabled,bool PhysicalPrintingEnabled=false);
public interface IReceiptRenderer { RenderedReceipt Render(ReceiptDocument document); }
public interface IPrintService { Task<PrintResult> PrintAsync(ReceiptDocument document,string? printerName=null,CancellationToken ct=default); }
public interface IPrinterEncoding { string Name { get; } byte[] GetBytes(string text); }
public static class PlainAsciiDiagnosticPayload
{
    public const string Text="ONCA\r\nTESTE TEXTO PURO\r\nIMPRESSORA OK\r\n";
    public const string Hex="4F4E43410D0A544553544520544558544F205055524F0D0A494D50524553534F5241204F4B0D0A";
    public static byte[] Create(){var bytes=Encoding.ASCII.GetBytes(Text);if(bytes.Length!=39||Convert.ToHexString(bytes)!=Hex||bytes.Contains((byte)0x1B))throw new InvalidOperationException("Payload ASCII puro inválido.");return bytes;}
}
public sealed class CodePagePrinterEncoding : IPrinterEncoding
{
    private readonly Encoding _encoding;public string Name=>_encoding.WebName;
    public CodePagePrinterEncoding(int codePage=850){Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);_encoding=Encoding.GetEncoding(codePage,EncoderFallback.ReplacementFallback,DecoderFallback.ReplacementFallback);}
    public byte[] GetBytes(string text)=>_encoding.GetBytes(text);
    public static CodePagePrinterEncoding Cp850()=>new(850);public static CodePagePrinterEncoding Cp858()=>new(858);public static CodePagePrinterEncoding Cp860()=>new(860);
}

public abstract class EscPosRenderer(int columns,string media,IPrinterEncoding? printerEncoding=null) : IReceiptRenderer
{
    private readonly IPrinterEncoding _printerEncoding=printerEncoding??CodePagePrinterEncoding.Cp850();
    public RenderedReceipt Render(ReceiptDocument d)
    {
        ArgumentNullException.ThrowIfNull(d);if(d.DiagnosticLines is {Count:>0})return RenderLines(d);if(d.Sale is null||d.Sale.Items.Count==0)throw new InvalidOperationException("PRINT BLOCKED - EMPTY RECEIPT");
        var text=new StringBuilder();void Line(string value="")=>text.Append(value).Append("\r\n");
        var company=d.Company;
        Line(Center(company?.DisplayName??d.CompanyName));
        Line(Center("COMPROVANTE NAO FISCAL"));
        if(!string.IsNullOrWhiteSpace(company?.LegalName))Line(Center(company!.LegalName!));
        if(!string.IsNullOrWhiteSpace(company?.Cnpj))Line(Center($"CNPJ: {company!.Cnpj}"));
        if(!string.IsNullOrWhiteSpace(company?.StateRegistration))Line(Center($"IE: {company!.StateRegistration}"));
        if(!string.IsNullOrWhiteSpace(company?.AddressLine1))Line(Center(company!.AddressLine1!));
        if(!string.IsNullOrWhiteSpace(company?.AddressLine2))Line(Center(company!.AddressLine2!));
        if(!string.IsNullOrWhiteSpace(company?.Phone))Line(Center($"Tel: {company!.Phone}"));
        if(d.IsReprint)Line(Center("REIMPRESSAO / SEGUNDA VIA"));Line();
        Line($"Venda: {d.SaleLabel??d.Sale.Number.ToString("00000")}");Line($"Data: {d.Sale.CreatedAt.ToLocalTime():dd/MM/yyyy HH:mm}");Line($"Operador: {Clip(d.OperatorName??d.Sale.OperatorId.ToString("N")[..8].ToUpperInvariant())}");
        if(!string.IsNullOrWhiteSpace(d.CustomerName))Line($"Cliente: {Clip(d.CustomerName)}");
        Line();Line("PRODUTOS");Line(new string('-',columns));
        foreach(var i in d.Sale.Items){Line(Clip($"{i.Quantity:0.###} x {i.Name}"));Line($"  Valor unitario: {Money(i.UnitPrice)}");Line($"  Subtotal: {Money(i.Subtotal)}");}
        Line(new string('-',columns));Line($"TOTAL: {Money(d.Sale.Total)}");Line();Line("Pagamento:");foreach(var p in d.Sale.Payments)Line($"  {PaymentName(p.Method)}: {Money(p.Amount)}");
        var received=d.Sale.Payments.Sum(p=>p.Received??p.Amount);var change=d.Sale.Payments.Sum(p=>p.Change);
        Line();Line("Recebido:");Line($"  {Money(received)}");Line();Line("Troco:");Line($"  {Money(change)}");
        Line();Line(new string('-',columns));Line(Center(company?.FooterMessage??"OBRIGADO PELA PREFERENCIA"));
        var body=_printerEncoding.GetBytes(text.ToString());var bytes=new List<byte>{0x1B,0x40};bytes.AddRange(body);bytes.AddRange([0x1B,0x64,0x04]);if(d.OpenDrawer)bytes.AddRange([0x1B,0x70,0x00,0x19,0xFA]);if(d.Cut)bytes.AddRange([0x1D,0x56,0x01]);
        return new(bytes.ToArray(),text.ToString(),media);
    }
    private RenderedReceipt RenderLines(ReceiptDocument d){var text=string.Join("\n",d.DiagnosticLines!)+"\n";var bytes=new List<byte>{0x1B,0x40};bytes.AddRange(_printerEncoding.GetBytes(text));bytes.AddRange([0x1B,0x64,0x02]);if(d.OpenDrawer)bytes.AddRange([0x1B,0x70,0x00,0x19,0xFA]);if(d.Cut)bytes.AddRange([0x1D,0x56,0x01]);return new(bytes.ToArray(),text,media);}
    private string Center(string value){value=Clip(value);return value.PadLeft(value.Length+(columns-value.Length)/2);}
    private string Clip(string value)=>value.Length<=columns?value:value[..Math.Max(0,columns-1)]+"…";
    private static string Money(decimal value)=>"R$ "+value.ToString("N2",CultureInfo.GetCultureInfo("pt-BR"));
    private static string PaymentName(PaymentMethod method)=>method switch{PaymentMethod.Cash=>"Dinheiro",PaymentMethod.Pix=>"PIX",PaymentMethod.Debit=>"Debito",PaymentMethod.Credit=>"Credito",PaymentMethod.StoreCredit=>"Crediario",_=>method.ToString()};
}
public sealed class EscPos58Renderer(IPrinterEncoding? encoding=null):EscPosRenderer(32,"58mm",encoding);
public sealed class EscPos80Renderer(IPrinterEncoding? encoding=null):EscPosRenderer(48,"80mm",encoding);
public sealed class MockReceiptRenderer(IPrinterEncoding? encoding=null):EscPosRenderer(48,"mock",encoding);

public static class ReceiptValidator
{
    public const int MinimumBytes=24;
    public static void EnsurePrintable(RenderedReceipt receipt)
    {
        if(receipt.Bytes is null||receipt.Bytes.Length<MinimumBytes||string.IsNullOrWhiteSpace(receipt.Text))throw new InvalidOperationException("PRINT BLOCKED - EMPTY RECEIPT");
    }
}

public sealed class MockPrintService(IReceiptRenderer renderer,string outputDirectory):IPrintService
{
    public async Task<PrintResult> PrintAsync(ReceiptDocument document,string? printerName=null,CancellationToken ct=default)
    {
        var receipt=renderer.Render(document);ReceiptValidator.EnsurePrintable(receipt);Directory.CreateDirectory(outputDirectory);var stem=$"cupom-{document.Sale?.Number??0:000000}-{DateTime.Now:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}";
        var txt=Path.Combine(outputDirectory,stem+".txt");await File.WriteAllTextAsync(txt,receipt.Text,Encoding.UTF8,ct);await File.WriteAllBytesAsync(Path.Combine(outputDirectory,stem+".bin"),receipt.Bytes,ct);
        await File.AppendAllTextAsync(Path.Combine(outputDirectory,"printing.log"),$"{DateTimeOffset.Now:O} MOCK SUCCESS {receipt.Media} {receipt.Bytes.Length} bytes{Environment.NewLine}",ct);return new(true,PreviewPath:txt);
    }
}

public enum PrinterAvailability { Online, Offline, Unknown }
public interface IPhysicalPrinterTransport { PrinterAvailability GetAvailability(string printerName); SpoolerTrace Send(string printerName,byte[] bytes); }

public sealed class WindowsRawPrintService(IReceiptRenderer renderer,string logDirectory,bool physicalPrintingEnabled,IPhysicalPrinterTransport? physicalTransport=null):IPrintService
{
    private readonly IPhysicalPrinterTransport _transport=physicalTransport??new Win32RawPrinterTransport();
    public Task<PrintResult> PrintAsync(ReceiptDocument document,string? printerName=null,CancellationToken ct=default)
    {
        if(string.IsNullOrWhiteSpace(printerName))return Task.FromResult(new PrintResult(false,"Nome de impressora não configurado."));
        var receipt=renderer.Render(document);ReceiptValidator.EnsurePrintable(receipt);Directory.CreateDirectory(logDirectory);File.WriteAllText(Path.Combine(logDirectory,"print-last.txt"),receipt.Text,Encoding.UTF8);File.WriteAllBytes(Path.Combine(logDirectory,"print-last-escpos.bin"),receipt.Bytes);File.AppendAllText(Path.Combine(logDirectory,"printing-physical.log"),$"{DateTimeOffset.Now:O} bytes={receipt.Bytes.Length} text={receipt.Text.Length} renderer={renderer.GetType().Name} printer={printerName} physical={physicalPrintingEnabled}{Environment.NewLine}");
        if(!physicalPrintingEnabled)return Task.FromResult(new PrintResult(false,"Impressão física bloqueada por configuração."));
        if(_transport.GetAvailability(printerName)==PrinterAvailability.Offline)return Task.FromResult(new PrintResult(false,"IMPRESSORA OFFLINE — Nenhum dado foi enviado."));
        try{var trace=_transport.Send(printerName,receipt.Bytes);File.AppendAllText(Path.Combine(logDirectory,"printing-physical.log"),$"TRACE {System.Text.Json.JsonSerializer.Serialize(trace)}{Environment.NewLine}");return Task.FromResult(new PrintResult(trace.WritePrinter&&trace.BytesWritten==receipt.Bytes.Length,Trace:trace));}catch(Exception ex){File.AppendAllText(Path.Combine(logDirectory,"printing-physical.log"),$"ERROR {ex}{Environment.NewLine}");return Task.FromResult(new PrintResult(false,ex.Message));}
    }
}

public sealed class Win32RawPrinterTransport:IPhysicalPrinterTransport
{
    public PrinterAvailability GetAvailability(string printerName)=>WindowsPrinterDiscovery.GetInstalled().Any(x=>string.Equals(x.QueueName,printerName,StringComparison.OrdinalIgnoreCase))?PrinterAvailability.Unknown:PrinterAvailability.Offline;
    public SpoolerTrace Send(string printerName,byte[] bytes)=>RawSpooler.Send(printerName,bytes);
}

internal static class RawSpooler
{
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]private sealed class DOC_INFO_1{[MarshalAs(UnmanagedType.LPWStr)]public string pDocName="ONCA PDV CUPOM";[MarshalAs(UnmanagedType.LPWStr)]public string? pOutputFile;[MarshalAs(UnmanagedType.LPWStr)]public string pDataType="RAW";}
    [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Unicode)]private static extern bool OpenPrinter(string pPrinterName,out IntPtr phPrinter,IntPtr pDefault);
    [DllImport("winspool.drv",SetLastError=true)]private static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Unicode)]private static extern int StartDocPrinter(IntPtr hPrinter,int level,[In]DOC_INFO_1 di);
    [DllImport("winspool.drv",SetLastError=true)]private static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv",SetLastError=true)]private static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv",SetLastError=true)]private static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv",SetLastError=true)]private static extern bool WritePrinter(IntPtr hPrinter,IntPtr bytes,int count,out int written);
    public static SpoolerTrace Send(string printer,byte[] bytes)
    {
        if(!OperatingSystem.IsWindows())throw new PlatformNotSupportedException();var opened=OpenPrinter(printer,out var handle,IntPtr.Zero);if(!opened)throw Win32();var doc=false;var page=false;var wrote=false;var endPage=false;var endDoc=false;var written=0;var error=0;var jobId=0;
        try{jobId=StartDocPrinter(handle,1,new DOC_INFO_1());doc=jobId!=0;if(!doc)throw Win32();try{page=StartPagePrinter(handle);if(!page)throw Win32();try{var ptr=Marshal.AllocHGlobal(bytes.Length);try{Marshal.Copy(bytes,0,ptr,bytes.Length);wrote=WritePrinter(handle,ptr,bytes.Length,out written);if(!wrote||written!=bytes.Length){error=Marshal.GetLastWin32Error();throw Win32();}}finally{Marshal.FreeHGlobal(ptr);}}finally{endPage=EndPagePrinter(handle);}}finally{endDoc=EndDocPrinter(handle);}}finally{ClosePrinter(handle);}return new(opened,doc,page,wrote,endPage,endDoc,bytes.Length,written,error,jobId);
    }
    private static Win32Exception Win32()=>new(Marshal.GetLastWin32Error());
}
