import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '../db/index.js';
import { getDataDir, getDbPath, getBackupsDir } from '../db/paths.js';
import { APP_NAME, APP_VERSION, APP_BUILD } from '../version.js';
import { getSetting } from './settingsService.js';

export function getSupportDiagnostics() {
  const db = getDb();
  db.pragma('foreign_keys = ON');
  const integrity = db.pragma('integrity_check')[0]?.integrity_check || 'error';
  const fk = db.pragma('foreign_key_check');
  const schemaVersion = db
    .prepare(`SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1`)
    .get()?.name;

  let lastBackup = null;
  const backupsDir = getBackupsDir();
  if (existsSync(backupsDir)) {
    const files = readdirSync(backupsDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const p = join(backupsDir, f);
        const st = statSync(p);
        return { filename: f, path: p, size_bytes: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    lastBackup = files[0] || null;
  }

  const counts = {
    products: db.prepare(`SELECT COUNT(*) c FROM products`).get().c,
    customers: db.prepare(`SELECT COUNT(*) c FROM customers`).get().c,
    sales: db.prepare(`SELECT COUNT(*) c FROM sales`).get().c,
    users: db.prepare(`SELECT COUNT(*) c FROM users`).get().c,
  };

  return {
    app_name: APP_NAME,
    app_version: APP_VERSION,
    app_build: APP_BUILD,
    db_schema_version: schemaVersion || getSetting('db_schema_version', ''),
    db_path: getDbPath(),
    data_dir: getDataDir(),
    integrity_check: integrity,
    foreign_key_violations: fk.length,
    last_backup: lastBackup,
    counts,
    generated_at: new Date().toISOString(),
  };
}

/** Relatório de diagnóstico sem senhas. */
export function buildDiagnosticReport() {
  const base = getSupportDiagnostics();
  const db = getDb();
  const migrations = db.prepare(`SELECT id, name, applied_at FROM schema_migrations ORDER BY id`).all();
  const settingsSafe = db
    .prepare(`SELECT key, value FROM settings WHERE key NOT LIKE '%password%' AND key NOT LIKE '%secret%' AND key NOT LIKE '%token%' ORDER BY key`)
    .all();
  const recentErrors = db
    .prepare(
      `SELECT id, action, entity_type, created_at, details
       FROM audit_logs
       WHERE action LIKE '%fail%' OR action LIKE '%error%' OR action LIKE '%rollback%'
       ORDER BY id DESC LIMIT 20`
    )
    .all();

  return {
    ...base,
    migrations,
    settings: settingsSafe,
    recent_failures: recentErrors,
    note: 'Relatório sem senhas, tokens ou hashes.',
  };
}
