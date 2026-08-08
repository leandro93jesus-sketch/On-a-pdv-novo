/**
 * Simulação de importação do backup Oncas PDV v2 em banco TEMPORÁRIO.
 * NÃO toca o banco principal (server/data/onca-pdv.db).
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runMigrations } from '../../db/migrate.js';
import { matchesOncasPdvV2, toOncasPdvV2Model, buildOncasPreview, LEGACY_SOURCE } from './mapOncasPdvV2.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
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

/**
 * @param {string} jsonPath caminho do JSON real (somente leitura)
 * @param {{ reportPath?: string }} [opts]
 */
export function simulateOncasPdvV2Import(jsonPath, opts = {}) {
  const started = Date.now();
  const buf = readFileSync(jsonPath);
  const sha256 = createHash('sha256').update(buf).digest('hex');
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

  const tmp = mkdtempSync(join(tmpdir(), 'onca-sim-4b-'));
  const dbPath = join(tmp, 'simulate.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);

  const report = {
    mode: 'SIMULATION_ONLY',
    adapter: model.adapter,
    adapter_version: model.adapter_version,
    source: {
      path: jsonPath,
      sha256,
      size_bytes: buf.length,
      backup_meta: model.backup_meta,
    },
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
    },
    ignored: { products: 0, customers: 0, sales: 0, stock_movements: 0 },
    duplicated: { products: 0, customers: 0, sales: 0 },
    converted: { money_fields: 0 },
    errors: [],
    warnings: model.warnings,
    unknown_fields: model.unknown_fields,
    invalid: model.invalid,
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
      // settings
      for (const [key, value] of Object.entries(model.settings || {})) {
        db.prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        ).run(key, String(value ?? ''));
        report.imported.settings += 1;
      }

      // products
      for (const p of model.products) {
        try {
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
        } catch (err) {
          report.errors.push({ entity: 'product', legacy_id: p.legacy_id, error: err.message });
          report.ignored.products += 1;
        }
      }
      report.duplicated.products = model.duplicates.products.length;

      // customers
      for (const c of model.customers) {
        try {
          const info = db
            .prepare(
              `INSERT INTO customers (name, document, phone, whatsapp, active, legacy_id, legacy_source)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              c.name,
              c.document,
              c.phone,
              c.whatsapp,
              c.active,
              c.legacy_id,
              c.legacy_source
            );
          customerIdByLegacy.set(c.legacy_id, Number(info.lastInsertRowid));
          report.imported.customers += 1;
        } catch (err) {
          report.errors.push({ entity: 'customer', legacy_id: c.legacy_id, error: err.message });
          report.ignored.customers += 1;
        }
      }

      // sales (histórico — NÃO altera estoque)
      for (const sale of model.sales) {
        try {
          const saleNumber = `LEG-${sale.legacy_id}`.slice(0, 40);
          let customerId = sale.customer_legacy_id
            ? customerIdByLegacy.get(String(sale.customer_legacy_id)) || null
            : null;
          // Consumidor Final pode ficar null
          if (sale.customer_legacy_id === '0') customerId = customerIdByLegacy.get('0') || null;

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
        } catch (err) {
          report.errors.push({ entity: 'sale', legacy_id: sale.legacy_id, error: err.message });
          report.ignored.sales += 1;
        }
      }

      // stock movements as history only
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
             product_id, movement_type, quantity_delta, stock_after, reason, user_name, reference_type, reference_id, note, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'legacy_import', NULL, ?, COALESCE(?, datetime('now')))`
        ).run(
          productId,
          mapMoveType(m.type_raw, m.quantity_delta),
          m.quantity_delta,
          stockAfter,
          m.reason,
          'import_sim',
          `legado:${m.type_raw};ref=${m.reference || ''}`,
          m.created_at
        );
        report.imported.stock_movements += 1;
      }

      // cash sessions closed
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
    });

    tx();

    // comparisons / validation
    const salesTotalDb = db
      .prepare(`SELECT COALESCE(SUM(total_cents),0) AS t FROM sales WHERE status='completed'`)
      .get().t;
    const salesTotalJson = model.sales.reduce((a, s) => a + s.total_cents, 0);
    const stockSumDb = db.prepare(`SELECT COALESCE(SUM(stock_qty),0) AS t FROM products`).get().t;
    const stockSumJson = model.products.reduce((a, p) => a + p.stock_qty, 0);
    const negDb = db
      .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock = 0`)
      .get().c;
    const negAllowed = db
      .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock = 1`)
      .get().c;

    db.pragma('foreign_keys = ON');
    const integrity = db.pragma('integrity_check')[0]?.integrity_check;
    const fk = db.pragma('foreign_key_check');

    report.finance = {
      json_sales_total_cents: salesTotalJson,
      db_sales_total_cents: salesTotalDb,
      sales_total_match: salesTotalJson === salesTotalDb,
      json_sales_total_brl: (salesTotalJson / 100).toFixed(2),
      crediario_aberto_cents: 0,
      receivables_json: (data.receivables || []).length,
    };
    report.stock = {
      json_stock_sum: stockSumJson,
      db_stock_sum: stockSumDb,
      stock_sum_match: stockSumJson === stockSumDb,
      negative_allowed: negAllowed,
      negative_forbidden: negDb,
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
    };
    report.validation = {
      ok:
        integrity === 'ok' &&
        fk.length === 0 &&
        negDb === 0 &&
        report.finance.sales_total_match &&
        report.stock.stock_sum_match &&
        report.errors.length === 0 &&
        report.after_db.products === report.before_json.products &&
        report.after_db.customers === report.before_json.customers &&
        report.after_db.sales === report.before_json.sales,
      integrity_check: integrity,
      foreign_key_violations: fk.length,
      orphan_sale_items: db
        .prepare(
          `SELECT COUNT(*) AS c FROM sale_items si LEFT JOIN sales s ON s.id = si.sale_id WHERE s.id IS NULL`
        )
        .get().c,
    };
  } finally {
    db.close();
    report.elapsed_ms = Date.now() - started;
    report.temp_db_path = dbPath;
    report.temp_dir = tmp;
    // Keep temp DB for inspection unless asked to clean — write report then remove dir contents optionally
    if (opts.reportPath) {
      writeFileSync(opts.reportPath, JSON.stringify(report, null, 2));
    }
    if (opts.cleanup) {
      try {
        rmSync(tmp, { recursive: true, force: true });
        report.temp_db_path = '(removed)';
      } catch {
        /* ignore */
      }
    }
  }

  return report;
}

export function analyzeOncasPdvV2File(jsonPath) {
  const buf = readFileSync(jsonPath);
  const data = JSON.parse(buf.toString('utf8'));
  const model = toOncasPdvV2Model(data);
  return {
    sha256: sha256File(jsonPath),
    size_bytes: buf.length,
    matches: matchesOncasPdvV2(data),
    preview: buildOncasPreview(model),
    unknown_fields: model.unknown_fields,
    duplicates: model.duplicates,
    warnings: model.warnings.slice(0, 50),
    invalid: model.invalid,
  };
}
