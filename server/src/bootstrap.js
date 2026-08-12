import { getDb } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import {
  ensureDataDir,
  getDbPath,
  getDataDir,
  migrateLegacyDbIfNeeded,
  findExistingProductionDb,
} from './db/paths.js';
import { prepareDatabaseForOpen, writePostOpenCounts } from './db/safeUpdate.js';
import { ensureBootstrapAdmin } from './services/authService.js';
import { setSetting } from './services/settingsService.js';
import { recoverIncompleteOperations } from './services/recoveryService.js';
import { acquireInstanceLock } from './utils/instanceLock.js';
import { logger } from './utils/logger.js';
import { APP_NAME, APP_VERSION } from './version.js';

/** Inicializa diretórios, banco, migrations e bootstrap de admin. */
export function bootstrapRuntime() {
  // Preferir banco de produção já existente (não mover; não criar vazio por engano).
  const existing = findExistingProductionDb();
  if (existing) {
    logger.info('Banco de produção localizado', {
      path: existing.path,
      size: existing.size,
    });
  }

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

  let safeUpdate;
  try {
    safeUpdate = prepareDatabaseForOpen();
  } catch (err) {
    if (err?.code === 'DB_NOT_FOUND_ON_UPGRADE' || err?.code === 'DB_CORRUPT') {
      logger.error(err.message, err.details || {});
      console.error(`[onca-pdv] ${err.message}`);
      if (err.details) {
        console.error('[onca-pdv] detalhes:', JSON.stringify(err.details));
      }
      // Código distinto para o Electron oferecer "Localizar banco"
      process.exit(78);
    }
    throw err;
  }

  getDb();
  ensureBootstrapAdmin();
  setSetting('app_version', APP_VERSION);
  setSetting('app_name', APP_NAME);

  const countsAfter = writePostOpenCounts(safeUpdate);

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
    safeUpdate,
    countsAfter,
  };
}
