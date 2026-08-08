/**
 * Importação DEFINITIVA do backup Oncas PDV v2 para o banco principal.
 * Requer autorização explícita. Não modifica o JSON.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { getDbPath, getDataDir, ensureDataDir } from '../../db/paths.js';
import { openDatabase, closeDb, setDb, getDb } from '../../db/index.js';
import {
  matchesOncasPdvV2,
  toOncasPdvV2Model,
  buildOncasPreview,
  LEGACY_SOURCE,
} from './mapOncasPdvV2.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

function mapMoveType(typeRaw, delta) {
  const t = String(typeRaw || '').toLowerCase();
  if (t.includes('venda')) return 'sale';
  if (t.includes('entrada')) return 'entry';
  if (t.includes('ajuste') && delta >= 0) return 'adjust_in';
  if (t.includes('ajuste') && delta < 0) return 'adjust_out';
  if (delta >= 0) return 'entry';
  return 'exit';
}

function stampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `onca-pdv-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function preflight(db) {
  db.pragma('foreign_keys = ON');
  const integrity = db.pragma('integrity_check')[0]?.integrity_check;
  const fk = db.pragma('foreign_key_check');
  return {
    integrity_check: integrity,
    foreign_key_violations: fk.length,
    ok: integrity === 'ok' && fk.length === 0,
  };
}

function createSafetyBackup(dbPath) {
  ensureDataDir();
  const dir = join(getDataDir(), 'backups');
  mkdirSync(dir, { recursive: true });
  // checkpoint if possible
  try {
    const live = new Database(dbPath);
    live.pragma('wal_checkpoint(TRUNCATE)');
    live.close();
  } catch {
    /* ignore */
  }
  const base = stampName();
  const filename = `${base}.db`;
  const filepath = join(dir, filename);
  copyFileSync(dbPath, filepath);
  if (!existsSync(filepath) || statSync(filepath).size < 100) {
    throw new Error('Falha ao criar backup de segurança do banco atual');
  }
  const hash = sha256File(filepath);
  const manifest = {
    format: 'onca-pdv-backup-v1',
    kind: 'pre_import',
    created_at: new Date().toISOString(),
    db_filename: filename,
    size_bytes: statSync(filepath).size,
    sha256: hash,
    note: 'Backup automático antes da importação do JSON real Oncas PDV v2',
  };
  writeFileSync(join(dir, `${base}.manifest.json`), JSON.stringify(manifest, null, 2));
  return { ...manifest, filepath, filename };
}

/**
 * Remove apenas dados de negócio/demo. Preserva users, settings keys, schema_migrations, backup_history.
 */
function purgeDemoBusinessData(db) {
  const before = {
    products: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
    customers: db.prepare('SELECT COUNT(*) AS c FROM customers').get().c,
    sales: db.prepare('SELECT COUNT(*) AS c FROM sales').get().c,
    suppliers: db.prepare('SELECT COUNT(*) AS c FROM suppliers').get().c,
  };
  db.exec(`
    DELETE FROM credit_payments;
    DELETE FROM credit_installments;
    DELETE FROM credit_accounts;
    DELETE FROM return_items;
    DELETE FROM returns;
    DELETE FROM delivery_history;
    DELETE FROM deliveries;
    DELETE FROM purchase_items;
    DELETE FROM purchases;
    DELETE FROM sale_payments;
    DELETE FROM sale_items;
    DELETE FROM sales;
    DELETE FROM stock_movements;
    DELETE FROM cash_movements;
    DELETE FROM cash_sessions;
    DELETE FROM products;
    DELETE FROM customers;
    DELETE FROM suppliers;
    DELETE FROM audit_logs;
  `);
  // reset autoincrement where helpful
  try {
    db.exec(`
      DELETE FROM sqlite_sequence WHERE name IN (
        'products','customers','suppliers','sales','sale_items','sale_payments',
        'stock_movements','cash_sessions','cash_movements','purchases','purchase_items',
        'credit_accounts','credit_installments','credit_payments','returns','return_items',
        'deliveries','delivery_history','audit_logs'
      );
    `);
  } catch {
    /* sqlite_sequence may not exist */
  }
  return before;
}

export function importOncasPdvV2Real(jsonPath, { reportPath = null, confirm = false } = {}) {
  if (!confirm) {
    throw new Error('Importação definitiva requer confirm=true');
  }
  if (!existsSync(jsonPath)) {
    throw new Error(`JSON não encontrado: ${jsonPath}`);
  }

  const started = Date.now();
  const buf = readFileSync(jsonPath);
  const sha256 = sha256Buffer(buf);
  const data = JSON.parse(buf.toString('utf8'));
  if (!matchesOncasPdvV2(data)) {
    throw new Error('JSON não corresponde ao adaptador oncas_pdv_v2');
  }

  const model = toOncasPdvV2Model(data);
  const preview = buildOncasPreview(model, {
    source_sha256: sha256,
    source_filename: jsonPath.split('/').pop(),
    source_size_bytes: buf.length,
  });

  // Fechar singleton do app se aberto
  try {
    closeDb();
  } catch {
    /* ignore */
  }

  const dbPath = getDbPath();
  const safety = createSafetyBackup(dbPath);

  // Abre o banco principal com migrations (singleton do app)
  const db = openDatabase(dbPath);
  setDb(db);

  const pre = preflight(db);
  if (!pre.ok) {
    db.close();
    closeDb();
    throw new Error(
      `Integridade pré-importação falhou: integrity=${pre.integrity_check} fk=${pre.foreign_key_violations}`
    );
  }

  const report = {
    mode: 'PRODUCTION_IMPORT',
    authorized: true,
    adapter: model.adapter,
    adapter_version: model.adapter_version,
    source: {
      path: jsonPath,
      sha256,
      size_bytes: buf.length,
      backup_meta: model.backup_meta,
    },
    safety_backup: safety,
    preflight: pre,
    demo_purge: null,
    before_json: {
      products: (data.products || []).length,
      customers: (data.customers || []).length,
      sales: (data.sales || []).length,
      sale_items: (data.sales || []).reduce((a, s) => a + (s.items?.length || 0), 0),
      stock_movements: (data.stockMovements || []).length,
      suppliers: (data.suppliers || []).length,
      receivables: (data.receivables || []).length,
      purchases: (data.purchases || []).length,
      deliveries: (data.deliveries || []).length,
      returns: (data.returns || []).length,
      cash_history: (data.cash?.history || []).length,
    },
    preview,
    imported: {
      products: 0,
      customers: 0,
      sales: 0,
      sale_items: 0,
      sale_payments: 0,
      stock_movements: 0,
      cash_sessions: 0,
      settings: 0,
      suppliers: 0,
      credit: 0,
      purchases: 0,
      deliveries: 0,
      returns: 0,
    },
    ignored: { products: 0, customers: 0, sales: 0, stock_movements: 0 },
    duplicated: { products: model.duplicates.products.length, customers: 0, sales: 0 },
    conflicts: model.duplicates.products.slice(0, 50),
    converted: { money_fields: 0 },
    errors: [],
    warnings: model.warnings,
    unknown_fields: model.unknown_fields,
    finance: {},
    stock: {},
    after_db: {},
    validation: {},
    elapsed_ms: 0,
  };

  const productIdByLegacy = new Map();
  const customerIdByLegacy = new Map();

  try {
    const tx = db.transaction(() => {
      report.demo_purge = purgeDemoBusinessData(db);

      // settings da empresa real
      for (const [key, value] of Object.entries(model.settings || {})) {
        db.prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        ).run(key, String(value ?? ''));
        report.imported.settings += 1;
      }

      for (const p of model.products) {
        const info = db
          .prepare(
            `INSERT INTO products (
               sku, barcode, name, category, unit, price_cents, cost_cents, stock_qty, min_stock_qty,
               allow_negative_stock, active, legacy_id, legacy_source
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            p.sku,
            p.barcode,
            p.name,
            p.category,
            p.unit,
            p.price_cents,
            p.cost_cents,
            p.stock_qty,
            p.min_stock_qty,
            p.allow_negative_stock,
            p.active,
            p.legacy_id,
            p.legacy_source
          );
        productIdByLegacy.set(p.legacy_id, Number(info.lastInsertRowid));
        report.imported.products += 1;
        report.converted.money_fields += 2;
      }

      for (const c of model.customers) {
        const info = db
          .prepare(
            `INSERT INTO customers (name, document, phone, whatsapp, active, legacy_id, legacy_source)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(c.name, c.document, c.phone, c.whatsapp, c.active, c.legacy_id, c.legacy_source);
        customerIdByLegacy.set(c.legacy_id, Number(info.lastInsertRowid));
        report.imported.customers += 1;
      }

      for (const sale of model.sales) {
        const saleNumber = `LEG-${sale.legacy_id}`.slice(0, 40);
        let customerId = sale.customer_legacy_id
          ? customerIdByLegacy.get(String(sale.customer_legacy_id)) || null
          : null;
        const info = db
          .prepare(
            `INSERT INTO sales (
               sale_number, status, subtotal_cents, discount_cents, total_cents, notes,
               customer_id, legacy_id, legacy_source, created_at
             ) VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
          )
          .run(
            saleNumber,
            sale.subtotal_cents,
            sale.discount_cents,
            sale.total_cents,
            sale.notes,
            customerId,
            sale.legacy_id,
            sale.legacy_source,
            sale.created_at
          );
        const saleId = Number(info.lastInsertRowid);

        for (const it of sale.items || []) {
          const productId = it.product_legacy_id
            ? productIdByLegacy.get(String(it.product_legacy_id)) || null
            : null;
          const isMisc = it.is_misc || !productId ? 1 : 0;
          const line = it.unit_price_cents * it.quantity;
          db.prepare(
            `INSERT INTO sale_items (
               sale_id, product_id, name, barcode, unit_price_cents, quantity, discount_cents, line_total_cents, is_misc
             ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
          ).run(
            saleId,
            isMisc ? null : productId,
            it.name,
            it.barcode,
            it.unit_price_cents,
            it.quantity,
            line,
            isMisc
          );
          report.imported.sale_items += 1;
          report.converted.money_fields += 1;
        }

        db.prepare(`INSERT INTO sale_payments (sale_id, method, amount_cents) VALUES (?, ?, ?)`).run(
          saleId,
          sale.payment_method === 'crediario' ? 'dinheiro' : sale.payment_method,
          sale.total_cents
        );
        report.imported.sale_payments += 1;
        report.imported.sales += 1;
        report.converted.money_fields += 1;
      }

      for (const m of model.stock_movements) {
        const productId = m.product_legacy_id
          ? productIdByLegacy.get(String(m.product_legacy_id)) || null
          : null;
        if (!productId) {
          report.ignored.stock_movements += 1;
          continue;
        }
        const stockAfter = Number.isFinite(Number(m.after))
          ? Math.trunc(Number(m.after))
          : db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(productId).stock_qty;
        db.prepare(
          `INSERT INTO stock_movements (
             product_id, movement_type, quantity_delta, stock_after, reason, user_name,
             reference_type, reference_id, note, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'legacy_import', NULL, ?, COALESCE(?, datetime('now')))`
        ).run(
          productId,
          mapMoveType(m.type_raw, m.quantity_delta),
          m.quantity_delta,
          stockAfter,
          m.reason,
          'import_real',
          `legado:${m.type_raw};ref=${m.reference || ''}`,
          m.created_at
        );
        report.imported.stock_movements += 1;
      }

      for (const cs of model.cash_sessions) {
        db.prepare(
          `INSERT INTO cash_sessions (
             terminal_id, operator_name, status, opening_amount_cents, opened_at, closed_at,
             sales_total_cents, expected_amount_cents, counted_amount_cents, difference_cents, close_notes
           ) VALUES ('TERM-1', ?, 'closed', ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?)`
        ).run(
          cs.operator_name,
          cs.opening_amount_cents,
          cs.opened_at,
          cs.closed_at,
          cs.sales_total_cents,
          cs.expected_amount_cents,
          cs.counted_amount_cents,
          cs.difference_cents,
          cs.close_notes
        );
        report.imported.cash_sessions += 1;
      }

      // registrar import_run + audit
      const run = db
        .prepare(
          `INSERT INTO import_runs (
             source_filename, source_sha256, importer_version, status, preview_json, report_json,
             unknown_fields_json, started_at, finished_at, created_by
           ) VALUES (?, ?, ?, 'completed', ?, ?, ?, datetime('now'), datetime('now'), ?)`
        )
        .run(
          jsonPath.split('/').pop(),
          sha256,
          model.adapter_version,
          JSON.stringify(preview),
          null,
          JSON.stringify(model.unknown_fields),
          'import_autorizado'
        );
      report.import_run_id = Number(run.lastInsertRowid);

      db.prepare(
        `INSERT INTO audit_logs (action, entity_type, entity_id, details, user_name, result)
         VALUES ('import.legacy_json_real', 'import_run', ?, ?, 'import_autorizado', 'ok')`
      ).run(
        report.import_run_id,
        JSON.stringify({
          sha256,
          safety_backup: safety.filename,
          imported: report.imported,
          adapter: LEGACY_SOURCE,
        })
      );

      // registrar backup_history do safety
      db.prepare(
        `INSERT INTO backup_history (
           filename, filepath, size_bytes, sha256, app_version, db_schema_version, kind, created_by, notes, valid
         ) VALUES (?, ?, ?, ?, ?, ?, 'pre_import', ?, ?, 1)`
      ).run(
        safety.filename,
        safety.filepath,
        safety.size_bytes,
        safety.sha256,
        '0.4.0',
        '011_etapa4_core.sql',
        'import_autorizado',
        'Backup automático antes da importação do JSON real'
      );
    });

    tx();

    const salesTotalDb = db
      .prepare(`SELECT COALESCE(SUM(total_cents),0) AS t FROM sales WHERE status='completed'`)
      .get().t;
    const salesTotalJson = model.sales.reduce((a, s) => a + s.total_cents, 0);
    const stockSumDb = db.prepare(`SELECT COALESCE(SUM(stock_qty),0) AS t FROM products`).get().t;
    const stockSumJson = model.products.reduce((a, p) => a + p.stock_qty, 0);
    const negForbidden = db
      .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock = 0`)
      .get().c;
    const negAllowed = db
      .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock = 1`)
      .get().c;
    const post = preflight(db);

    // sample product name checks
    const sampleNames = (data.products || []).slice(0, 5).map((p) => p.name);
    const nameMatches = sampleNames.map((name) => ({
      name,
      found: !!db.prepare('SELECT id FROM products WHERE name = ?').get(name),
    }));

    report.finance = {
      json_sales_total_cents: salesTotalJson,
      db_sales_total_cents: salesTotalDb,
      sales_total_match: salesTotalJson === salesTotalDb,
      json_sales_total_brl: (salesTotalJson / 100).toFixed(2),
      crediario_accounts: db.prepare('SELECT COUNT(*) AS c FROM credit_accounts').get().c,
      receivables_json: (data.receivables || []).length,
    };
    report.stock = {
      json_stock_sum: stockSumJson,
      db_stock_sum: stockSumDb,
      stock_sum_match: stockSumJson === stockSumDb,
      zero: db.prepare('SELECT COUNT(*) AS c FROM products WHERE stock_qty = 0').get().c,
      negative_allowed: negAllowed,
      negative_forbidden: negForbidden,
    };
    report.after_db = {
      products: db.prepare('SELECT COUNT(*) AS c FROM products').get().c,
      customers: db.prepare('SELECT COUNT(*) AS c FROM customers').get().c,
      sales: db.prepare('SELECT COUNT(*) AS c FROM sales').get().c,
      sale_items: db.prepare('SELECT COUNT(*) AS c FROM sale_items').get().c,
      sale_payments: db.prepare('SELECT COUNT(*) AS c FROM sale_payments').get().c,
      stock_movements: db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c,
      cash_sessions: db.prepare('SELECT COUNT(*) AS c FROM cash_sessions').get().c,
      suppliers: db.prepare('SELECT COUNT(*) AS c FROM suppliers').get().c,
      credit_accounts: db.prepare('SELECT COUNT(*) AS c FROM credit_accounts').get().c,
      users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
      legacy_products: db
        .prepare(`SELECT COUNT(*) AS c FROM products WHERE legacy_source = ?`)
        .get(LEGACY_SOURCE).c,
    };
    report.sample_name_checks = nameMatches;
    report.validation = {
      ok:
        post.ok &&
        negForbidden === 0 &&
        report.finance.sales_total_match &&
        report.stock.stock_sum_match &&
        report.errors.length === 0 &&
        report.after_db.products === report.before_json.products &&
        report.after_db.customers === report.before_json.customers &&
        report.after_db.sales === report.before_json.sales &&
        report.after_db.sale_items === report.before_json.sale_items &&
        report.after_db.legacy_products === report.before_json.products &&
        nameMatches.every((n) => n.found),
      integrity_check: post.integrity_check,
      foreign_key_violations: post.foreign_key_violations,
      orphan_sale_items: db
        .prepare(
          `SELECT COUNT(*) AS c FROM sale_items si LEFT JOIN sales s ON s.id = si.sale_id WHERE s.id IS NULL`
        )
        .get().c,
    };

    // update import_runs report_json
    db.prepare(`UPDATE import_runs SET report_json = ? WHERE id = ?`).run(
      JSON.stringify({
        imported: report.imported,
        finance: report.finance,
        stock: report.stock,
        validation: report.validation,
      }),
      report.import_run_id
    );

    report.elapsed_ms = Date.now() - started;
    if (reportPath) {
      mkdirSync(join(reportPath, '..'), { recursive: true });
      writeFileSync(reportPath, JSON.stringify(report, null, 2));
    }
    return report;
  } catch (err) {
    report.errors.push({ fatal: String(err.message || err) });
    report.elapsed_ms = Date.now() - started;
    report.validation = { ok: false, error: String(err.message || err) };
    if (reportPath) {
      try {
        writeFileSync(reportPath, JSON.stringify(report, null, 2));
      } catch {
        /* ignore */
      }
    }
    throw err;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    closeDb();
  }
}
