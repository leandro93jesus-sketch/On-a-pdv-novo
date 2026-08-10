/**
 * ONÇA PDV — processo principal Electron.
 * Sobe a API Node local (SQLite) e abre a UI sem terminal.
 *
 * Runtime da API:
 * - Empacotado: Node embutido em resources/node (não usa ABI do Electron)
 * - Dev: Node do PATH / process.env.PDV_NODE_PATH
 *
 * NÃO depende de Node/npm instalados no PC do usuário.
 */
const { app, BrowserWindow, dialog, shell, Menu, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Linux: AppImage/pacotes sem chrome-sandbox setuid travam ou recusam iniciar.
 * Aplica somente em Linux — Windows permanece inalterado.
 */
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

const DEFAULT_PORT = 3847;
const HEALTH_PATH = '/api/health';
const USER_FRIENDLY_API_ERROR =
  'Não foi possível iniciar o serviço local do ONÇA PDV.';

let mainWindow = null;
let splashWindow = null;
let serverProcess = null;
let shuttingDown = false;
let apiLogStream = null;
let lastBootError = null;
let bootInProgress = false;

function resolvePort() {
  const n = Number(process.env.PORT || DEFAULT_PORT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

function logsDir() {
  return path.join(app.getPath('userData'), 'ONCA-PDV', 'logs');
}

function apiLogPath() {
  return path.join(logsDir(), 'api-local.log');
}

function ensureLogsDir() {
  fs.mkdirSync(logsDir(), { recursive: true });
}

function openApiLog() {
  ensureLogsDir();
  if (apiLogStream) return apiLogStream;
  apiLogStream = fs.createWriteStream(apiLogPath(), { flags: 'a' });
  return apiLogStream;
}

function logApi(line) {
  const stamp = new Date().toISOString();
  const text = `[${stamp}] ${line}`;
  try {
    openApiLog().write(`${text}\n`);
  } catch {
    /* ignore */
  }
  try {
    process.stdout.write(`${text}\n`);
  } catch {
    /* ignore */
  }
}

function serverEntry() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app-server', 'src', 'index.js');
  }
  return path.join(__dirname, '..', 'server', 'src', 'index.js');
}

function webDistPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web-dist');
  }
  return path.join(__dirname, '..', 'web', 'dist');
}

function nodeBinary() {
  if (process.env.PDV_NODE_PATH && fs.existsSync(process.env.PDV_NODE_PATH)) {
    return process.env.PDV_NODE_PATH;
  }
  if (app.isPackaged) {
    const name = process.platform === 'win32' ? 'node.exe' : 'node';
    const bundled = path.join(process.resourcesPath, 'node', name);
    if (fs.existsSync(bundled)) return bundled;
    const wrong =
      process.platform === 'win32'
        ? path.join(process.resourcesPath, 'node', 'node')
        : path.join(process.resourcesPath, 'node', 'node.exe');
    if (fs.existsSync(wrong)) {
      throw new Error(
        `Runtime Node incorreto no pacote (${path.basename(wrong)}). ` +
          `Reinstale a versão correta do ONÇA PDV para ${process.platform}.`
      );
    }
    throw new Error(
      `Node embutido não encontrado em ${bundled}. ` +
        'O instalador está incompleto — reinstale o ONÇA PDV.'
    );
  }
  return process.env.npm_node_execpath || 'node';
}

function fetchHealth(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}${HEALTH_PATH}`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ status: 'ok', raw: true });
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function isOurHealth(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.status !== 'ok') return false;
  if (payload.service === 'onca-pdv-server') return true;
  if (payload.name === 'ONÇA PDV') return true;
  return false;
}

function portInUseError(err) {
  return err && (err.code === 'EADDRINUSE' || /EADDRINUSE/i.test(String(err.message || err)));
}

async function findFreePort(preferred, maxTries = 20) {
  const net = require('node:net');
  for (let i = 0; i < maxTries; i += 1) {
    const port = preferred + i;
    // Prefer reuse of our own healthy API
    const health = await fetchHealth(port);
    if (isOurHealth(health)) return { port, reused: true, health };
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });
    if (free) return { port, reused: false, health: null };
  }
  throw new Error(`Nenhuma porta livre a partir de ${preferred}.`);
}

function waitForHealth(port, timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`API local não respondeu em ${timeoutMs}ms (porta ${port}).`));
        return;
      }
      if (serverProcess && serverProcess.exitCode != null && serverProcess.exitCode !== 0) {
        reject(
          new Error(
            `Processo da API encerrou antes do health-check (código ${serverProcess.exitCode}).`
          )
        );
        return;
      }
      const payload = await fetchHealth(port);
      if (isOurHealth(payload)) {
        resolve(payload);
        return;
      }
      setTimeout(tick, 250);
    };
    void tick();
  });
}

function updateSplash(payload) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const js = `window.__oncaSplashUpdate && window.__oncaSplashUpdate(${JSON.stringify(payload)})`;
  splashWindow.webContents.executeJavaScript(js).catch(() => {});
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 560,
    height: 360,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    title: 'ONÇA PDV',
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'splash-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  splashWindow.setMenuBarVisibility(false);
  splashWindow.on('closed', () => {
    splashWindow = null;
  });
  return splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

function startApiServer(port) {
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`Servidor não encontrado: ${entry}`);
  }

  const nodePath = nodeBinary();
  const cwd = app.isPackaged
    ? path.join(process.resourcesPath, 'app-server')
    : path.join(__dirname, '..');

  logApi(`startApi path=${entry}`);
  logApi(`nodeBinary=${nodePath}`);
  logApi(`cwd=${cwd}`);
  logApi(`port=${port}`);
  logApi(`resourcesPath=${process.resourcesPath || '(dev)'}`);
  logApi(`userData=${app.getPath('userData')}`);
  logApi(`packaged=${app.isPackaged}`);

  if (app.isPackaged && !fs.existsSync(nodePath)) {
    throw new Error(`Node embutido ausente: ${nodePath}`);
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    PDV_ELECTRON_USER_DATA: app.getPath('userData'),
    PDV_WEB_DIST: webDistPath(),
    PDV_LOG_CONSOLE: '1',
    PDV_SEED: '0',
  };
  // Evita que o filho herde ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RUN_AS_NODE;

  serverProcess = spawn(nodePath, [entry], {
    env,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  logApi(`spawn pid=${serverProcess.pid || '?'}`);

  serverProcess.stdout?.on('data', (buf) => {
    const text = String(buf).trimEnd();
    if (text) logApi(`[stdout] ${text}`);
  });
  serverProcess.stderr?.on('data', (buf) => {
    const text = String(buf).trimEnd();
    if (text) logApi(`[stderr] ${text}`);
  });
  serverProcess.on('error', (err) => {
    logApi(`[spawn-error] ${err.message}`);
    lastBootError = err;
  });
  serverProcess.on('exit', (code, signal) => {
    logApi(`exit code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    serverProcess = null;
    if (!shuttingDown && code !== 0 && mainWindow) {
      dialog.showMessageBox({
        type: 'error',
        title: 'ONÇA PDV',
        message: USER_FRIENDLY_API_ERROR,
        detail: `O serviço interno encerrou inesperadamente.\nCódigo: ${code ?? signal}\nLog: ${apiLogPath()}`,
        buttons: ['OK'],
      });
    }
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: 'ONÇA PDV',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function buildMenu() {
  const template = [
    {
      label: 'ONÇA PDV',
      submenu: [
        { role: 'about', label: 'Sobre' },
        { type: 'separator' },
        {
          label: 'Abrir diagnóstico da API…',
          click: () => openDiagnostics(),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Zoom padrão' },
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const { registerPrinterIpc: registerPrinterIpcHandlers } = require('./printerIpc.cjs');

function registerPrinterIpc() {
  registerPrinterIpcHandlers(ipcMain, () => mainWindow);
}

function openDiagnostics() {
  ensureLogsDir();
  const logFile = apiLogPath();
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(
      logFile,
      `[${new Date().toISOString()}] diagnóstico aberto — sem eventos anteriores\n`,
      'utf8'
    );
  }
  shell.showItemInFolder(logFile);
  dialog.showMessageBox({
    type: 'info',
    title: 'Diagnóstico — API LOCAL',
    message: 'Arquivo de log da API local',
    detail:
      `${logFile}\n\n` +
      (lastBootError ? `Último erro: ${lastBootError.message}\n\n` : '') +
      'Envie este arquivo ao suporte se o problema continuar.',
    buttons: ['OK'],
  });
}

async function boot() {
  if (bootInProgress) return;
  bootInProgress = true;
  lastBootError = null;
  ensureLogsDir();
  logApi('==== boot start ====');

  try {
    if (!splashWindow || splashWindow.isDestroyed()) {
      await createSplashWindow();
    }
    updateSplash({
      api: { text: 'INICIANDO…', kind: 'busy' },
      health: { text: 'AGUARDANDO…', kind: 'busy' },
      message: 'Preparando serviço local. Aguarde alguns segundos.',
      showActions: false,
    });

    const preferred = resolvePort();
    const selected = await findFreePort(preferred);
    const port = selected.port;
    logApi(`porta escolhida=${port} reused=${selected.reused}`);

    if (selected.reused) {
      updateSplash({
        api: { text: 'OK (já ativa)', kind: 'ok' },
        health: { text: 'OK', kind: 'ok' },
        message: `Reutilizando API local na porta ${port}.`,
        showActions: false,
      });
    } else {
      updateSplash({
        api: { text: 'INICIANDO…', kind: 'busy' },
        health: { text: 'AGUARDANDO…', kind: 'busy' },
        message: `Iniciando API local na porta ${port}…`,
        showActions: false,
      });
      startApiServer(port);
      updateSplash({
        api: { text: 'INICIANDO…', kind: 'busy' },
        health: { text: 'VERIFICANDO…', kind: 'busy' },
        message: 'Health-check em andamento…',
        showActions: false,
      });
      await waitForHealth(port);
      updateSplash({
        api: { text: 'OK', kind: 'ok' },
        health: { text: 'OK', kind: 'ok' },
        message: 'API LOCAL OK. Abrindo o ONÇA PDV…',
        showActions: false,
      });
    }

    registerPrinterIpc();
    buildMenu();
    await createWindow(port);
    closeSplash();
    logApi('==== boot ok ====');
  } catch (err) {
    lastBootError = err;
    logApi(`boot-error: ${err && err.message ? err.message : String(err)}`);
    if (portInUseError(err)) {
      logApi('detalhe: conflito de porta');
    }
    updateSplash({
      api: { text: 'FALHA', kind: 'err' },
      health: { text: 'FALHA', kind: 'err' },
      message: `${USER_FRIENDLY_API_ERROR}\n\nLog: ${apiLogPath()}`,
      showActions: true,
    });
    // Mantém splash aberto para TENTAR NOVAMENTE / DIAGNÓSTICO
  } finally {
    bootInProgress = false;
  }
}

function stopApiServer() {
  shuttingDown = true;
  if (!serverProcess) return;
  const pid = serverProcess.pid;
  logApi(`stopApi pid=${pid || '?'}`);
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t'], { windowsHide: true });
    } else {
      serverProcess.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
  serverProcess = null;
}

function registerSplashIpc() {
  ipcMain.removeAllListeners('splash:retry');
  ipcMain.removeAllListeners('splash:open-diagnostics');
  ipcMain.on('splash:retry', () => {
    logApi('splash:retry');
    if (serverProcess) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t'], {
            windowsHide: true,
          });
        } else {
          serverProcess.kill('SIGTERM');
        }
      } catch {
        /* ignore */
      }
      serverProcess = null;
    }
    void boot();
  });
  ipcMain.on('splash:open-diagnostics', () => openDiagnostics());
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.whenReady().then(async () => {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'ONÇA PDV',
      message: 'ONÇA PDV já está em execução.',
      detail: 'Não é permitido abrir duas instâncias no mesmo computador usando o mesmo banco.',
      buttons: ['OK'],
    });
    app.quit();
  });
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerSplashIpc();
    void boot();
  });

  app.on('before-quit', () => {
    stopApiServer();
    try {
      apiLogStream?.end();
    } catch {
      /* ignore */
    }
  });

  app.on('window-all-closed', () => {
    stopApiServer();
    app.quit();
  });
}
