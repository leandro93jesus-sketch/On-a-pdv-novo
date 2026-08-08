import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Diretório de dados local (preparado para %APPDATA% no Windows no futuro). */
export function getDataDir() {
  if (process.env.PDV_DATA_DIR) return process.env.PDV_DATA_DIR;
  return join(__dirname, '../../data');
}

export function getDbPath() {
  if (process.env.PDV_DB_PATH) return process.env.PDV_DB_PATH;
  return join(getDataDir(), 'onca-pdv.db');
}

export function ensureDataDir() {
  mkdirSync(dirname(getDbPath()), { recursive: true });
}
