/**
 * ONÇA PDV — processo principal Electron.
 * Sobe a API Node local (SQLite) e abre a UI sem terminal.
 *
 * Runtime da API:
 * - Empacotado: Node embutido em resources/node (não usa ABI do Electron)
 * - Dev: Node do PATH / process.env.PDV_NODE_PATH
 */
const { app, BrowserWindow, dialog, shell, Menu } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const DEFAULT_PORT = 3847;
let mainWindow = null;
let serverProcess = null;
let shuttingDown = false;

function resolvePort() {
  const n = Number(process.env.PORT || DEFAULT_PORT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
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
  }
  return process.env.npm_node_execpath || 'node';
}

function waitForHealth(port, timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`API local não respondeu em ${timeoutMs}ms (porta ${port}).`));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else setTimeout(tick, 250);
      });
      req.on('error', () => setTimeout(tick, 250));
      req.setTimeout(1500, () => {
        req.destroy();
        setTimeout(tick, 250);
      });
    };
    tick();
  });
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

  serverProcess.stdout?.on('data', (buf) => {
    process.stdout.write(`[api] ${buf}`);
  });
  serverProcess.stderr?.on('data', (buf) => {
    process.stderr.write(`[api] ${buf}`);
  });
  serverProcess.on('exit', (code, signal) => {
    serverProcess = null;
    if (!shuttingDown && code !== 0) {
      dialog.showErrorBox(
        'ONÇA PDV',
        `O serviço interno encerrou inesperadamente (código ${code ?? signal}).\nReinicie o aplicativo.`
      );
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

async function boot() {
  const port = resolvePort();
  try {
    startApiServer(port);
    await waitForHealth(port);
    buildMenu();
    await createWindow(port);
  } catch (err) {
    dialog.showErrorBox(
      'ONÇA PDV — falha na inicialização',
      `${err.message}\n\nVerifique permissões da pasta de dados do usuário e espaço em disco.`
    );
    app.quit();
  }
}

function stopApiServer() {
  shuttingDown = true;
  if (!serverProcess) return;
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => void boot());

  app.on('before-quit', () => {
    stopApiServer();
  });

  app.on('window-all-closed', () => {
    stopApiServer();
    app.quit();
  });
}
