/**
 * Atualização segura do banco em produção.
 * - Nunca restaura backup antigo automaticamente.
 * - Antes de migrations: backup ONCA-PDV-PRE-ATUALIZACAO-* + integrity_check.
 * - Em upgrade desktop, não cria banco vazio silenciosamente.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { getBackupsDir, getDataDir, getDbPath, listDataDirCandidates } from './paths.js';
import { getAppliedMigrations, listMigrationFiles } from './migrate.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { APP_VERSION } from '../version.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const COUNT_TABLES = [
  ['products', 'products'],
  ['customers', 'customers'],
  ['sales', 'sales'],
  ['sale_items', 'sale_items'],
  ['stock_movements', 'stock_movements'],
  ['delivery_orders', 'delivery_orders'],
  ['deliveries', 'deliveries'],
  ['credit_accounts', 'credit_accounts'],
  ['suppliers', 'suppliers'],
  ['cash_sessions', 'cash_sessions'],
  ['cash_movements', 'cash_movements'],
];

function stampForFilename(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

export function describeDbFile(dbPath) {
  if (!dbPath || !existsSync(dbPath)) {
    return null;
  }
  const st = statSync(dbPath);
  return {
    path: dbPath,
    filename: basename(dbPath),
    size_bytes: st.size,
    mtime: st.mtime.toISOString(),
  };
}

export function validateSqliteIntegrity(dbPath, { requireForeignKeysClean = true } = {}) {
  if (!dbPath || !existsSync(dbPath)) {
    throw new AppError('Arquivo de banco não encontrado', {
      status: 500,
      code: 'DB_MISSING',
    });
  }
  const size = statSync(dbPath).size;
  if (size < 100) {
    throw new AppError('Arquivo de banco inválido (muito pequeno)', {
      status: 500,
      code: 'DB_INVALID',
    });
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    const fkRows = db.pragma('foreign_key_check');
    if (integrity !== 'ok') {
      throw new AppError('integrity_check falhou', {
        status: 500,
        code: 'DB_CORRUPT',
        details: { integrity },
      });
    }
    if (requireForeignKeysClean && Array.isArray(fkRows) && fkRows.length > 0) {
      throw new AppError('foreign_key_check encontrou inconsistências', {
        status: 500,
        code: 'DB_FK_ERRORS',
        details: { count: fkRows.length, sample: fkRows.slice(0, 5) },
      });
    }
    return {
      integrity: 'ok',
      foreign_key_check: 'ok',
      foreign_key_issues: fkRows?.length || 0,
      size_bytes: size,
    };
  } finally {
    db.close();
  }
}

export function countProductionRecords(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const counts = {};
  try {
    for (const [key, table] of COUNT_TABLES) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
        counts[key] = Number(row?.c || 0);
      } catch {
        counts[key] = null;
      }
    }
    return counts;
  } finally {
    db.close();
  }
}

export function hasPriorInstallMarkers(extraDirs = []) {
  const dirs = [...listDataDirCandidates(), ...extraDirs];
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    const dbFile = join(dir, 'onca-pdv.db');
    if (existsSync(dbFile) && statSync(dbFile).size > 100) return true;

    const backups = join(dir, 'backups');
    if (existsSync(backups)) {
      try {
        const files = readdirSync(backups).filter((f) => /\.db$/i.test(f));
        if (files.length > 0) return true;
      } catch {
        /* ignore */
      }
    }

    if (existsSync(join(dir, 'configuracoes', 'impressoras.json'))) return true;
    if (existsSync(join(dir, 'assets'))) {
      try {
        if (readdirSync(join(dir, 'assets')).length > 0) return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

export function shouldRequireExistingDb() {
  if (process.env.PDV_ALLOW_EMPTY_DB === '1') return false;
  if (process.env.PDV_REQUIRE_EXISTING_DB === '1') return true;
  if (process.env.NODE_ENV === 'test') return false;
  // Desktop empacotado: se há sinais de instalação anterior, não criar banco vazio.
  if (process.env.PDV_ELECTRON_USER_DATA && process.env.NODE_ENV === 'production') {
    return hasPriorInstallMarkers();
  }
  return false;
}

/**
 * Copia o banco ATUAL (mais recente) para backups/ONCA-PDV-PRE-ATUALIZACAO-*.db
 * Não usa backup antigo — sempre a partir do arquivo ativo.
 */
export function createPreUpdateBackup(dbPath = getDbPath()) {
  if (!existsSync(dbPath)) {
    throw new AppError('Banco atual não encontrado para backup pré-atualização', {
      status: 500,
      code: 'DB_MISSING',
    });
  }

  // Checkpoint se possível (arquivo pode estar em uso por outra conexão)
  try {
    const live = new Database(dbPath, { fileMustExist: true });
    try {
      live.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      live.close();
    }
  } catch {
    /* continua com cópia do arquivo */
  }

  const backupsDir = getBackupsDir();
  mkdirSync(backupsDir, { recursive: true });
  const filename = `ONCA-PDV-PRE-ATUALIZACAO-${stampForFilename()}.db`;
  const dest = join(backupsDir, filename);
  copyFileSync(dbPath, dest);

  if (!existsSync(dest) || statSync(dest).size <= 0) {
    throw new AppError('Falha ao criar backup pré-atualização', {
      status: 500,
      code: 'PRE_UPDATE_BACKUP_FAILED',
    });
  }

  const validation = validateSqliteIntegrity(dest);
  const counts = countProductionRecords(dest);
  const metaPath = dest.replace(/\.db$/i, '.json');
  const meta = {
    kind: 'pre-update',
    created_at: new Date().toISOString(),
    source_db: dbPath,
    backup_file: dest,
    filename,
    size_bytes: statSync(dest).size,
    mtime: statSync(dest).mtime.toISOString(),
    integrity_check: validation.integrity,
    foreign_key_check: validation.foreign_key_check,
    counts_before: counts,
    note: 'Backup do banco ATUAL imediatamente antes de migrations. NÃO restaurar automaticamente.',
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  logger.info('Backup pré-atualização criado', {
    filename,
    size_bytes: meta.size_bytes,
    integrity: meta.integrity_check,
  });

  return meta;
}

function dbNeedsStructuralUpdate(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const applied = getAppliedMigrations(db);
    const pending = listMigrationFiles().filter((name) => !applied.has(name));
    let storedVersion = null;
    try {
      storedVersion = db.prepare(`SELECT value FROM settings WHERE key = 'app_version'`).get()?.value;
    } catch {
      storedVersion = null;
    }
    const versionChanged = Boolean(storedVersion && storedVersion !== APP_VERSION);
    return {
      pendingMigrations: pending,
      needsMigration: pending.length > 0,
      storedVersion,
      versionChanged,
      shouldBackup: pending.length > 0 || versionChanged || process.env.PDV_FORCE_PRE_UPDATE_BACKUP === '1',
    };
  } finally {
    db.close();
  }
}

/**
 * Chamado no bootstrap ANTES de openDatabase/migrations.
 * - Se banco existe: integrity_check; backup pré-atualização se houver migration/versão nova.
 * - Se não existe e parece upgrade: aborta (não cria vazio).
 * - Instalação nova: permite criar.
 * Nunca restaura backup antigo automaticamente.
 */
export function prepareDatabaseForOpen() {
  const dbPath = getDbPath();
  const dataDir = getDataDir();
  const info = describeDbFile(dbPath);

  if (info) {
    // Validar o banco ATUAL antes de qualquer migration.
    // integrity_check é obrigatório; FK inconsistente apenas registra (não bloqueia upgrade).
    const integrity = validateSqliteIntegrity(dbPath, { requireForeignKeysClean: false });
    if (integrity.foreign_key_issues > 0) {
      logger.warn('foreign_key_check com avisos (upgrade continua)', {
        count: integrity.foreign_key_issues,
      });
    }
    const plan = dbNeedsStructuralUpdate(dbPath);
    let backup = null;
    if (plan.shouldBackup) {
      backup = createPreUpdateBackup(dbPath);
      logger.info('Backup pré-atualização (migration/versão)', {
        pending: plan.pendingMigrations,
        from_version: plan.storedVersion,
        to_version: APP_VERSION,
      });
    } else {
      logger.info('Banco existente OK — sem migration pendente; backup pré-atualização dispensado');
    }
    return {
      mode: 'existing',
      dbPath,
      dataDir,
      db: info,
      preUpdateBackup: backup,
      counts_before: backup?.counts_before || countProductionRecords(dbPath),
      update_plan: plan,
    };
  }

  if (shouldRequireExistingDb()) {
    const candidates = listDataDirCandidates().map((dir) => join(dir, 'onca-pdv.db'));
    throw new AppError(
      'BANCO DA VERSÃO ANTERIOR NÃO ENCONTRADO. NÃO CONTINUE PARA EVITAR PERDA DE DADOS. Localize o arquivo onca-pdv.db ou um backup válido.',
      {
        status: 500,
        code: 'DB_NOT_FOUND_ON_UPGRADE',
        details: {
          expected: dbPath,
          dataDir,
          candidates,
        },
      }
    );
  }

  logger.info('Instalação nova: banco ainda não existe; será criado vazio', { dbPath });
  return {
    mode: 'fresh',
    dbPath,
    dataDir,
    db: null,
    preUpdateBackup: null,
    counts_before: null,
  };
}

export function writePostOpenCounts(prep, dbPath = getDbPath()) {
  if (!prep?.preUpdateBackup?.backup_file) return null;
  try {
    const after = countProductionRecords(dbPath);
    const report = {
      compared_at: new Date().toISOString(),
      db_path: dbPath,
      before: prep.counts_before,
      after,
      backup_file: prep.preUpdateBackup.backup_file,
    };
    const reportPath = join(
      dirname(prep.preUpdateBackup.backup_file),
      `ONCA-PDV-POS-ATUALIZACAO-${stampForFilename()}.json`
    );
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  } catch (err) {
    logger.warn('Não foi possível gravar contagem pós-abertura', { message: err.message });
    return null;
  }
}
