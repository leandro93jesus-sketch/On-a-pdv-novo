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
let lastDbResolution = null;

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

const {
  findSidecarBackups,
  isSqliteFile,
  validateSidecarBackup,
  copySidecarToPersistent,
  summarizeDbFile,
} = require('./sidecarBackup.cjs');

function persistentDataDir() {
  return path.join(app.getPath('userData'), 'ONCA-PDV');
}

function persistentDbPath() {
  return path.join(persistentDataDir(), 'onca-pdv.db');
}

function countLine(label, counts, key) {
  const v = counts && counts[key] != null ? counts[key] : '—';
  return `${label}: ${v}`;
}

function pickBestSidecar(candidates) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  // Mais recente (já ordenado) — informa que havia vários
  return { ...candidates[0], multiple_found: candidates.length };
}

async function showInvalidSidecarDialog(detail) {
  await dialog.showMessageBox({
    type: 'error',
    title: 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO',
    message: 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO.',
    detail: detail || 'O arquivo ao lado do EXE não passou na validação SQLite/manifesto.',
    buttons: ['OK'],
    noLink: true,
  });
}

/**
 * Fluxo pendrive/instalador:
 * - Detecta onca-pdv-backup-*.db ao lado do EXE / pasta do instalador / sidecar-from-installer
 * - Valida integrity + manifesto
 * - Copia para AppData (nunca usa o arquivo do pendrive em produção)
 * - Nunca sobrescreve banco existente sem confirmação
 */
async function resolveSidecarBackupFlow({ existingDbPath = null } = {}) {
  const nodeBin = nodeBinary();
  const cliScript = path.join(__dirname, 'validateSqliteCli.cjs');
  const candidates = findSidecarBackups({
    execPath: process.execPath,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
    userData: app.getPath('userData'),
  });
  if (!candidates.length) {
    logApi('sidecar: nenhum onca-pdv-backup-*.db ao lado do EXE/instalador');
    return null;
  }

  const best = pickBestSidecar(candidates);
  logApi(`sidecar candidato: ${best.path} (de ${candidates.length})`);

  const validation = validateSidecarBackup(best.path, {
    nodeBinary: nodeBin,
    cliScript,
  });
  if (!validation.ok) {
    logApi(`sidecar inválido: ${validation.message}`);
    await showInvalidSidecarDialog(validation.message);
    return null;
  }

  const targetDir = persistentDataDir();
  const targetDb = persistentDbPath();
  const bakCounts = validation.counts || {};

  // —— Computador JÁ tem banco ——
  if (existingDbPath && fs.existsSync(existingDbPath)) {
    const current = summarizeDbFile(existingDbPath, {
      nodeBinary: nodeBin,
      cliScript,
    });
    const curCounts = current.counts || {};
    const curSales = Number(curCounts.sales || 0);
    const bakSales = Number(bakCounts.sales || 0);
    const newerWarning =
      curSales > bakSales
        ? '\n\nATENÇÃO — ESTE COMPUTADOR POSSUI VENDAS MAIS RECENTES.\nRecomenda-se MANTER BANCO ATUAL.'
        : '';

    const detail = [
      'ESTE COMPUTADOR JÁ POSSUI DADOS.',
      '',
      'BANCO ATUAL:',
      countLine('Produtos', curCounts, 'products'),
      countLine('Clientes', curCounts, 'customers'),
      countLine('Vendas', curCounts, 'sales'),
      `Última venda: ${current.last_sale_at || '—'}`,
      `Arquivo: ${existingDbPath}`,
      '',
      'BACKUP AO LADO DO EXE:',
      `Arquivo: ${validation.filename}`,
      countLine('Produtos', bakCounts, 'products'),
      countLine('Clientes', bakCounts, 'customers'),
      countLine('Vendas', bakCounts, 'sales'),
      `Última venda: ${validation.last_sale_at || '—'}`,
      `Origem: ${best.path}`,
      newerWarning,
      '',
      'Nenhuma restauração automática será feita.',
    ].join('\n');

    const { response } = await dialog.showMessageBox({
      type: curSales > bakSales ? 'warning' : 'question',
      title: 'ESTE COMPUTADOR JÁ POSSUI DADOS',
      message: 'ESTE COMPUTADOR JÁ POSSUI DADOS',
      detail,
      buttons: [
        'MANTER BANCO ATUAL',
        'FAZER BACKUP DO ATUAL E RESTAURAR',
        'CANCELAR',
      ],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });

    if (response === 0 || response === 2) {
      logApi('sidecar: operador manteve banco atual / cancelou');
      return {
        dbPath: existingDbPath,
        dataDir: path.dirname(existingDbPath),
        sidecar_action: response === 0 ? 'keep_current' : 'cancel',
      };
    }

    // Restaurar com PRE-RESTAURACAO
    try {
      const copied = copySidecarToPersistent(best.path, existingDbPath, {
        makePreRestore: true,
      });
      const again = validateSidecarBackup(existingDbPath, {
        nodeBinary: nodeBin,
        cliScript,
      });
      if (!again.ok) {
        throw new Error(again.message || 'Validação pós-cópia falhou');
      }
      logApi(`BANCO COPIADO: ${copied.destination}`);
      logApi(`PRE-RESTAURACAO: ${copied.pre_restore || '(n/a)'}`);
      logApi(`BANCO ABERTO PELA API (previsto): ${existingDbPath}`);
      await dialog.showMessageBox({
        type: 'info',
        title: 'BANCO COPIADO',
        message: 'BANCO COPIADO',
        detail:
          `Origem (pendrive/pasta):\n${best.path}\n\n` +
          `Destino no PC:\n${existingDbPath}\n\n` +
          `Produtos: ${bakCounts.products ?? '—'}\n` +
          `Clientes: ${bakCounts.customers ?? '—'}\n` +
          `Vendas: ${bakCounts.sales ?? '—'}\n\n` +
          'O ONÇA PDV usará a cópia local (pode retirar o pendrive).',
        buttons: ['OK'],
        noLink: true,
      });
      return {
        dbPath: existingDbPath,
        dataDir: path.dirname(existingDbPath),
        sidecar_action: 'restored_over_existing',
        source_backup: best.path,
      };
    } catch (err) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'ONÇA PDV',
        message: 'Falha ao restaurar backup do pendrive',
        detail: err.message || String(err),
        buttons: ['OK'],
      });
      return {
        dbPath: existingDbPath,
        dataDir: path.dirname(existingDbPath),
        sidecar_action: 'restore_failed',
      };
    }
  }

  // —— Computador NOVO (sem banco) ——
  const multiNote =
    best.multiple_found > 1
      ? `\nForam encontrados ${best.multiple_found} backups; usando o mais recente.\n`
      : '';
  const detailNew = [
    `Arquivo: ${validation.filename}`,
    `Data: ${validation.mtime}`,
    `Tamanho: ${validation.size_bytes} bytes`,
    `Versão: ${validation.app_version || '—'}`,
    `Manifesto: ${validation.manifest_present ? 'SIM' : 'NÃO'}`,
    `integrity_check: ${validation.integrity_check}`,
    multiNote,
    countLine('Produtos', bakCounts, 'products'),
    countLine('Clientes', bakCounts, 'customers'),
    countLine('Vendas', bakCounts, 'sales'),
    '',
    'O backup será COPIADO para este computador (não fica no pendrive).',
    `Destino: ${targetDb}`,
  ].join('\n');

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'BACKUP DO ONÇA PDV ENCONTRADO',
    message: 'BACKUP DO ONÇA PDV ENCONTRADO',
    detail: detailNew,
    buttons: ['INSTALAR E CARREGAR ESTE BACKUP', 'INSTALAR SEM BACKUP', 'CANCELAR'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (response === 2) {
    throw new Error('Instalação cancelada pelo operador.');
  }
  if (response === 1) {
    logApi('sidecar: instalar sem backup');
    return { dbPath: null, dataDir: targetDir, sidecar_action: 'skip' };
  }

  try {
    const copied = copySidecarToPersistent(best.path, targetDb, {
      makePreRestore: false,
    });
    const again = validateSidecarBackup(targetDb, {
      nodeBinary: nodeBin,
      cliScript,
    });
    if (!again.ok) {
      throw new Error(again.message || 'Validação pós-cópia falhou');
    }
    logApi(`BANCO COPIADO: ${copied.destination}`);
    logApi(`BANCO ABERTO PELA API (previsto): ${targetDb}`);
    await dialog.showMessageBox({
      type: 'info',
      title: 'BANCO COPIADO',
      message: 'BANCO COPIADO',
      detail:
        `Origem:\n${best.path}\n\nDestino no PC:\n${targetDb}\n\n` +
        `Produtos: ${bakCounts.products ?? '—'}\n` +
        `Clientes: ${bakCounts.customers ?? '—'}\n` +
        `Vendas: ${bakCounts.sales ?? '—'}\n\n` +
        'Pode retirar o pendrive. O ONÇA PDV usará a cópia local.',
      buttons: ['OK'],
      noLink: true,
    });
    return {
      dbPath: targetDb,
      dataDir: targetDir,
      sidecar_action: 'imported_new',
      source_backup: best.path,
    };
  } catch (err) {
    await showInvalidSidecarDialog(err.message || String(err));
    return { dbPath: null, dataDir: targetDir, sidecar_action: 'import_failed' };
  }
}

/** Candidatos a onca-pdv.db fora da pasta do instalador (AppData persistente). */
function listProductionDbCandidates() {
  const userData = app.getPath('userData');
  const appData = process.env.APPDATA || '';
  const list = [
    path.join(userData, 'ONCA-PDV', 'onca-pdv.db'),
    appData ? path.join(appData, 'ONCA-PDV', 'onca-pdv.db') : null,
    appData ? path.join(appData, 'onca-pdv', 'ONCA-PDV', 'onca-pdv.db') : null,
  ].filter(Boolean);
  return [...new Set(list)];
}

function findExistingProductionDbFile() {
  if (process.env.PDV_DB_PATH && fs.existsSync(process.env.PDV_DB_PATH)) {
    return process.env.PDV_DB_PATH;
  }
  const found = [];
  for (const p of listProductionDbCandidates()) {
    try {
      if (fs.existsSync(p)) {
        const st = fs.statSync(p);
        if (st.size > 100) found.push({ path: p, size: st.size, mtime: st.mtimeMs });
      }
    } catch {
      /* ignore */
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.size - a.size || b.mtime - a.mtime);
  return found[0].path;
}

function hasPriorInstallDataMarkers() {
  const dirs = [
    path.join(app.getPath('userData'), 'ONCA-PDV'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'ONCA-PDV') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'onca-pdv', 'ONCA-PDV') : null,
  ].filter(Boolean);
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    if (fs.existsSync(path.join(dir, 'onca-pdv.db'))) return true;
    const backups = path.join(dir, 'backups');
    if (fs.existsSync(backups)) {
      try {
        if (fs.readdirSync(backups).some((f) => /\.db$/i.test(f))) return true;
      } catch {
        /* ignore */
      }
    }
    if (fs.existsSync(path.join(dir, 'configuracoes', 'impressoras.json'))) return true;
  }
  return false;
}

/**
 * Antes de subir a API: garante banco de produção em atualização.
 * NÃO cria banco vazio silenciosamente se parece upgrade.
 * NÃO restaura backup antigo automaticamente.
 * Detecta backup ao lado do EXE/instalador (pendrive) com confirmação.
 */
async function ensureProductionDatabaseReady() {
  const existing = findExistingProductionDbFile();
  if (existing) {
    logApi(`banco produção encontrado: ${existing}`);
    // Se houver backup ao lado do EXE, oferece escolha — sem sobrescrever automático.
    const sidecar = await resolveSidecarBackupFlow({ existingDbPath: existing });
    if (sidecar?.dbPath) {
      return { dbPath: sidecar.dbPath, dataDir: sidecar.dataDir || path.dirname(sidecar.dbPath) };
    }
    return { dbPath: existing, dataDir: path.dirname(existing) };
  }

  // Sem banco atual: oferecer backup ao lado do instalador (confirmação obrigatória).
  const sidecar = await resolveSidecarBackupFlow({ existingDbPath: null });
  if (sidecar?.dbPath) {
    return { dbPath: sidecar.dbPath, dataDir: sidecar.dataDir };
  }
  if (sidecar?.dataDir && sidecar.sidecar_action === 'skip') {
    return { dbPath: null, dataDir: sidecar.dataDir };
  }

  // Instalação nova (sem marcadores) — API pode criar banco vazio.
  if (!app.isPackaged || !hasPriorInstallDataMarkers()) {
    logApi('nenhum banco prévio — instalação nova permitida');
    return { dbPath: null, dataDir: path.join(app.getPath('userData'), 'ONCA-PDV') };
  }

  logApi('ALERTA: marcadores de instalação sem onca-pdv.db');

  while (true) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'BANCO DA VERSÃO ANTERIOR NÃO ENCONTRADO',
      message: 'BANCO DA VERSÃO ANTERIOR NÃO ENCONTRADO',
      detail:
        'NÃO CONTINUE PARA EVITAR PERDA DE DADOS.\n\n' +
        'O ONÇA PDV já foi usado neste computador, mas o arquivo onca-pdv.db não foi localizado nos caminhos padrão.\n\n' +
        'Use LOCALIZAR BANCO para apontar o SQLite atual (o mais recente).\n' +
        'Use LOCALIZAR BACKUP somente se tiver certeza de que é o arquivo correto (não restaura sozinho um backup antigo).',
      buttons: ['LOCALIZAR BANCO', 'LOCALIZAR BACKUP', 'CANCELAR ATUALIZAÇÃO'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });

    if (response === 2) {
      throw new Error('Atualização cancelada: banco da versão anterior não encontrado.');
    }

    const picked = await dialog.showOpenDialog({
      title: response === 0 ? 'Localizar onca-pdv.db' : 'Localizar backup .db',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite ONÇA PDV', extensions: ['db', 'sqlite'] },
        { name: 'Todos', extensions: ['*'] },
      ],
    });
    if (picked.canceled || !picked.filePaths?.[0]) continue;

    const selected = picked.filePaths[0];
    try {
      const st = fs.statSync(selected);
      if (st.size < 100) throw new Error('Arquivo muito pequeno');
      const fd = fs.openSync(selected, 'r');
      const buf = Buffer.alloc(16);
      fs.readSync(fd, buf, 0, 16, 0);
      fs.closeSync(fd);
      if (!buf.toString('utf8').startsWith('SQLite format 3')) {
        throw new Error('Arquivo não é SQLite válido');
      }
    } catch (err) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'ONÇA PDV',
        message: 'Arquivo inválido',
        detail: err.message || String(err),
        buttons: ['OK'],
      });
      continue;
    }

    if (response === 0) {
      // Usar o banco no local atual — NÃO mover.
      logApi(`operador localizou banco: ${selected}`);
      return { dbPath: selected, dataDir: path.dirname(selected) };
    }

    // Backup: copiar para o data dir padrão SOMENTE com confirmação explícita.
    const targetDir = path.join(app.getPath('userData'), 'ONCA-PDV');
    const targetDb = path.join(targetDir, 'onca-pdv.db');
    const { response: confirm } = await dialog.showMessageBox({
      type: 'question',
      title: 'Confirmar uso do backup',
      message: 'Usar este backup como banco ativo?',
      detail:
        `Origem:\n${selected}\n\nDestino:\n${targetDb}\n\n` +
        'Isso NÃO acontece automaticamente. Confirme apenas se este for o backup correto e mais recente.',
      buttons: ['CONFIRMAR CÓPIA', 'VOLTAR'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (confirm !== 0) continue;
    fs.mkdirSync(targetDir, { recursive: true });
    if (fs.existsSync(targetDb)) {
      const safety = path.join(
        targetDir,
        'backups',
        `ONCA-PDV-PRE-RESTORE-${Date.now()}.db`
      );
      fs.mkdirSync(path.dirname(safety), { recursive: true });
      fs.copyFileSync(targetDb, safety);
    }
    fs.copyFileSync(selected, targetDb);
    logApi(`backup copiado manualmente para ${targetDb}`);
    return { dbPath: targetDb, dataDir: targetDir };
  }
}

function startApiServer(port, dbResolution = {}) {
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
  if (dbResolution.dbPath) logApi(`PDV_DB_PATH=${dbResolution.dbPath}`);
  if (dbResolution.dataDir) logApi(`PDV_DATA_DIR=${dbResolution.dataDir}`);

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
  if (dbResolution.dataDir) env.PDV_DATA_DIR = dbResolution.dataDir;
  if (dbResolution.dbPath) env.PDV_DB_PATH = dbResolution.dbPath;
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
    if (!shuttingDown && code === 78) {
      dialog
        .showMessageBox({
          type: 'error',
          title: 'BANCO DA VERSÃO ANTERIOR NÃO ENCONTRADO',
          message: 'BANCO DA VERSÃO ANTERIOR NÃO ENCONTRADO',
          detail:
            'NÃO CONTINUE PARA EVITAR PERDA DE DADOS.\n\n' +
            'A API local recusou criar um banco vazio porque há sinais de instalação anterior.\n' +
            `Log: ${apiLogPath()}`,
          buttons: ['LOCALIZAR BANCO…', 'FECHAR'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        })
        .then(async (r) => {
          if (r.response === 0) {
            try {
              const resolved = await ensureProductionDatabaseReady();
              lastDbResolution = resolved;
              void boot();
            } catch (e) {
              logApi(`relocate-failed: ${e.message}`);
            }
          }
        });
      return;
    }
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
const { registerFilesIpc } = require('./filesIpc.cjs');

function registerPrinterIpc() {
  registerPrinterIpcHandlers(ipcMain, () => mainWindow);
  registerFilesIpc(ipcMain, () => mainWindow);
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
        message: 'Localizando banco de dados de produção…',
        showActions: false,
      });
      lastDbResolution = await ensureProductionDatabaseReady();
      updateSplash({
        api: { text: 'INICIANDO…', kind: 'busy' },
        health: { text: 'AGUARDANDO…', kind: 'busy' },
        message: `Iniciando API local na porta ${port}…`,
        showActions: false,
      });
      startApiServer(port, lastDbResolution || {});
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
