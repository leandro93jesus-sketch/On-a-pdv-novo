/**
 * IPC de impressoras/Bluetooth com timeout e cancelamento.
 * Linux: Electron getPrintersAsync + fallback CUPS.
 * Windows: fluxo Electron existente (não alterado em comportamento).
 */
const { execFile } = require('node:child_process');

const PRINTERS_LIST_TIMEOUT_MS = 8000;
const PRINT_TEST_TIMEOUT_MS = 15000;
const BLUETOOTH_TIMEOUT_MS = 15000;

let activeBtChild = null;
let btGeneration = 0;

function withTimeout(promise, ms, onTimeoutValue) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(onTimeoutValue), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function listBluetoothDevicesOs(signalGen) {
  return new Promise((resolve) => {
    const done = (value) => {
      if (signalGen !== btGeneration) {
        resolve({ devices: [], cancelled: true });
        return;
      }
      resolve(value);
    };

    if (process.platform === 'win32') {
      const ps = [
        "$ErrorActionPreference='SilentlyContinue'",
        'Get-PnpDevice -Class Bluetooth | Select-Object FriendlyName, InstanceId, Status | ConvertTo-Json -Compress',
      ].join('; ');
      const child = execFile(
        'powershell.exe',
        ['-NoProfile', '-Command', ps],
        { windowsHide: true, timeout: BLUETOOTH_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 },
        (err, stdout) => {
          if (activeBtChild === child) activeBtChild = null;
          if (err) {
            done({
              devices: [],
              error:
                err.killed || err.signal
                  ? 'Busca Bluetooth cancelada ou expirou.'
                  : 'Não foi possível listar Bluetooth no Windows. Use as configurações do sistema para parear.',
            });
            return;
          }
          try {
            const parsed = stdout && stdout.trim() ? JSON.parse(stdout) : [];
            const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
            done({
              devices: arr.map((d) => ({
                name: d.FriendlyName || d.InstanceId || 'Dispositivo',
                address: d.InstanceId || '',
                paired: true,
                connected: String(d.Status || '').toLowerCase() === 'ok',
                available: String(d.Status || '').toLowerCase() === 'ok',
              })),
            });
          } catch {
            done({ devices: [], error: 'Resposta Bluetooth inválida no Windows.' });
          }
        }
      );
      activeBtChild = child;
      return;
    }

    if (process.platform === 'linux') {
      const child = execFile('bluetoothctl', ['devices'], { timeout: BLUETOOTH_TIMEOUT_MS }, (err, stdout) => {
        if (activeBtChild === child) activeBtChild = null;
        if (err) {
          done({
            devices: [],
            error:
              err.killed || err.signal
                ? 'Busca Bluetooth cancelada ou expirou.'
                : 'BlueZ/bluetoothctl indisponível. Pareie pelo sistema; dispositivo pareado ≠ impressora CUPS.',
          });
          return;
        }
        const devices = String(stdout || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const m = line.match(/^Device\s+([0-9A-Fa-f:]+)\s+(.+)$/);
            if (!m) return null;
            return {
              name: m[2],
              address: m[1],
              paired: true,
              connected: false,
              available: true,
            };
          })
          .filter(Boolean);
        done({ devices });
      });
      activeBtChild = child;
      return;
    }

    done({
      devices: [],
      error: 'Bluetooth não suportado nesta plataforma pelo PDV.',
    });
  });
}

function cancelBluetooth() {
  btGeneration += 1;
  if (activeBtChild && !activeBtChild.killed) {
    try {
      activeBtChild.kill();
    } catch {
      /* ignore */
    }
  }
  activeBtChild = null;
  return { ok: true, cancelled: true };
}

async function listPrintersElectron(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { printers: [], error: 'Janela indisponível', source: 'electron' };
  }
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return {
      printers: (printers || []).map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || '',
        status: p.status,
        isDefault: Boolean(p.isDefault),
        source: 'electron',
      })),
      source: 'electron',
    };
  } catch (err) {
    return {
      printers: [],
      error: err.message || 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
      source: 'electron',
    };
  }
}

/** LinuxPrinterAdapter: Electron primeiro, CUPS se vazio/falha/timeout. */
async function listPrintersLinux(mainWindow) {
  const { listCupsPrinters } = require('./cupsLinux.cjs');
  const electronRes = await withTimeout(
    listPrintersElectron(mainWindow),
    PRINTERS_LIST_TIMEOUT_MS,
    {
      printers: [],
      error: 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
      timeout: true,
      source: 'electron',
    }
  );

  if ((electronRes.printers || []).length > 0 && !electronRes.timeout) {
    return { ...electronRes, cups_fallback: false };
  }

  const cupsRes = await withTimeout(
    listCupsPrinters(),
    PRINTERS_LIST_TIMEOUT_MS,
    {
      printers: [],
      error: 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA (CUPS).',
      timeout: true,
      cups: { available: false },
    }
  );

  if ((cupsRes.printers || []).length > 0) {
    return {
      printers: cupsRes.printers,
      source: 'cups',
      cups_fallback: true,
      electron_error: electronRes.error || null,
      cups: cupsRes.cups,
    };
  }

  return {
    printers: [],
    source: cupsRes.cups?.available ? 'cups' : 'none',
    cups_fallback: true,
    error:
      cupsRes.error ||
      electronRes.error ||
      (cupsRes.cups?.error) ||
      'Nenhuma impressora encontrada.',
    hint: cupsRes.hint || cupsRes.cups?.hint || null,
    cups: cupsRes.cups || null,
    electron_error: electronRes.error || null,
  };
}

async function listPrintersWindows(mainWindow) {
  return withTimeout(
    listPrintersElectron(mainWindow),
    PRINTERS_LIST_TIMEOUT_MS,
    {
      printers: [],
      error: 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
      timeout: true,
      source: 'electron',
    }
  );
}

function electronPrint(mainWindow, opts = {}) {
  const deviceName = opts.deviceName || undefined;
  const copies = Math.max(1, Number(opts.copies || 1));
  return new Promise((resolve) => {
    try {
      mainWindow.webContents.print(
        {
          silent: Boolean(deviceName),
          printBackground: true,
          deviceName,
          copies,
          margins: { marginType: 'default' },
        },
        (success, failureReason) => {
          if (!success) {
            resolve({
              ok: false,
              error:
                failureReason ||
                'Impressora indisponível ou impressão cancelada. A venda não é afetada.',
              via: 'electron',
            });
            return;
          }
          resolve({ ok: true, via: 'electron' });
        }
      );
    } catch (err) {
      resolve({
        ok: false,
        error: err.message || 'Falha ao imprimir. A venda não é afetada.',
        via: 'electron',
      });
    }
  });
}

async function testPrintLinux(mainWindow, opts = {}) {
  const { printTestViaCups } = require('./cupsLinux.cjs');
  if (mainWindow && !mainWindow.isDestroyed()) {
    const electronRes = await withTimeout(
      electronPrint(mainWindow, opts),
      PRINT_TEST_TIMEOUT_MS,
      { ok: false, error: 'Timeout na impressão Electron.', timeout: true, via: 'electron' }
    );
    if (electronRes.ok) return electronRes;
  }
  const cupsRes = await withTimeout(
    printTestViaCups({ deviceName: opts.deviceName, title: opts.title }),
    PRINT_TEST_TIMEOUT_MS,
    {
      ok: false,
      error: 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
      timeout: true,
      via: 'cups',
    }
  );
  return cupsRes;
}

function registerPrinterIpc(ipcMain, getMainWindow) {
  ipcMain.handle('printers:list', async () => {
    const mainWindow = getMainWindow();
    try {
      if (process.platform === 'linux') {
        return await listPrintersLinux(mainWindow);
      }
      return await listPrintersWindows(mainWindow);
    } catch (err) {
      return {
        printers: [],
        error: err.message || 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
      };
    }
  });

  ipcMain.handle('printers:print-cupom', async (_evt, opts = {}) => {
    const text = String(opts.text || '').trim();
    if (!text || text.length < 20) {
      return {
        ok: false,
        error: 'IMPRESSÃO CANCELADA\nO cupom não foi gerado corretamente.',
        via: 'guard',
      };
    }
    try {
      const method = opts.method || 'escpos';
      if (method === 'windows') {
        const { printDedicatedHtml } = require('./printHtmlWindow.cjs');
        return await withTimeout(
          printDedicatedHtml(opts.html, {
            deviceName: opts.deviceName,
            copies: opts.copies,
            width: opts.width,
          }),
          PRINT_TEST_TIMEOUT_MS,
          { ok: false, error: 'Timeout na impressão do cupom.', timeout: true, via: 'html-window' }
        );
      }
      const { sendRaw } = require('./rawPrint.cjs');
      const bytes = opts.bytes
        ? Buffer.from(opts.bytes)
        : Buffer.from(text, 'latin1');
      return await withTimeout(
        sendRaw({
          bytes,
          method,
          deviceName: opts.deviceName,
          host: opts.host,
          port: opts.port,
        }),
        PRINT_TEST_TIMEOUT_MS,
        { ok: false, error: 'Timeout no envio RAW.', timeout: true, via: 'raw' }
      );
    } catch (err) {
      return { ok: false, error: err.message || 'Falha ao imprimir cupom. A venda não é afetada.' };
    }
  });

  ipcMain.handle('printers:test', async (_evt, opts = {}) => {
    // NÃO imprime mais a janela principal do PDV (causa da folha em branco).
    // Teste físico só com cupom mínimo explícito.
    const text = String(opts.text || '').trim();
    if (!text || text.length < 20) {
      return {
        ok: false,
        error:
          'Teste recusado: a janela do PDV não é enviada à impressora. Use VISUALIZAR TESTE ou o cupom mínimo.',
        via: 'guard',
      };
    }
    try {
      const { sendRaw } = require('./rawPrint.cjs');
      const bytes = opts.bytes ? Buffer.from(opts.bytes) : null;
      if (!bytes || bytes.length < 20) {
        return {
          ok: false,
          error: 'IMPRESSÃO CANCELADA\nO cupom não foi gerado corretamente.',
          via: 'guard',
        };
      }
      return await withTimeout(
        sendRaw({
          bytes,
          method: opts.method || 'escpos',
          deviceName: opts.deviceName,
          host: opts.host,
          port: opts.port,
        }),
        PRINT_TEST_TIMEOUT_MS,
        { ok: false, error: 'Timeout no teste de impressão.', timeout: true }
      );
    } catch (err) {
      return { ok: false, error: err.message || 'Falha ao imprimir. A venda não é afetada.' };
    }
  });

  ipcMain.handle('bluetooth:list', async () => {
    const gen = btGeneration;
    return withTimeout(listBluetoothDevicesOs(gen), BLUETOOTH_TIMEOUT_MS, {
      devices: [],
      error: 'Busca Bluetooth expirou. Tente novamente.',
      timeout: true,
    });
  });

  ipcMain.handle('bluetooth:scan', async () => {
    const gen = ++btGeneration;
    if (process.platform === 'linux') {
      await withTimeout(
        new Promise((resolve) => {
          const child = execFile(
            'bluetoothctl',
            ['--timeout', '5', 'scan', 'on'],
            { timeout: 10000 },
            () => resolve()
          );
          activeBtChild = child;
        }),
        10000,
        null
      );
    }
    return withTimeout(listBluetoothDevicesOs(gen), BLUETOOTH_TIMEOUT_MS, {
      devices: [],
      error: 'Busca Bluetooth expirou. Tente novamente.',
      timeout: true,
    });
  });

  ipcMain.handle('bluetooth:cancel', async () => cancelBluetooth());

  ipcMain.handle('linux:print-diag', async () => {
    if (process.platform !== 'linux') {
      return { platform: process.platform, note: 'Diagnóstico Linux indisponível nesta plataforma.' };
    }
    const mainWindow = getMainWindow();
    const { linuxPrintDiagnostics } = require('./cupsLinux.cjs');
    const cupsDiag = await withTimeout(linuxPrintDiagnostics(), 12000, {
      platform: 'linux',
      cups: { available: false, error: 'Timeout no diagnóstico CUPS.' },
      printers_count: 0,
      timeout: true,
    });
    let electronPrinters = { ok: false, count: 0, error: null };
    try {
      const er = await withTimeout(listPrintersElectron(mainWindow), 8000, {
        printers: [],
        error: 'timeout',
        timeout: true,
      });
      electronPrinters = {
        ok: !er.error && !er.timeout,
        count: (er.printers || []).length,
        error: er.error || null,
      };
    } catch (e) {
      electronPrinters = { ok: false, count: 0, error: e.message };
    }
    return {
      ...cupsDiag,
      electron_getPrintersAsync: electronPrinters,
      arch: process.arch,
      electron_version: process.versions.electron,
      node_version: process.versions.node,
    };
  });
}

module.exports = { registerPrinterIpc, cancelBluetooth };
