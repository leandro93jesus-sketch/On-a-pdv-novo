/**
 * Envio RAW/ESC/POS. Recusa buffer vazio. Não imprime a janela do PDV.
 */
const { execFile } = require('node:child_process');
const { writeFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');

function assertBytes(bytes) {
  if (!bytes || !bytes.length || bytes.length < 20) {
    const err = new Error('IMPRESSÃO CANCELADA\nO cupom não foi gerado corretamente.');
    err.code = 'EMPTY_CUPOM';
    throw err;
  }
}

function writeTemp(bytes) {
  const file = join(tmpdir(), `onca-raw-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
  writeFileSync(file, Buffer.from(bytes));
  return file;
}

function sendTcp(host, port, bytes, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port: Number(port) || 9100 }, () => {
      sock.write(Buffer.from(bytes), (err) => {
        sock.end();
        if (err) resolve({ ok: false, error: err.message, via: 'tcp' });
        else resolve({ ok: true, via: 'tcp' });
      });
    });
    sock.setTimeout(timeoutMs);
    sock.on('error', (err) => resolve({ ok: false, error: err.message, via: 'tcp' }));
    sock.on('timeout', () => {
      sock.destroy();
      resolve({ ok: false, error: 'Timeout na impressora de rede.', via: 'tcp' });
    });
  });
}

function sendLinuxRaw(deviceName, bytes) {
  const file = writeTemp(bytes);
  return new Promise((resolve) => {
    const args = ['-o', 'raw'];
    if (deviceName) args.push('-d', deviceName);
    args.push(file);
    execFile('lp', args, { timeout: 15000 }, (err) => {
      try {
        unlinkSync(file);
      } catch {
        /* ignore */
      }
      if (err) {
        resolve({
          ok: false,
          error: err.message || 'Falha ao enviar RAW via CUPS (lp -o raw).',
          via: 'cups-raw',
        });
        return;
      }
      resolve({ ok: true, via: 'cups-raw' });
    });
  });
}

function sendWindowsRaw(deviceName, bytes) {
  const file = writeTemp(bytes);
  const printer = deviceName || '';
  const ps = `
$ErrorActionPreference='Stop'
$printer = ${JSON.stringify(printer)}
$file = ${JSON.stringify(file)}
$code = @"
using System;
using System.Runtime.InteropServices;
public class OncaRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static string Send(string printerName, byte[] bytes) {
    IntPtr h;
    if (string.IsNullOrWhiteSpace(printerName)) return "NO_PRINTER";
    if (!OpenPrinter(printerName, out h, IntPtr.Zero)) return "OPEN_FAIL";
    var di = new DOCINFOA();
    di.pDocName = "ONCA-PDV";
    di.pDataType = "RAW";
    if (!StartDocPrinter(h, 1, di)) { ClosePrinter(h); return "DOC_FAIL"; }
    StartPagePrinter(h);
    IntPtr p = Marshal.AllocHGlobal(bytes.Length);
    Marshal.Copy(bytes, 0, p, bytes.Length);
    int written;
    WritePrinter(h, p, bytes.Length, out written);
    Marshal.FreeHGlobal(p);
    EndPagePrinter(h);
    EndDocPrinter(h);
    ClosePrinter(h);
    return written > 0 ? "OK" : "WRITE_FAIL";
  }
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue | Out-Null
$bytes = [System.IO.File]::ReadAllBytes($file)
Write-Output ([OncaRawPrinter]::Send($printer, $bytes))
`;
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', ps],
      { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        try {
          unlinkSync(file);
        } catch {
          /* ignore */
        }
        const out = String(stdout || '').trim();
        if (err || out !== 'OK') {
          resolve({
            ok: false,
            error:
              out === 'NO_PRINTER'
                ? 'Selecione a impressora térmica nas configurações.'
                : `Falha no envio RAW Windows (${out || err?.message || 'erro'}).`,
            via: 'win-raw',
          });
          return;
        }
        resolve({ ok: true, via: 'win-raw' });
      }
    );
  });
}

async function sendRaw(opts = {}) {
  const bytes = opts.bytes;
  assertBytes(bytes);
  const method = opts.method || 'escpos';
  if (method === 'tcp') {
    if (!opts.host) return { ok: false, error: 'Informe o IP da impressora de rede.', via: 'tcp' };
    return sendTcp(opts.host, opts.port || 9100, bytes);
  }
  if (process.platform === 'win32') {
    return sendWindowsRaw(opts.deviceName, bytes);
  }
  return sendLinuxRaw(opts.deviceName, bytes);
}

module.exports = { sendRaw, assertBytes };
