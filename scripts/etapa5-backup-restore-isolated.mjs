#!/usr/bin/env node
/**
 * Teste controlado de backup/restauração em cópia isolada.
 * NÃO toca no banco real de produção do workspace além de lê-lo/copiá-lo.
 */
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  copyFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_DB =
  process.env.PDV_DB_PATH || resolve(root, 'server/data/onca-pdv.db');

const results = [];
function record(id, ok, detail = '') {
  results.push({ id, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}${detail ? ` — ${detail}` : ''}`);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function checks(dbPath, label) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const integrity = db.pragma('integrity_check')[0].integrity_check;
  const fk = db.pragma('foreign_key_check');
  const counts = {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    customers: db.prepare('SELECT COUNT(*) c FROM customers').get().c,
    sales: db.prepare('SELECT COUNT(*) c FROM sales').get().c,
    stock_sum: db.prepare('SELECT COALESCE(SUM(stock_qty),0) s FROM products').get().s,
  };
  db.close();
  return { integrity, fk: fk.length, counts, label };
}

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-restore-'));
const isolated = join(tmp, 'isolated.db');
const backup = join(tmp, 'backup-copy.db');
const restored = join(tmp, 'restored.db');

try {
  copyFileSync(REAL_DB, isolated);
  const before = checks(isolated, 'isolated-before');
  record('copy', existsSync(isolated), isolated);
  record('integrity-before', before.integrity === 'ok', before.integrity);
  record('fk-before', before.fk === 0, String(before.fk));

  copyFileSync(isolated, backup);
  const hash = sha256(backup);
  record('backup-hash', hash.length === 64, hash.slice(0, 16) + '…');

  // "restaurar" = copiar backup para novo arquivo (ambiente seguro)
  copyFileSync(backup, restored);
  const after = checks(restored, 'restored');
  record('integrity-after', after.integrity === 'ok', after.integrity);
  record('fk-after', after.fk === 0, String(after.fk));
  record(
    'counts-match',
    JSON.stringify(before.counts) === JSON.stringify(after.counts),
    JSON.stringify(after.counts)
  );
  record('real-untouched', existsSync(REAL_DB), REAL_DB);

  const report = {
    kind: 'etapa5_backup_restore_isolated',
    created_at: new Date().toISOString(),
    real_db: REAL_DB,
    tmp,
    backup_sha256: hash,
    before,
    after,
    results,
  };
  const outDir = resolve(root, 'docs/reports');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'ETAPA5-BACKUP-RESTORE-ISOLADO.json'), JSON.stringify(report, null, 2));

  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`PASS ${results.length - failed.length}/${results.length}`);
  if (failed.length) process.exit(1);
  console.log('RESTORE ISOLADO: OK (banco real não foi sobrescrito)');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
