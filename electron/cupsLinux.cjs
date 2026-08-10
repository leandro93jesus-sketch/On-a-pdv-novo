/**
 * Adapter CUPS (somente Linux).
 * Usa execFile com argumentos separados — nunca shell concatenado.
 */
const { execFile } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const DEFAULT_TIMEOUT = 8000;

function run(cmd, args, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            code: err.code,
            killed: Boolean(err.killed),
            stdout: String(stdout || ''),
            stderr: String(stderr || err.message || ''),
          });
          return;
        }
        resolve({
          ok: true,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      }
    );
    child.on('error', (e) => {
      resolve({ ok: false, stdout: '', stderr: e.message || String(e), code: e.code });
    });
  });
}

async function cupsAvailable() {
  const which = await run('which', ['lpstat'], 3000);
  if (!which.ok) {
    return {
      available: false,
      active: false,
      error: 'Sistema de impressão CUPS não está disponível.',
      hint: 'Instale o pacote cups (ex.: sudo apt install cups) se adequado à sua distribuição. O PDV não instala pacotes automaticamente.',
      lpstat: false,
      lp: false,
    };
  }
  const lp = await run('which', ['lp'], 3000);
  const status = await run('lpstat', ['-r'], DEFAULT_TIMEOUT);
  const active =
    status.ok && /scheduler is running/i.test(status.stdout || status.stderr || '');
  return {
    available: true,
    active,
    lpstat: true,
    lp: lp.ok,
    error: active
      ? null
      : status.ok
        ? 'CUPS encontrado, mas o agendador não está ativo.'
        : 'Sistema de impressão CUPS não está disponível.',
    hint: active
      ? null
      : 'Verifique o serviço cups (ex.: systemctl status cups). Pacote típico: cups.',
    raw_status: (status.stdout || status.stderr || '').trim(),
  };
}

function parsePrintersFromLpstat(stdout) {
  const printers = [];
  const lines = String(stdout || '').split('\n');
  for (const line of lines) {
    // "printer Nome is idle.  enabled since ..."
    const m = line.match(/^printer\s+(\S+)\s+is\s+(.+)$/i);
    if (m) {
      const name = m[1];
      const rest = m[2].toLowerCase();
      printers.push({
        name,
        displayName: name,
        description: 'CUPS',
        status: /idle|idle\./.test(rest) ? 0 : 1,
        isDefault: false,
        source: 'cups',
      });
    }
  }
  return printers;
}

async function listCupsPrinters() {
  const avail = await cupsAvailable();
  if (!avail.available) {
    return { printers: [], cups: avail, error: avail.error, hint: avail.hint };
  }
  const listed = await run('lpstat', ['-p'], DEFAULT_TIMEOUT);
  if (!listed.ok) {
    return {
      printers: [],
      cups: avail,
      error: 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA (CUPS).',
      hint: avail.hint,
    };
  }
  const printers = parsePrintersFromLpstat(listed.stdout);
  const def = await run('lpstat', ['-d'], 4000);
  let defaultName = null;
  if (def.ok) {
    const m = def.stdout.match(/system default destination:\s*(\S+)/i);
    if (m) defaultName = m[1];
  }
  if (defaultName) {
    for (const p of printers) {
      if (p.name === defaultName) p.isDefault = true;
    }
  }
  return {
    printers,
    cups: { ...avail, default_printer: defaultName },
    error: null,
  };
}

function safePrinterName(name) {
  const n = String(name || '').trim();
  if (!n || n.length > 120) return null;
  // CUPS names: letters, digits, _ - .
  if (!/^[A-Za-z0-9._-]+$/.test(n)) return null;
  return n;
}

/**
 * Impressão de teste via CUPS (texto simples).
 */
async function printTestViaCups({ deviceName, title } = {}) {
  const avail = await cupsAvailable();
  if (!avail.available || !avail.lp) {
    return {
      ok: false,
      error: avail.error || 'Sistema de impressão CUPS não está disponível.',
      hint: avail.hint,
      via: 'cups',
    };
  }
  const dest = safePrinterName(deviceName);
  let dir = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'onca-pdv-print-'));
    const file = join(dir, 'teste.txt');
    const body = [
      'ONÇA PDV',
      'Teste de impressão',
      `Impressora: ${dest || '(padrão do sistema)'}`,
      `Data/hora: ${new Date().toISOString()}`,
      title ? `Doc: ${title}` : '',
      '',
    ]
      .filter(Boolean)
      .join('\n');
    writeFileSync(file, body, 'utf8');
    const args = dest ? ['-d', dest, file] : [file];
    const res = await run('lp', args, 15000);
    if (!res.ok) {
      return {
        ok: false,
        error: (res.stderr || res.stdout || 'Falha ao enviar para CUPS').trim(),
        via: 'cups',
      };
    }
    return { ok: true, via: 'cups', stdout: res.stdout.trim() };
  } catch (err) {
    return { ok: false, error: err.message || String(err), via: 'cups' };
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

async function linuxPrintDiagnostics() {
  const cups = await cupsAvailable();
  let printers = [];
  let defaultPrinter = null;
  let listError = null;
  if (cups.available) {
    const listed = await listCupsPrinters();
    printers = listed.printers || [];
    defaultPrinter = listed.cups?.default_printer || null;
    listError = listed.error;
  }
  let bluetoothctl = false;
  const bt = await run('which', ['bluetoothctl'], 3000);
  bluetoothctl = bt.ok;
  return {
    platform: 'linux',
    cups,
    printers_count: printers.length,
    printers: printers.map((p) => p.name),
    default_printer: defaultPrinter,
    list_error: listError,
    bluetoothctl_available: bluetoothctl,
    fuse2_hint:
      'AppImage requer libfuse.so.2. Em Ubuntu 24.04: sudo apt install libfuse2t64 (ou use o pacote tar.gz sem FUSE).',
  };
}

module.exports = {
  cupsAvailable,
  listCupsPrinters,
  printTestViaCups,
  linuxPrintDiagnostics,
  safePrinterName,
};
