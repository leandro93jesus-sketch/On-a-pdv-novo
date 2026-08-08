import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../migrations');

export function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export function getAppliedMigrations(db) {
  ensureMigrationsTable(db);
  return new Set(
    db.prepare('SELECT name FROM schema_migrations ORDER BY id').all().map((r) => r.name)
  );
}

/** Aplica migrations pendentes. Retorna lista de nomes aplicados nesta execução. */
export function runMigrations(db) {
  ensureMigrationsTable(db);
  const applied = getAppliedMigrations(db);
  const pending = listMigrationFiles().filter((name) => !applied.has(name));
  const mark = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  const appliedNow = [];
  for (const name of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      mark.run(name);
    });
    apply();
    appliedNow.push(name);
  }
  return appliedNow;
}
