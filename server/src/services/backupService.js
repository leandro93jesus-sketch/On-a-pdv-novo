import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { getDb, closeDb, openDatabase, setDb } from '../db/index.js';
import { getDbPath, ensureDataDir, getBackupsDir, getDataDir, getLogsDir } from '../db/paths.js';
import { getSetting } from './settingsService.js';
import { writeAudit } from './auditService.js';
import { reattachSessionAfterRestore } from './authService.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { APP_VERSION as APP_VERSION_CONST } from '../version.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const APP_VERSION = () => getSetting('app_version', APP_VERSION_CONST);

const COUNT_TABLES = [
  ['products', 'products'],
  ['customers', 'customers'],
  ['sales', 'sales'],
  ['sale_items', 'sale_items'],
  ['sale_payments', 'sale_payments'],
  ['stock_movements', 'stock_movements'],
  ['delivery_orders', 'delivery_orders'],
  ['deliveries', 'deliveries'],
  ['credit_accounts', 'credit_accounts'],
  ['suppliers', 'suppliers'],
  ['cash_sessions', 'cash_sessions'],
  ['cash_movements', 'cash_movements'],
];

function stampCompact(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}

export function getBackupDir() {
  let custom = '';
  try {
    custom = getSetting('backup_dir', '');
  } catch {
    custom = '';
  }
  const dir = custom && custom.trim() ? custom.trim() : getBackupsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function schemaVersion() {
  try {
    const row = getDb()
      .prepare(`SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1`)
      .get();
    return row?.name || 'unknown';
  } catch {
    return 'unknown';
  }
}

function stampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `onca-pdv-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function countEntitiesInDbFile(filePath) {
  const counts = {};
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    for (const [key, table] of COUNT_TABLES) {
      try {
        counts[key] = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get()?.c || 0);
      } catch {
        counts[key] = null;
      }
    }
    return counts;
  } finally {
    db.close();
  }
}

export function getActiveDbInfo() {
  const dbPath = getDbPath();
  const info = {
    db_path: dbPath,
    data_dir: getDataDir(),
    backups_dir: getBackupDir(),
    exists: existsSync(dbPath),
    filename: basename(dbPath),
    size_bytes: null,
    mtime: null,
    counts: null,
  };
  if (info.exists) {
    const st = statSync(dbPath);
    info.size_bytes = st.size;
    info.mtime = st.mtime.toISOString();
    try {
      info.counts = countEntitiesInDbFile(dbPath);
    } catch {
      info.counts = null;
    }
  }
  return info;
}

function removeDbSidecars(dbPath, { includeRestoreTmp = false } = {}) {
  const sides = [`${dbPath}-wal`, `${dbPath}-shm`];
  if (includeRestoreTmp) sides.push(`${dbPath}.restore-tmp`);
  for (const side of sides) {
    if (existsSync(side)) {
      try {
        unlinkSync(side);
      } catch {
        /* ignore */
      }
    }
  }
}

function writeRestoreLog(payload) {
  try {
    const dir = join(getLogsDir(), 'restore');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `restore-${stampCompact()}.json`);
    writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    return file;
  } catch (err) {
    logger.warn('Falha ao gravar log de restauração', { message: err.message });
    return null;
  }
}

function insertBackupHistoryRow({
  filename,
  filepath,
  size_bytes,
  sha256,
  app_version,
  db_schema_version,
  kind,
  createdBy,
  notes,
  valid = 1,
}) {
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO backup_history (filename, filepath, size_bytes, sha256, app_version, db_schema_version, kind, created_by, notes, valid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        filename,
        filepath,
        size_bytes,
        sha256,
        app_version,
        db_schema_version,
        kind,
        createdBy,
        notes,
        valid ? 1 : 0
      );
    return Number(info.lastInsertRowid);
  } catch (err) {
    logger.warn('Não foi possível registrar backup_history', { message: err.message, filename });
    return null;
  }
}

export function createBackup({ kind = 'manual', createdBy = null, notes = null } = {}) {
  ensureDataDir();
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    throw new AppError('Banco de dados não encontrado', { status: 500, code: 'DB_MISSING' });
  }

  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }

  const dir = getBackupDir();
  const base = stampName();
  const dbFile = `${base}.db`;
  const manifestFile = `${base}.manifest.json`;
  const dbDest = join(dir, dbFile);
  const manifestDest = join(dir, manifestFile);

  copyFileSync(dbPath, dbDest);
  if (!existsSync(dbDest) || statSync(dbDest).size <= 0) {
    throw new AppError('Falha ao criar arquivo de backup', { status: 500, code: 'BACKUP_FAILED' });
  }

  let printersConfigCopied = false;
  try {
    const printersSrc = join(getDataDir(), 'configuracoes', 'impressoras.json');
    if (existsSync(printersSrc)) {
      copyFileSync(printersSrc, join(dir, `${base}.impressoras.json`));
      printersConfigCopied = true;
    }
  } catch {
    /* não bloqueia backup do banco */
  }

  const hash = sha256File(dbDest);
  const size = statSync(dbDest).size;
  const manifest = {
    format: 'onca-pdv-backup-v1',
    created_at: new Date().toISOString(),
    app_version: APP_VERSION(),
    db_schema_version: schemaVersion(),
    db_filename: dbFile,
    size_bytes: size,
    sha256: hash,
    kind,
    notes,
    printers_config_sidecar: printersConfigCopied ? `${base}.impressoras.json` : null,
  };
  writeFileSync(manifestDest, JSON.stringify(manifest, null, 2), 'utf8');

  const id = insertBackupHistoryRow({
    filename: dbFile,
    filepath: dbDest,
    size_bytes: size,
    sha256: hash,
    app_version: manifest.app_version,
    db_schema_version: manifest.db_schema_version,
    kind,
    createdBy,
    notes,
    valid: 1,
  });

  writeAudit({
    action: 'backup.create',
    entityType: 'backup',
    entityId: id,
    details: { filename: dbFile, size, sha256: hash, kind },
    userName: createdBy,
  });

  return {
    id,
    filename: dbFile,
    filepath: dbDest,
    manifest_path: manifestDest,
    size_bytes: size,
    sha256: hash,
    app_version: manifest.app_version,
    db_schema_version: manifest.db_schema_version,
    kind,
    created_at: manifest.created_at,
    valid: true,
  };
}

/** Backup de segurança com nome PRE-RESTAURACAO-* (arquivo no disco, independente do DB). */
export function createPreRestoreBackup({ createdBy = null, notes = null } = {}) {
  ensureDataDir();
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    throw new AppError('Banco atual não encontrado para PRE-RESTAURACAO', {
      status: 500,
      code: 'DB_MISSING',
    });
  }

  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* ignore */
  }

  const dir = getBackupDir();
  const filename = `ONCA-PDV-PRE-RESTAURACAO-${stampCompact()}.db`;
  const filepath = join(dir, filename);
  copyFileSync(dbPath, filepath);
  if (!existsSync(filepath) || statSync(filepath).size <= 0) {
    throw new AppError('FALHA AO CRIAR BACKUP DO BANCO ATUAL (PRE-RESTAURACAO)', {
      status: 500,
      code: 'PRE_RESTORE_BACKUP_FAILED',
    });
  }

  const validation = validateBackupFile(filepath);
  const metaPath = filepath.replace(/\.db$/i, '.json');
  const meta = {
    kind: 'pre_restore',
    created_at: new Date().toISOString(),
    source_db: dbPath,
    filename,
    filepath,
    size_bytes: validation.size_bytes,
    sha256: validation.sha256,
    integrity_check: validation.integrity,
    foreign_key_check: validation.foreign_key_check,
    counts: validation.counts,
    created_by: createdBy,
    notes,
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  insertBackupHistoryRow({
    filename,
    filepath,
    size_bytes: validation.size_bytes,
    sha256: validation.sha256,
    app_version: APP_VERSION(),
    db_schema_version: schemaVersion(),
    kind: 'pre_restore',
    createdBy,
    notes: notes || 'Backup automático antes de restaurar',
    valid: 1,
  });

  return {
    filename,
    filepath,
    meta_path: metaPath,
    size_bytes: validation.size_bytes,
    sha256: validation.sha256,
    integrity: validation.integrity,
    counts: validation.counts,
    kind: 'pre_restore',
    created_at: meta.created_at,
    valid: true,
    exists: true,
  };
}

export function listBackups() {
  const fromDb = [];
  try {
    const rows = getDb()
      .prepare(`SELECT * FROM backup_history ORDER BY id DESC LIMIT 200`)
      .all();
    for (const r of rows) {
      fromDb.push({ ...r, exists: existsSync(r.filepath), source: 'history' });
    }
  } catch {
    /* banco pode estar em transição */
  }

  const byPath = new Map();
  for (const r of fromDb) {
    byPath.set(r.filepath, r);
  }

  // Inclui .db/.sqlite da pasta de backups mesmo sem linha em history (ex.: upload).
  try {
    const dir = getBackupDir();
    for (const name of readdirSync(dir)) {
      if (!/\.(db|sqlite|sqlite3)$/i.test(name)) continue;
      if (/\.(restore-tmp|pre-restore-prev)$/i.test(name)) continue;
      const filepath = join(dir, name);
      if (byPath.has(filepath)) continue;
      try {
        const st = statSync(filepath);
        if (st.size < 100) continue;
        byPath.set(filepath, {
          id: null,
          filename: name,
          filepath,
          size_bytes: st.size,
          sha256: null,
          app_version: null,
          db_schema_version: null,
          kind: name.startsWith('PRE-RESTAURACAO') || name.startsWith('ONCA-PDV-PRE-RESTAURACAO')
            ? 'pre_restore'
            : name.startsWith('ONCA-PDV-PRE-ATUALIZACAO')
              ? 'pre_update'
              : 'disk',
          created_by: null,
          notes: 'Detectado na pasta de backups',
          valid: null,
          created_at: st.mtime.toISOString(),
          exists: true,
          source: 'disk',
        });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  return [...byPath.values()].sort((a, b) => {
    const ta = Date.parse(a.created_at || '') || 0;
    const tb = Date.parse(b.created_at || '') || 0;
    return tb - ta;
  });
}

export function getBackupById(id) {
  const row = getDb().prepare('SELECT * FROM backup_history WHERE id = ?').get(id);
  if (!row) throw new AppError('Backup não encontrado', { status: 404, code: 'NOT_FOUND' });
  return { ...row, exists: existsSync(row.filepath) };
}

export function validateBackupFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    throw new AppError('Arquivo de backup não encontrado', {
      status: 400,
      code: 'BACKUP_NOT_FOUND',
    });
  }
  const size = statSync(filePath).size;
  const filename = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const mtime = statSync(filePath).mtime.toISOString();

  if (ext === '.json') {
    throw new AppError(
      'Arquivo JSON detectado. Use a aba IMPORTAR BACKUP ANTIGO JSON — não restaure JSON como SQLite.',
      { status: 400, code: 'WRONG_BACKUP_TYPE_JSON' }
    );
  }

  if (
    !['.db', '.sqlite', '.sqlite3', ''].includes(ext) &&
    !filename.endsWith('.restore-tmp')
  ) {
    throw new AppError('BACKUP INVÁLIDO — use .db, .sqlite ou .sqlite3', {
      status: 400,
      code: 'BACKUP_INVALID',
    });
  }

  if (size < 100) {
    throw new AppError('BANCO SQLITE INVÁLIDO (arquivo muito pequeno)', {
      status: 400,
      code: 'BACKUP_INVALID',
    });
  }

  const fd = readFileSync(filePath);
  const header = fd.subarray(0, 16).toString('utf8');
  if (!header.startsWith('SQLite format 3')) {
    throw new AppError('BANCO SQLITE INVÁLIDO (cabeçalho SQLite ausente)', {
      status: 400,
      code: 'BACKUP_INVALID',
    });
  }

  const hash = createHash('sha256').update(fd).digest('hex');
  let manifest = null;
  if (/\.db$/i.test(filePath) && !filePath.endsWith('.restore-tmp')) {
    const manifestPath = filePath.replace(/\.db$/i, '.manifest.json');
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.sha256 && manifest.sha256 !== hash) {
          throw new AppError('Hash SHA-256 do backup não confere com o manifesto', {
            status: 400,
            code: 'BACKUP_HASH_MISMATCH',
          });
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Manifesto de backup inválido', {
          status: 400,
          code: 'BACKUP_INVALID',
        });
      }
    }
  }

  let integrity = 'unknown';
  let foreign_key_check = 'unknown';
  let foreign_key_issues = 0;
  let tables = 0;
  let counts = null;
  try {
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    try {
      integrity = db.pragma('integrity_check', { simple: true });
      const fk = db.pragma('foreign_key_check');
      foreign_key_issues = Array.isArray(fk) ? fk.length : 0;
      foreign_key_check = foreign_key_issues === 0 ? 'ok' : 'issues';
      tables = db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'`).get().c;
    } finally {
      db.close();
    }
    counts = countEntitiesInDbFile(filePath);
  } catch (err) {
    throw new AppError(`BANCO SQLITE INVÁLIDO: ${err.message}`, {
      status: 400,
      code: 'BACKUP_INVALID',
    });
  }

  if (integrity !== 'ok') {
    throw new AppError('BANCO CORROMPIDO — integrity_check falhou', {
      status: 400,
      code: 'BACKUP_CORRUPT',
      details: { integrity },
    });
  }

  if (foreign_key_issues > 0) {
    throw new AppError('BANCO CORROMPIDO — foreign_key_check encontrou inconsistências', {
      status: 400,
      code: 'BACKUP_CORRUPT',
      details: { foreign_key_issues },
    });
  }

  return {
    filepath: filePath,
    filename,
    extension: ext || '.db',
    detected_type: 'DB',
    size_bytes: size,
    mtime,
    sha256: hash,
    integrity,
    foreign_key_check,
    foreign_key_issues,
    tables,
    counts,
    manifest,
    app_version: manifest?.app_version || null,
    db_schema_version: manifest?.db_schema_version || null,
  };
}

/**
 * Detecta se o banco ATIVO parece mais novo/completo que o backup.
 * Usado para NÃO sobrescrever vendas recentes com backup antigo.
 */
export function assessCurrentVsBackup(currentCounts = {}, backupCounts = {}, meta = {}) {
  const curSales = Number(currentCounts?.sales || 0);
  const bakSales = Number(backupCounts?.sales || 0);
  const curProducts = Number(currentCounts?.products || 0);
  const bakProducts = Number(backupCounts?.products || 0);
  const curCustomers = Number(currentCounts?.customers || 0);
  const bakCustomers = Number(backupCounts?.customers || 0);
  const reasons = [];

  if (curSales > bakSales) {
    reasons.push(`vendas atuais (${curSales}) > backup (${bakSales})`);
  }
  if (curSales === bakSales && curProducts > bakProducts) {
    reasons.push(`produtos atuais (${curProducts}) > backup (${bakProducts})`);
  }
  if (curSales === bakSales && curCustomers > bakCustomers) {
    reasons.push(`clientes atuais (${curCustomers}) > backup (${bakCustomers})`);
  }

  const currentMtime = meta.current_mtime ? Date.parse(meta.current_mtime) : NaN;
  const backupMtime = meta.backup_mtime ? Date.parse(meta.backup_mtime) : NaN;
  if (
    Number.isFinite(currentMtime) &&
    Number.isFinite(backupMtime) &&
    currentMtime > backupMtime &&
    (curSales > bakSales || curProducts > bakProducts || curCustomers > bakCustomers)
  ) {
    reasons.push('arquivo do banco atual é mais recente que o backup');
  }

  const unique = [...new Set(reasons)];
  return {
    current_has_newer_data: unique.length > 0,
    reasons: unique,
    recommendation: unique.length
      ? 'PRESERVAR o banco atual. Não restaurar este backup por cima, salvo decisão explícita do operador.'
      : 'Backup pode ser restaurado com confirmação (será criado PRE-RESTAURACAO).',
  };
}

export function previewRestore(filePath) {
  const validation = validateBackupFile(filePath);
  const active = getActiveDbInfo();
  const comparison = assessCurrentVsBackup(active.counts, validation.counts, {
    current_mtime: active.mtime,
    backup_mtime: validation.mtime,
  });
  return {
    valid: true,
    detected_type: 'DB',
    file: {
      filename: validation.filename,
      filepath: validation.filepath,
      extension: validation.extension,
      size_bytes: validation.size_bytes,
      mtime: validation.mtime,
      sha256: validation.sha256,
    },
    integrity_check: validation.integrity,
    foreign_key_check: validation.foreign_key_check,
    foreign_key_issues: validation.foreign_key_issues,
    counts_in_backup: validation.counts,
    counts_current: active.counts,
    active_db: {
      path: active.db_path,
      exists: active.exists,
      size_bytes: active.size_bytes,
      mtime: active.mtime,
    },
    destination_db: active.db_path,
    app_version: validation.app_version,
    db_schema_version: validation.db_schema_version,
    tables: validation.tables,
    current_has_newer_data: comparison.current_has_newer_data,
    comparison_reasons: comparison.reasons,
    recommendation: comparison.recommendation,
    requires_allow_overwrite_newer_data: comparison.current_has_newer_data,
    warning: comparison.current_has_newer_data
      ? `ATENÇÃO: o banco ATUAL parece mais novo/completo que este backup (${comparison.reasons.join('; ')}). Restaurar apagaria dados recentes. Só continue com confirmação explícita de sobrescrita.`
      : 'A restauração substituirá o banco ATUAL em uso. Será criado PRE-RESTAURACAO-* antes. Sucesso só após reabrir o banco e conferir contagens.',
  };
}

/** Registra arquivo enviado (.db/.sqlite) no histórico e valida. */
export function registerUploadedBackup(filepath, { createdBy = null, originalName = null } = {}) {
  const validation = validateBackupFile(filepath);
  const id = insertBackupHistoryRow({
    filename: validation.filename,
    filepath: validation.filepath,
    size_bytes: validation.size_bytes,
    sha256: validation.sha256,
    app_version: validation.app_version,
    db_schema_version: validation.db_schema_version,
    kind: 'uploaded',
    createdBy,
    notes: originalName ? `Upload: ${originalName}` : 'Upload manual',
    valid: 1,
  });

  writeAudit({
    action: 'backup.upload',
    entityType: 'backup',
    entityId: id,
    details: {
      filename: validation.filename,
      originalName,
      sha256: validation.sha256,
      counts: validation.counts,
    },
    userName: createdBy,
  });

  return {
    id,
    ...validation,
    kind: 'uploaded',
    exists: true,
    valid: true,
    registered: true,
  };
}

export function restoreBackup(
  filePath,
  {
    createdBy = null,
    confirm = false,
    allow_overwrite_newer_data = false,
    sessionToken = null,
    userId = null,
    userLogin = null,
  } = {}
) {
  if (!confirm) {
    throw new AppError('Confirmação explícita necessária (confirm=true)', {
      status: 400,
      code: 'CONFIRM_REQUIRED',
    });
  }

  const startedAt = new Date().toISOString();
  const activeBefore = getActiveDbInfo();
  const validation = validateBackupFile(filePath);
  const countsBefore = activeBefore.counts || countEntitiesInDbFile(getDbPath());
  const countsExpected = validation.counts;

  let safety = null;
  let logPath = null;
  const dbPath = getDbPath();

  logger.info('BANCO ATIVO: ' + dbPath);
  logger.info('BANCO SELECIONADO: ' + filePath);
  console.log(`[onca-pdv] BANCO ATIVO: ${dbPath}`);
  console.log(`[onca-pdv] BANCO SELECIONADO: ${filePath}`);

  if (dbPath !== activeBefore.db_path) {
    throw new AppError('API ESTÁ ABRINDO OUTRO BANCO (inconsistência de caminho)', {
      status: 500,
      code: 'DB_PATH_MISMATCH',
      details: { active: activeBefore.db_path, destination: dbPath },
    });
  }

  const comparison = assessCurrentVsBackup(countsBefore, countsExpected, {
    current_mtime: activeBefore.mtime,
    backup_mtime: validation.mtime,
  });
  if (comparison.current_has_newer_data && !allow_overwrite_newer_data) {
    throw new AppError(
      'ATENÇÃO: O BANCO ATUAL PODE CONTER VENDAS MAIS RECENTES. Restauração bloqueada. Use FAZER BACKUP E CONTINUAR se tiver certeza.',
      {
        status: 409,
        code: 'CURRENT_DB_NEWER_THAN_BACKUP',
        details: {
          reasons: comparison.reasons,
          counts_current: countsBefore,
          counts_in_backup: countsExpected,
          recommendation: comparison.recommendation,
        },
      }
    );
  }

  try {
    safety = createPreRestoreBackup({
      createdBy,
      notes: `ONCA-PDV-PRE-RESTAURACAO antes de restaurar ${validation.filename}`,
    });
    if (!existsSync(safety.filepath) || safety.integrity !== 'ok') {
      throw new AppError('FALHA AO CRIAR BACKUP DO BANCO ATUAL — restauração abortada', {
        status: 500,
        code: 'PRE_RESTORE_BACKUP_FAILED',
      });
    }
  } catch (err) {
    logPath = writeRestoreLog({
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      ok: false,
      stage: 'pre_restore_backup',
      selected_file: filePath,
      active_db: dbPath,
      error: String(err.message || err),
      destination_db: dbPath,
      integrity_check: validation.integrity,
      foreign_key_check: validation.foreign_key_check,
      counts_in_backup: countsExpected,
    });
    throw err;
  }

  const tempPath = `${dbPath}.restore-tmp`;
  const prevPath = `${dbPath}.pre-restore-prev`;

  try {
    try {
      closeDb();
    } catch (err) {
      throw new AppError('FALHA AO FECHAR CONEXÃO', {
        status: 500,
        code: 'DB_CLOSE_FAILED',
        details: { message: String(err.message || err) },
      });
    }
    // Não apagar .restore-tmp aqui — ele ainda será usado no rename.
    removeDbSidecars(dbPath, { includeRestoreTmp: false });

    try {
      copyFileSync(filePath, tempPath);
    } catch (err) {
      setDb(openDatabase(dbPath));
      throw new AppError('FALHA AO COPIAR BANCO', {
        status: 500,
        code: 'RESTORE_COPY_FAILED',
        details: { message: String(err.message || err) },
      });
    }
    const tempCheck = validateBackupFile(tempPath);
    if (tempCheck.integrity !== 'ok') {
      unlinkSync(tempPath);
      setDb(openDatabase(dbPath));
      throw new AppError('FALHA AO COPIAR BANCO (arquivo temporário inválido)', {
        status: 400,
        code: 'BACKUP_INVALID',
      });
    }

    if (existsSync(dbPath)) {
      copyFileSync(dbPath, prevPath);
    }
    // Remove apenas WAL/SHM do destino; o .restore-tmp é a origem do rename.
    removeDbSidecars(dbPath, { includeRestoreTmp: false });
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    renameSync(tempPath, dbPath);
    removeDbSidecars(dbPath, { includeRestoreTmp: true });

    try {
      setDb(openDatabase(dbPath));
    } catch (err) {
      throw new AppError('FALHA NA MIGRATION ao reabrir o banco restaurado', {
        status: 500,
        code: 'RESTORE_MIGRATION_FAILED',
        details: { message: String(err.message || err) },
      });
    }

    // Confirma que a API reabriu o MESMO arquivo restaurado
    const activeAfter = getActiveDbInfo();
    if (activeAfter.db_path !== dbPath || !activeAfter.exists) {
      throw new AppError('API ESTÁ ABRINDO OUTRO BANCO', {
        status: 500,
        code: 'DB_PATH_MISMATCH',
        details: { expected: dbPath, actual: activeAfter.db_path },
      });
    }

    const countsAfter = countEntitiesInDbFile(dbPath);
    const mismatch = [];
    for (const key of [
      'products',
      'customers',
      'sales',
      'sale_items',
      'sale_payments',
      'suppliers',
      'credit_accounts',
    ]) {
      if (countsExpected?.[key] != null && countsAfter?.[key] !== countsExpected[key]) {
        mismatch.push({
          key,
          expected: countsExpected[key],
          actual: countsAfter[key],
        });
      }
    }
    if (mismatch.length) {
      throw new AppError(
        'Restauração copiou o arquivo, mas as contagens não conferem com o backup — rollback',
        {
          status: 500,
          code: 'RESTORE_COUNT_MISMATCH',
          details: { mismatch, countsExpected, countsAfter },
        }
      );
    }

    // Prova de que a API lê os dados do banco restaurado (não só contagem de arquivo).
    let liveProducts = 0;
    let liveCustomers = 0;
    let liveSales = 0;
    try {
      const live = getDb();
      liveProducts = Number(live.prepare('SELECT COUNT(*) AS c FROM products').get()?.c || 0);
      liveCustomers = Number(live.prepare('SELECT COUNT(*) AS c FROM customers').get()?.c || 0);
      liveSales = Number(live.prepare('SELECT COUNT(*) AS c FROM sales').get()?.c || 0);
    } catch (err) {
      throw new AppError('API reabriu o arquivo, mas não conseguiu ler os dados restaurados', {
        status: 500,
        code: 'RESTORE_READ_FAILED',
        details: { message: String(err.message || err) },
      });
    }
    if (
      liveProducts !== Number(countsAfter.products || 0) ||
      liveCustomers !== Number(countsAfter.customers || 0) ||
      liveSales !== Number(countsAfter.sales || 0)
    ) {
      throw new AppError('API ESTÁ ABRINDO OUTRO BANCO (contagens ao vivo divergem)', {
        status: 500,
        code: 'DB_PATH_MISMATCH',
        details: {
          live: { products: liveProducts, customers: liveCustomers, sales: liveSales },
          countsAfter,
        },
      });
    }

    const session =
      reattachSessionAfterRestore(sessionToken, {
        userId,
        login: userLogin,
      }) || null;

    const postIntegrity = validateBackupFile(dbPath);
    const dataVisible = {
      products: liveProducts > 0 || Number(countsExpected.products || 0) === 0,
      customers: liveCustomers > 0 || Number(countsExpected.customers || 0) === 0,
      sales: liveSales > 0 || Number(countsExpected.sales || 0) === 0,
    };
    const verified =
      dataVisible.products && dataVisible.customers && dataVisible.sales && postIntegrity.integrity === 'ok';
    if (!verified) {
      throw new AppError('Restauração não verificada — dados não ficaram visíveis na API', {
        status: 500,
        code: 'RESTORE_NOT_VERIFIED',
        details: { dataVisible, countsAfter },
      });
    }

    writeAudit({
      action: 'backup.restore',
      entityType: 'backup',
      details: {
        restored: validation.filename,
        sha256: validation.sha256,
        safety_backup: safety.filename,
        counts_before: countsBefore,
        counts_after: countsAfter,
        destination_db: dbPath,
        active_db_before: activeBefore.db_path,
        selected_file: filePath,
      },
      userName: createdBy,
    });

    const result = {
      ok: true,
      verified: true,
      detected_type: 'DB',
      restored: {
        filename: validation.filename,
        filepath: validation.filepath,
        sha256: validation.sha256,
        size_bytes: validation.size_bytes,
        counts: countsExpected,
      },
      safety_backup: safety,
      destination_db: dbPath,
      active_db_before: activeBefore.db_path,
      active_db_after: activeAfter.db_path,
      selected_file: filePath,
      counts_before: countsBefore,
      counts_after: countsAfter,
      data_visible: dataVisible,
      integrity_check: validation.integrity,
      foreign_key_check: validation.foreign_key_check,
      integrity_after: postIntegrity.integrity,
      foreign_key_check_after: postIntegrity.foreign_key_check,
      session_reattached: Boolean(session),
      reload_required: true,
      message: `BACKUP RESTAURADO\nProdutos: ${liveProducts}\nClientes: ${liveCustomers}\nVendas: ${liveSales}`,
    };

    logPath = writeRestoreLog({
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      ok: true,
      selected_file: filePath,
      active_db_before: activeBefore.db_path,
      type: 'DB',
      hash: validation.sha256,
      destination_db: dbPath,
      safety_backup: safety.filepath,
      integrity_check: validation.integrity,
      foreign_key_check: validation.foreign_key_check,
      counts_before: countsBefore,
      counts_after: countsAfter,
      products: liveProducts,
      customers: liveCustomers,
      sales: liveSales,
      imported_or_restored: countsAfter,
    });
    result.log_path = logPath;
    return result;
  } catch (err) {
    try {
      try {
        closeDb();
      } catch {
        /* ignore */
      }
      if (existsSync(prevPath)) {
        copyFileSync(prevPath, dbPath);
        removeDbSidecars(dbPath);
      }
      if (existsSync(tempPath)) {
        try {
          unlinkSync(tempPath);
        } catch {
          /* ignore */
        }
      }
      setDb(openDatabase(dbPath));
    } catch {
      /* ignore */
    }

    logPath = writeRestoreLog({
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      ok: false,
      selected_file: filePath,
      type: 'DB',
      hash: validation?.sha256,
      destination_db: dbPath,
      safety_backup: safety?.filepath || null,
      error: String(err.message || err),
      code: err.code || null,
      rollback: true,
    });

    try {
      writeAudit({
        action: 'backup.restore_failed',
        entityType: 'backup',
        details: { error: String(err.message || err), file: filePath, log_path: logPath },
        userName: createdBy,
        result: 'fail',
      });
    } catch {
      /* ignore */
    }

    if (err instanceof AppError) throw err;
    throw new AppError(`Falha na restauração: ${err.message}`, {
      status: 500,
      code: 'RESTORE_FAILED',
      details: { log_path: logPath },
    });
  } finally {
    if (existsSync(prevPath)) {
      try {
        unlinkSync(prevPath);
      } catch {
        /* ignore */
      }
    }
  }
}
