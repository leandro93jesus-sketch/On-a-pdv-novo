import { mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Diretório de dados resolvido (pode ser pinado ao local do banco existente). */
let pinnedDataDir = null;

/**
 * Candidatos a diretório de dados (produção Windows/Linux/Electron).
 * O banco NÃO fica na pasta do instalador/resources/asar.
 */
export function listDataDirCandidates() {
  const out = [];
  const add = (p) => {
    if (p && !out.includes(p)) out.push(p);
  };

  if (process.env.PDV_DATA_DIR) add(process.env.PDV_DATA_DIR);

  if (process.env.PDV_ELECTRON_USER_DATA) {
    add(join(process.env.PDV_ELECTRON_USER_DATA, 'ONCA-PDV'));
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    // Legado / documentação antiga
    add(join(appData, 'ONCA-PDV'));
    // Electron típico: %APPDATA%\onca-pdv\ONCA-PDV
    add(join(appData, 'onca-pdv', 'ONCA-PDV'));
  }

  if (process.env.PDV_DEV_DATA === '1' || process.env.NODE_ENV !== 'production') {
    add(join(__dirname, '../../data'));
  }

  add(join(homedir(), '.config', 'onca-pdv', 'ONCA-PDV'));
  add(join(homedir(), '.local', 'share', 'ONCA-PDV'));

  return out;
}

/**
 * Localiza o banco de produção já existente (o mais completo/recente).
 * NÃO move o arquivo — apenas aponta para ele.
 */
export function findExistingProductionDb() {
  if (process.env.PDV_DB_PATH && existsSync(process.env.PDV_DB_PATH)) {
    return {
      path: process.env.PDV_DB_PATH,
      dataDir: dirname(process.env.PDV_DB_PATH),
      size: statSync(process.env.PDV_DB_PATH).size,
      mtime: statSync(process.env.PDV_DB_PATH).mtimeMs,
    };
  }

  const found = [];
  for (const dir of listDataDirCandidates()) {
    const p = join(dir, 'onca-pdv.db');
    if (!existsSync(p)) continue;
    try {
      const st = statSync(p);
      if (st.size > 100) {
        found.push({ path: p, dataDir: dir, size: st.size, mtime: st.mtimeMs });
      }
    } catch {
      /* ignore */
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => b.size - a.size || b.mtime - a.mtime);
  return found[0];
}

export function pinDataDir(dir) {
  if (dir) pinnedDataDir = dir;
}

/**
 * Diretório de dados do aplicativo.
 * Prioridade:
 * 1) PDV_DATA_DIR (env)
 * 2) Diretório onde onca-pdv.db JÁ existe (preserva produção)
 * 3) Electron userData → ONCA-PDV
 * 4) Windows: %APPDATA%/ONCA-PDV
 * 5) Dev: server/data
 * 6) Linux/macOS: ~/.local/share/ONCA-PDV
 */
export function getDataDir() {
  if (pinnedDataDir) return pinnedDataDir;
  if (process.env.PDV_DATA_DIR) {
    pinnedDataDir = process.env.PDV_DATA_DIR;
    return pinnedDataDir;
  }

  const existing = findExistingProductionDb();
  if (existing?.dataDir) {
    pinnedDataDir = existing.dataDir;
    return pinnedDataDir;
  }

  if (process.env.PDV_ELECTRON_USER_DATA) {
    pinnedDataDir = join(process.env.PDV_ELECTRON_USER_DATA, 'ONCA-PDV');
    return pinnedDataDir;
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    pinnedDataDir = join(appData, 'ONCA-PDV');
    return pinnedDataDir;
  }

  if (process.env.PDV_DEV_DATA === '1' || process.env.NODE_ENV !== 'production') {
    pinnedDataDir = join(__dirname, '../../data');
    return pinnedDataDir;
  }

  pinnedDataDir = join(homedir(), '.local', 'share', 'ONCA-PDV');
  return pinnedDataDir;
}

export function getDbPath() {
  if (process.env.PDV_DB_PATH) return process.env.PDV_DB_PATH;
  return join(getDataDir(), 'onca-pdv.db');
}

export function getBackupsDir() {
  return join(getDataDir(), 'backups');
}

export function getLogsDir() {
  return join(getDataDir(), 'logs');
}

/** Pasta persistente de assets do usuário (logo etc.) — fora da instalação. */
export function getAssetsDir() {
  return join(getDataDir(), 'assets');
}

export function getConfigDir() {
  return join(getDataDir(), 'configuracoes');
}

/** Pasta de comprovantes PDF (relativa ao data dir portátil). */
export function getReceiptsDir() {
  return join(getDataDir(), 'comprovantes');
}

export function ensureDataDir() {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(getBackupsDir(), { recursive: true });
  mkdirSync(getLogsDir(), { recursive: true });
  mkdirSync(getAssetsDir(), { recursive: true });
  mkdirSync(getConfigDir(), { recursive: true });
  mkdirSync(getReceiptsDir(), { recursive: true });
  mkdirSync(dirname(getDbPath()), { recursive: true });
  return dataDir;
}

/**
 * Copia DB legado de server/data se o destino ainda não existir.
 * Em desktop/produção NÃO copia — evita banco de exemplo do pacote.
 */
export function migrateLegacyDbIfNeeded() {
  const target = getDbPath();
  if (existsSync(target)) return { migrated: false, path: target };

  if (process.env.PDV_ELECTRON_USER_DATA || process.env.PDV_DISABLE_LEGACY_DB_COPY === '1') {
    return { migrated: false, path: target, skipped: 'desktop-or-disabled' };
  }

  const legacy = join(__dirname, '../../data/onca-pdv.db');
  if (existsSync(legacy) && legacy !== target) {
    ensureDataDir();
    copyFileSync(legacy, target);
    return { migrated: true, from: legacy, path: target };
  }
  return { migrated: false, path: target };
}
