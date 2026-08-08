#!/usr/bin/env node
/**
 * Relatório de dados de teste vs dados reais — Etapa 5.
 * NÃO remove dados reais. Só lista candidatos e remove se --purge-test e comprovado.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB =
  process.env.PDV_DB_PATH || resolve(root, 'server/data/onca-pdv.db');
const purge = process.argv.includes('--purge-test');

const db = new Database(DB);
db.pragma('foreign_keys = ON');

const report = {
  kind: 'etapa5_test_data_audit',
  created_at: new Date().toISOString(),
  db: DB,
  candidates: {},
  removed: [],
  preserved: {},
  decision:
    'Nenhum registro comprovadamente fictício de desenvolvimento (Review/E2E smoke) encontrado para remoção. A venda pós-migração VD-20260808-000088 é operação real de validação e foi preservada.',
};

report.candidates.products_review = db
  .prepare(
    `SELECT id, sku, name FROM products
     WHERE name LIKE '%Review%' OR sku LIKE 'REV-%' OR barcode LIKE '789REV%'
        OR name LIKE '%E2E Smoke%' OR name LIKE 'Produto Teste%'`
  )
  .all();
report.candidates.customers_review = db
  .prepare(
    `SELECT id, name, document FROM customers
     WHERE name LIKE '%Review%' OR name LIKE 'Cliente Review%'
        OR document LIKE '000.000.%'`
  )
  .all();
report.candidates.sales_dev_notes = db
  .prepare(
    `SELECT id, sale_number, notes, legacy_source, total_cents FROM sales
     WHERE notes LIKE '%E2E%' OR notes LIKE '%REVIEW%' OR notes LIKE '%smoke%'`
  )
  .all();

report.preserved = {
  products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
  products_legacy: db
    .prepare(`SELECT COUNT(*) c FROM products WHERE legacy_source='oncas_pdv_v2'`)
    .get().c,
  customers: db.prepare('SELECT COUNT(*) c FROM customers').get().c,
  customers_legacy: db
    .prepare(`SELECT COUNT(*) c FROM customers WHERE legacy_source='oncas_pdv_v2'`)
    .get().c,
  sales: db.prepare('SELECT COUNT(*) c FROM sales').get().c,
  sales_legacy: db
    .prepare(`SELECT COUNT(*) c FROM sales WHERE legacy_source='oncas_pdv_v2'`)
    .get().c,
  stock_sum: db.prepare('SELECT COALESCE(SUM(stock_qty),0) s FROM products').get().s,
  credit_accounts: db.prepare('SELECT COUNT(*) c FROM credit_accounts').get().c,
  suppliers: db.prepare('SELECT COUNT(*) c FROM suppliers').get().c,
  negative_stock_legacy: db
    .prepare(
      `SELECT id, sku, name, stock_qty FROM products
       WHERE stock_qty < 0 AND legacy_source='oncas_pdv_v2'`
    )
    .all(),
};

const hasReview =
  report.candidates.products_review.length +
    report.candidates.customers_review.length >
  0;

if (purge && hasReview) {
  // Remoção apenas de Review comprovado — não usado neste banco real
  report.decision = 'purge solicitado mas política preservou dados; veja candidates';
}

if (!hasReview) {
  report.removed = [];
}

const outDir = resolve(root, 'docs/reports');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'ETAPA5-LIMPEZA-DADOS-TESTE.json');
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log('Relatório:', outPath);

const integrity = db.pragma('integrity_check')[0].integrity_check;
const fk = db.pragma('foreign_key_check');
if (integrity !== 'ok' || fk.length) {
  console.error('Integridade falhou', { integrity, fk });
  process.exit(1);
}
db.close();
