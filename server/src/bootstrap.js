import { getDb } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import {
  ensureDataDir,
  getDbPath,
  getDataDir,
  migrateLegacyDbIfNeeded,
} from './db/paths.js';
import { ensureBootstrapAdmin } from './services/authService.js';
import { setSetting } from './services/settingsService.js';
import { recoverIncompleteOperations } from './services/recoveryService.js';
import { acquireInstanceLock } from './utils/instanceLock.js';
import { logger } from './utils/logger.js';
import { APP_NAME, APP_VERSION } from './version.js';

/** Inicializa diretórios, banco, migrations e bootstrap de admin. */
export function bootstrapRuntime() {
  ensureDataDir();
  let releaseLock = () => {};
  try {
    releaseLock = acquireInstanceLock();
  } catch (err) {
    if (err?.code === 'INSTANCE_ALREADY_RUNNING') {
      logger.error(err.message);
      console.error(`[onca-pdv] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const migrated = migrateLegacyDbIfNeeded();
  if (migrated.migrated) {
    logger.info('DB legado copiado para data dir', migrated);
  }

  getDb();
  ensureBootstrapAdmin();
  setSetting('app_version', APP_VERSION);
  setSetting('app_name', APP_NAME);

  try {
    const recovery = recoverIncompleteOperations();
    if (recovery.recovered) {
      logger.warn('Operações incompletas recuperadas', recovery);
    }
  } catch (err) {
    logger.warn('Falha ao recuperar operações incompletas', { message: err.message });
  }

  // Em desktop/produção nunca semear catálogo demo sem PDV_SEED=1
  const allowSeed = process.env.PDV_SEED === '1';
  if (allowSeed) {
    const result = seedIfEmpty();
    if (result.seeded) {
      logger.info(`seed: ${result.count} produtos inseridos`);
    }
  }

  return {
    appName: APP_NAME,
    version: APP_VERSION,
    dataDir: getDataDir(),
    dbPath: getDbPath(),
    releaseLock,
  };
}
