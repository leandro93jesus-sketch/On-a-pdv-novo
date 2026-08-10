import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Diretório de dados do aplicativo.
 * Prioridade:
 * 1) PDV_DATA_DIR (env)
 * 2) Electron userData → ONCA-PDV (PDV_ELECTRON_USER_DATA)
 * 3) Windows: %APPDATA%/ONCA-PDV
 * 4) Dev (NODE_ENV !== production): server/data
 * 5) Linux/macOS produção: ~/.local/share/ONCA-PDV
 */
export function getDataDir() {
  if (process.env.PDV_DATA_DIR) return process.env.PDV_DATA_DIR;

  if (process.env.PDV_ELECTRON_USER_DATA) {
    return join(process.env.PDV_ELECTRON_USER_DATA, 'ONCA-PDV');
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'ONCA-PDV');
  }

  if (process.env.PDV_DEV_DATA === '1' || process.env.NODE_ENV !== 'production') {
    return join(__dirname, '../../data');
  }

  return join(homedir(), '.local', 'share', 'ONCA-PDV');
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

export function ensureDataDir() {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(getBackupsDir(), { recursive: true });
  mkdirSync(getLogsDir(), { recursive: true });
  mkdirSync(getAssetsDir(), { recursive: true });
  mkdirSync(getConfigDir(), { recursive: true });
  mkdirSync(dirname(getDbPath()), { recursive: true });
  return dataDir;
}

/** Copia DB legado de server/data se o destino ainda não existir. */
export function migrateLegacyDbIfNeeded() {
  const target = getDbPath();
  if (existsSync(target)) return { migrated: false, path: target };
  const legacy = join(__dirname, '../../data/onca-pdv.db');
  if (existsSync(legacy) && legacy !== target) {
    ensureDataDir();
    copyFileSync(legacy, target);
    return { migrated: true, from: legacy, path: target };
  }
  return { migrated: false, path: target };
}
