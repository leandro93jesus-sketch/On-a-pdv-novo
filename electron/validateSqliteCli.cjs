#!/usr/bin/env node
/**
 * Valida um SQLite ONÇA PDV com o Node embutido (não Electron).
 * Uso: node validateSqliteCli.cjs <caminho.db>
 * Saída JSON em stdout.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fail(code, message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, code, message, ...extra }) + '\n');
  process.exit(2);
}

const dbPath = process.argv[2];
if (!dbPath) fail('VALIDATION', 'Caminho do banco não informado');
if (!fs.existsSync(dbPath)) fail('BACKUP_NOT_FOUND', 'Arquivo não encontrado', { path: dbPath });

const st = fs.statSync(dbPath);
if (st.size < 100) fail('BACKUP_INVALID', 'BACKUP INVÁLIDO — arquivo muito pequeno');

const buf = fs.readFileSync(dbPath);
if (!buf.subarray(0, 16).toString('utf8').startsWith('SQLite format 3')) {
  fail('BACKUP_INVALID', 'BACKUP INVÁLIDO — não é SQLite');
}

const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

let manifest = null;
let manifestPath = null;
const base = dbPath.replace(/\.db$/i, '');
for (const p of [`${base}.manifest.json`, `${dbPath}.manifest.json`]) {
  if (fs.existsSync(p)) {
    try {
      manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
      manifestPath = p;
      break;
    } catch {
      fail('BACKUP_INVALID', 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO (manifesto inválido)');
    }
  }
}

if (manifest?.sha256 && String(manifest.sha256).toLowerCase() !== sha256) {
  fail('BACKUP_HASH_MISMATCH', 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO (SHA-256)', {
    expected: manifest.sha256,
    actual: sha256,
  });
}
if (manifest?.size_bytes != null && Number(manifest.size_bytes) !== st.size) {
  fail('BACKUP_SIZE_MISMATCH', 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO (tamanho)', {
    expected: manifest.size_bytes,
    actual: st.size,
  });
}

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  const candidates = [
    path.join(__dirname, '..', 'desktop-resources', 'app-server', 'node_modules', 'better-sqlite3'),
    path.join(__dirname, '..', 'server', 'node_modules', 'better-sqlite3'),
    path.join(process.resourcesPath || '', 'app-server', 'node_modules', 'better-sqlite3'),
  ];
  for (const c of candidates) {
    try {
      Database = require(c);
      break;
    } catch {
      /* next */
    }
  }
}
if (!Database) fail('BACKUP_INVALID', 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO (motor SQLite ausente)');

const COUNT_TABLES = [
  'products',
  'customers',
  'sales',
  'sale_items',
  'sale_payments',
  'stock_movements',
  'delivery_orders',
  'deliveries',
  'credit_accounts',
  'cash_sessions',
  'cash_movements',
];

let integrity = 'unknown';
let foreign_key_check = 'unknown';
let foreign_key_issues = 0;
const counts = {};
let lastSaleAt = null;

try {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    integrity = db.pragma('integrity_check', { simple: true });
    const fk = db.pragma('foreign_key_check');
    foreign_key_issues = Array.isArray(fk) ? fk.length : 0;
    foreign_key_check = foreign_key_issues === 0 ? 'ok' : 'issues';
    for (const t of COUNT_TABLES) {
      try {
        counts[t] = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get()?.c || 0);
      } catch {
        counts[t] = null;
      }
    }
    try {
      const row = db
        .prepare(
          `SELECT COALESCE(MAX(created_at), MAX(sold_at), MAX(updated_at)) AS last_at FROM sales`
        )
        .get();
      lastSaleAt = row?.last_at || null;
    } catch {
      try {
        const row = db.prepare(`SELECT MAX(created_at) AS last_at FROM sales`).get();
        lastSaleAt = row?.last_at || null;
      } catch {
        lastSaleAt = null;
      }
    }
  } finally {
    db.close();
  }
} catch (err) {
  fail('BACKUP_CORRUPT', `BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO: ${err.message}`);
}

if (integrity !== 'ok') {
  fail('BACKUP_CORRUPT', 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO (integrity_check)', {
    integrity,
  });
}
if (foreign_key_issues > 0) {
  fail('BACKUP_CORRUPT', 'BACKUP ENCONTRADO, MAS NÃO PÔDE SER VALIDADO (foreign_key_check)', {
    foreign_key_issues,
  });
}

process.stdout.write(
  JSON.stringify({
    ok: true,
    path: dbPath,
    filename: path.basename(dbPath),
    size_bytes: st.size,
    mtime: st.mtime.toISOString(),
    sha256,
    integrity_check: integrity,
    foreign_key_check,
    foreign_key_issues,
    counts,
    last_sale_at: lastSaleAt,
    app_version: manifest?.app_version || null,
    db_schema_version: manifest?.db_schema_version || null,
    manifest_path: manifestPath,
    manifest_present: Boolean(manifest),
  }) + '\n'
);
