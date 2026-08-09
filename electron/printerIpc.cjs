/**
 * IPC de impressoras/Bluetooth com timeout e cancelamento.
 * Nunca deve deixar o renderer esperando indefinidamente.
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
                : 'BlueZ/bluetoothctl indisponível. Pareie pelo sistema e atualize a lista de impressoras.',
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

function registerPrinterIpc(ipcMain, getMainWindow) {
  ipcMain.handle('printers:list', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { printers: [], error: 'Janela indisponível' };
    }
    try {
      const result = await withTimeout(
        (async () => {
          try {
            const printers = await mainWindow.webContents.getPrintersAsync();
            return {
              printers: (printers || []).map((p) => ({
                name: p.name,
                displayName: p.displayName || p.name,
                description: p.description || '',
                status: p.status,
                isDefault: Boolean(p.isDefault),
              })),
            };
          } catch (err) {
            return {
              printers: [],
              error: err.message || 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
            };
          }
        })(),
        PRINTERS_LIST_TIMEOUT_MS,
        {
          printers: [],
          error: 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
          timeout: true,
        }
      );
      return result;
    } catch (err) {
      return {
        printers: [],
        error: err.message || 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
      };
    }
  });

  ipcMain.handle('printers:test', async (_evt, opts = {}) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: 'Janela indisponível' };
    }
    const deviceName = opts.deviceName || undefined;
    const copies = Math.max(1, Number(opts.copies || 1));

    const printPromise = new Promise((resolve) => {
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
              });
              return;
            }
            resolve({ ok: true });
          }
        );
      } catch (err) {
        resolve({
          ok: false,
          error: err.message || 'Falha ao imprimir. A venda não é afetada.',
        });
      }
    });

    return withTimeout(printPromise, PRINT_TEST_TIMEOUT_MS, {
      ok: false,
      error: 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
      timeout: true,
    });
  });

  ipcMain.handle('bluetooth:list', async () => {
    const gen = btGeneration;
    return withTimeout(listBluetoothDevicesOs(gen), BLUETOOTH_TIMEOUT_MS, {
      devices: [],
      error: 'NÃO FOI POSSÍVEL CONSULTAR A IMPRESSORA.',
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
}

module.exports = { registerPrinterIpc, cancelBluetooth };
