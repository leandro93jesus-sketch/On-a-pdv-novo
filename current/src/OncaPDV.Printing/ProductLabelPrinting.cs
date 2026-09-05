using System.Text;

namespace OncaPDV.Printing;

public sealed record ProductLabel(string Name,string Code,string? Barcode,decimal Price,bool Cut=true);

public sealed class ProductLabelPrinter(IPhysicalPrinterTransport? transport=null)
{
    private readonly IPhysicalPrinterTransport _transport=transport??new Win32RawPrinterTransport();

    public PrintResult Print(ProductLabel label,PrinterTerminalProfile profile)
    {
        if(!profile.PhysicalPrintingEnabled)return new(false,"Impressão física desativada.");
        if(string.IsNullOrWhiteSpace(profile.PrinterName))return new(false,"Impressora não configurada.");
        if(_transport.GetAvailability(profile.PrinterName)==PrinterAvailability.Offline)return new(false,"Impressora offline ou não encontrada.");
        try
        {
            var bytes=Build(label,profile.Encoding);
            var trace=_transport.Send(profile.PrinterName,bytes);
            return new(trace.WritePrinter&&trace.BytesWritten==bytes.Length,trace.BytesWritten==bytes.Length?null:"A impressora não recebeu todos os bytes.",Trace:trace);
        }
        catch(Exception ex){return new(false,ex.Message);}
    }

    public static byte[] Build(ProductLabel label,string encodingName="CP850")
    {
        var cp=encodingName switch{"CP858"=>858,"CP860"=>860,_=>850};var enc=new CodePagePrinterEncoding(cp);var b=new List<byte>{0x1B,0x40,0x1B,0x61,0x01};
        void Text(string value){b.AddRange(enc.GetBytes(value+"\r\n"));}
        Text(Clip(label.Name,42));Text($"R$ {label.Price:N2}");Text($"COD: {label.Code}");
        var barcode=string.Concat((label.Barcode??string.Empty).Where(c=>c>=32&&c<=126));
        if(barcode.Length>0)
        {
            b.AddRange([0x1D,0x48,0x02]); // HRI abaixo
            b.AddRange([0x1D,0x68,0x46]); // altura
            b.AddRange([0x1D,0x77,0x02]); // largura
            var data=Encoding.ASCII.GetBytes("{B"+barcode);b.AddRange([0x1D,0x6B,0x49,(byte)data.Length]);b.AddRange(data);Text("");
        }
        else Text("SEM CODIGO DE BARRAS");
        b.AddRange([0x1B,0x64,0x03]);if(label.Cut)b.AddRange([0x1D,0x56,0x01]);return b.ToArray();
    }

    private static string Clip(string s,int max)=>s.Length<=max?s:s[..Math.Max(1,max-1)]+"…";
}
