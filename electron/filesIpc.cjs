/**
 * IPC para salvar arquivos com diálogo nativo do SO (Salvar como…).
 * Não sobrescreve silenciosamente — o diálogo do sistema pergunta.
 */
const { dialog, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');

function getParentWindow(getMainWindow) {
  try {
    const w = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (w && !w.isDestroyed()) return w;
  } catch {
    /* ignore */
  }
  const focused = BrowserWindow.getFocusedWindow();
  return focused && !focused.isDestroyed() ? focused : null;
}

async function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    const chunks = [];
    request.on('response', (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

function registerFilesIpc(ipcMain, getMainWindow) {
  ipcMain.handle('files:save-pdf', async (_event, opts = {}) => {
    const parent = getParentWindow(getMainWindow);
    const defaultPath = opts.defaultPath || opts.suggestedName || 'ONCA-DOCUMENTO.pdf';
    const filters = opts.filters || [{ name: 'PDF', extensions: ['pdf'] }];

    const result = await dialog.showSaveDialog(parent || undefined, {
      title: opts.title || 'Salvar PDF',
      defaultPath,
      filters,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    let buffer = null;
    if (opts.base64) {
      buffer = Buffer.from(String(opts.base64), 'base64');
    } else if (opts.absolutePath && fs.existsSync(opts.absolutePath)) {
      buffer = fs.readFileSync(opts.absolutePath);
    } else if (opts.url) {
      buffer = await fetchBinary(String(opts.url));
    } else {
      return { ok: false, error: 'Nenhum conteúdo PDF informado.' };
    }

    const target = result.filePath.endsWith('.pdf') ? result.filePath : `${result.filePath}.pdf`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
    return { ok: true, filePath: target, canceled: false };
  });
}

module.exports = { registerFilesIpc };
