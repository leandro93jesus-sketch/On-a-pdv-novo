/**
 * Imprime HTML isolado (só o cupom). Nunca a janela principal do PDV.
 */
const { BrowserWindow } = require('electron');

function pageSizeFor(width) {
  if (width === '58mm') return { width: 58000, height: 297000 };
  if (width === '80mm') return { width: 80000, height: 297000 };
  return undefined;
}

function printDedicatedHtml(html, opts = {}) {
  if (!html || String(html).replace(/<[^>]+>/g, '').trim().length < 20) {
    return Promise.resolve({
      ok: false,
      error: 'IMPRESSÃO CANCELADA\nO cupom não foi gerado corretamente.',
      via: 'html-window',
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        if (win && !win.isDestroyed()) win.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    const win = new BrowserWindow({
      show: false,
      width: 420,
      height: 720,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    const timer = setTimeout(() => {
      finish({ ok: false, error: 'Timeout ao renderizar o cupom.', via: 'html-window' });
    }, 15000);
    win.webContents.once('did-fail-load', () => {
      clearTimeout(timer);
      finish({ ok: false, error: 'Falha ao carregar o cupom.', via: 'html-window' });
    });
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        try {
          win.webContents.print(
            {
              silent: Boolean(opts.deviceName),
              printBackground: false,
              deviceName: opts.deviceName || undefined,
              copies: Math.max(1, Number(opts.copies || 1)),
              margins: { marginType: 'none' },
              ...(pageSizeFor(opts.width) ? { pageSize: pageSizeFor(opts.width) } : {}),
            },
            (success, failureReason) => {
              clearTimeout(timer);
              if (!success) {
                finish({
                  ok: false,
                  error: failureReason || 'Impressão cancelada ou impressora indisponível.',
                  via: 'html-window',
                });
                return;
              }
              finish({ ok: true, via: 'html-window' });
            }
          );
        } catch (err) {
          clearTimeout(timer);
          finish({ ok: false, error: err.message || 'Falha ao imprimir cupom.', via: 'html-window' });
        }
      }, 300);
    });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

module.exports = { printDedicatedHtml };
