import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { getDb, closeDb, openDatabase, setDb } from '../db/index.js';
import { getDataDir, getDbPath, ensureDataDir } from '../db/paths.js';
import { getSetting } from './settingsService.js';
import { writeAudit } from './auditService.js';
import { AppError } from '../utils/errors.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const APP_VERSION = () => getSetting('app_version', '0.4.0');

export function getBackupDir() {
  const custom = getSetting('backup_dir', '');
  const dir = custom && custom.trim() ? custom.trim() : join(getDataDir(), 'backups');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function schemaVersion() {
  const row = getDb()
    .prepare(`SELECT filename FROM schema_migrations ORDER BY id DESC LIMIT 1`)
    .get();
  return row?.filename || 'unknown';
}

function stampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `onca-pdv-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
  };
  writeFileSync(manifestDest, JSON.stringify(manifest, null, 2), 'utf8');

  const info = getDb()
    .prepare(
      `INSERT INTO backup_history (filename, filepath, size_bytes, sha256, app_version, db_schema_version, kind, created_by, notes, valid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      dbFile,
      dbDest,
      size,
      hash,
      manifest.app_version,
      manifest.db_schema_version,
      kind,
      createdBy,
      notes
    );

  writeAudit({
    action: 'backup.create',
    entityType: 'backup',
    entityId: info.lastInsertRowid,
    details: { filename: dbFile, size, sha256: hash, kind },
    userName: createdBy,
  });

  return {
    id: Number(info.lastInsertRowid),
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

export function listBackups() {
  return getDb()
    .prepare(`SELECT * FROM backup_history ORDER BY id DESC LIMIT 200`)
    .all()
    .map((r) => ({ ...r, exists: existsSync(r.filepath) }));
}

export function getBackupById(id) {
  const row = getDb().prepare('SELECT * FROM backup_history WHERE id = ?').get(id);
  if (!row) throw new AppError('Backup não encontrado', { status: 404, code: 'NOT_FOUND' });
  return { ...row, exists: existsSync(row.filepath) };
}

export function validateBackupFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    throw new AppError('Arquivo de backup não encontrado', { status: 400, code: 'BACKUP_NOT_FOUND' });
  }
  const size = statSync(filePath).size;
  if (size < 100) {
    throw new AppError('Arquivo de backup inválido (muito pequeno)', {
      status: 400,
      code: 'BACKUP_INVALID',
    });
  }

  const fd = readFileSync(filePath);
  const header = fd.subarray(0, 16).toString('utf8');
  if (!header.startsWith('SQLite format 3')) {
    throw new AppError('Arquivo não é um banco SQLite válido', {
      status: 400,
      code: 'BACKUP_INVALID',
    });
  }

  const hash = createHash('sha256').update(fd).digest('hex');
  const manifestPath = filePath.replace(/\.db$/i, '.manifest.json');
  let manifest = null;
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
      throw new AppError('Manifesto de backup inválido', { status: 400, code: 'BACKUP_INVALID' });
    }
  }

  let integrity = 'unknown';
  let tables = 0;
  try {
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    integrity = db.pragma('integrity_check')[0]?.integrity_check || 'fail';
    tables = db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'`).get().c;
    db.close();
  } catch (err) {
    throw new AppError(`Backup ilegível: ${err.message}`, { status: 400, code: 'BACKUP_INVALID' });
  }

  if (integrity !== 'ok') {
    throw new AppError('integrity_check do backup falhou', {
      status: 400,
      code: 'BACKUP_CORRUPT',
      details: { integrity },
    });
  }

  return {
    filepath: filePath,
    filename: basename(filePath),
    size_bytes: size,
    sha256: hash,
    integrity,
    tables,
    manifest,
    app_version: manifest?.app_version || null,
    db_schema_version: manifest?.db_schema_version || null,
  };
}

export function previewRestore(filePath) {
  const validation = validateBackupFile(filePath);
  return {
    valid: true,
    summary: {
      filename: validation.filename,
      size_bytes: validation.size_bytes,
      sha256: validation.sha256,
      app_version: validation.app_version,
      db_schema_version: validation.db_schema_version,
      tables: validation.tables,
      integrity: validation.integrity,
    },
    warning:
      'A restauração substituirá o banco atual. Um backup automático do estado atual será criado antes.',
  };
}

export function restoreBackup(filePath, { createdBy = null, confirm = false } = {}) {
  if (!confirm) {
    throw new AppError('Confirmação explícita necessária (confirm=true)', {
      status: 400,
      code: 'CONFIRM_REQUIRED',
    });
  }

  const validation = validateBackupFile(filePath);
  const safety = createBackup({
    kind: 'pre_restore',
    createdBy,
    notes: `Backup automático antes de restaurar ${validation.filename}`,
  });

  const dbPath = getDbPath();
  const tempPath = `${dbPath}.restore-tmp`;
  const prevPath = `${dbPath}.pre-restore-prev`;

  try {
    closeDb();

    copyFileSync(filePath, tempPath);
    const tempCheck = validateBackupFile(tempPath);
    if (tempCheck.integrity !== 'ok') {
      unlinkSync(tempPath);
      setDb(openDatabase(dbPath));
      throw new AppError('Arquivo temporário de restauração inválido', {
        status: 400,
        code: 'BACKUP_INVALID',
      });
    }

    if (existsSync(dbPath)) {
      copyFileSync(dbPath, prevPath);
    }
    renameSync(tempPath, dbPath);
    setDb(openDatabase(dbPath));

    writeAudit({
      action: 'backup.restore',
      entityType: 'backup',
      details: {
        restored: validation.filename,
        sha256: validation.sha256,
        safety_backup_id: safety.id,
      },
      userName: createdBy,
    });

    return { ok: true, restored: validation, safety_backup: safety };
  } catch (err) {
    try {
      try {
        closeDb();
      } catch {
        /* ignore */
      }
      if (existsSync(prevPath)) {
        copyFileSync(prevPath, dbPath);
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
    writeAudit({
      action: 'backup.restore_failed',
      entityType: 'backup',
      details: { error: String(err.message || err), file: filePath },
      userName: createdBy,
      result: 'fail',
    });
    if (err instanceof AppError) throw err;
    throw new AppError(`Falha na restauração: ${err.message}`, {
      status: 500,
      code: 'RESTORE_FAILED',
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
