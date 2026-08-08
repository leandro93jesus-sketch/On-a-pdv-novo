#!/usr/bin/env node
/**
 * Remove apenas registros comprovadamente criados por reviews (Produto Review / Cliente Review),
 * sem tocar em legacy oncas_pdv_v2.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.PDV_DB_PATH || resolve(root, 'server/data/onca-pdv.db');

const db = new Database(DB);
db.pragma('foreign_keys = ON');

const removed = { products: [], customers: [], blocked: [] };

const reviewProducts = db
  .prepare(
    `SELECT id, sku, name, legacy_source FROM products
     WHERE (name LIKE '%Review%' OR sku LIKE 'RV-%')
       AND COALESCE(legacy_source,'') != 'oncas_pdv_v2'`
  )
  .all();

const reviewCustomers = db
  .prepare(
    `SELECT id, name, document, legacy_source FROM customers
     WHERE (name LIKE 'Cliente Review%' OR name LIKE '%Review%')
       AND COALESCE(legacy_source,'') != 'oncas_pdv_v2'`
  )
  .all();

const tx = db.transaction(() => {
  for (const p of reviewProducts) {
    const saleUses = db.prepare('SELECT COUNT(*) c FROM sale_items WHERE product_id=?').get(p.id).c;
    const purchaseUses = db.prepare('SELECT COUNT(*) c FROM purchase_items WHERE product_id=?').get(p.id).c;
    const returnUses = db.prepare('SELECT COUNT(*) c FROM return_items WHERE product_id=?').get(p.id).c;
    if (saleUses || purchaseUses || returnUses) {
      // inativa em vez de apagar histórico
      db.prepare(`UPDATE products SET active=0, name=name || ' [TESTE-INATIVO]', updated_at=datetime('now') WHERE id=?`).run(p.id);
      removed.blocked.push({ type: 'product', ...p, action: 'inactivated', saleUses, purchaseUses, returnUses });
    } else {
      db.prepare('DELETE FROM stock_movements WHERE product_id=?').run(p.id);
      db.prepare('DELETE FROM products WHERE id=?').run(p.id);
      removed.products.push(p);
    }
  }

  for (const c of reviewCustomers) {
    const sales = db.prepare('SELECT COUNT(*) c FROM sales WHERE customer_id=?').get(c.id).c;
    const credit = db.prepare('SELECT COUNT(*) c FROM credit_accounts WHERE customer_id=?').get(c.id).c;
    const deliveries = db.prepare('SELECT COUNT(*) c FROM deliveries WHERE customer_id=?').get(c.id).c;
    if (sales || credit || deliveries) {
      db.prepare(
        `UPDATE customers SET active=0, name=name || ' [TESTE-INATIVO]', updated_at=datetime('now') WHERE id=?`
      ).run(c.id);
      removed.blocked.push({ type: 'customer', ...c, action: 'inactivated', sales, credit, deliveries });
    } else {
      db.prepare('DELETE FROM customers WHERE id=?').run(c.id);
      removed.customers.push(c);
    }
  }
});

tx();

const report = {
  kind: 'etapa5_purge_review_data',
  created_at: new Date().toISOString(),
  removed,
  preserved_counts: {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    products_legacy: db
      .prepare(`SELECT COUNT(*) c FROM products WHERE legacy_source='oncas_pdv_v2'`)
      .get().c,
    customers: db.prepare('SELECT COUNT(*) c FROM customers').get().c,
    customers_legacy: db
      .prepare(`SELECT COUNT(*) c FROM customers WHERE legacy_source='oncas_pdv_v2'`)
      .get().c,
    sales_legacy: db
      .prepare(`SELECT COUNT(*) c FROM sales WHERE legacy_source='oncas_pdv_v2'`)
      .get().c,
  },
  integrity: db.pragma('integrity_check')[0].integrity_check,
  fk: db.pragma('foreign_key_check').length,
};

const outDir = resolve(root, 'docs/reports');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'ETAPA5-PURGE-REVIEW.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
db.close();
if (report.integrity !== 'ok' || report.fk !== 0) process.exit(1);
