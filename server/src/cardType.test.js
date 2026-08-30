import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'onca-card-type-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'test.db');
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { openCashSession } = await import('./services/cashService.js');
const { runMigrations } = await import('./db/migrate.js');

let server;
let baseUrl;
let db;

function insertProduct(overrides = {}) {
  const info = db
    .prepare(
      `INSERT INTO products (sku, barcode, name, category, price_cents, cost_cents, stock_qty, min_stock_qty, allow_negative_stock, active)
       VALUES (@sku, @barcode, @name, @category, @price_cents, @cost_cents, @stock_qty, @min_stock_qty, @allow_negative_stock, 1)`
    )
    .run({
      sku: overrides.sku ?? `SKU-${Math.random().toString(36).slice(2, 8)}`,
      barcode: overrides.barcode ?? null,
      name: overrides.name ?? 'Produto Cartão',
      category: overrides.category ?? 'Teste',
      price_cents: overrides.price_cents ?? 1500,
      cost_cents: overrides.cost_cents ?? 500,
      stock_qty: overrides.stock_qty ?? 20,
      min_stock_qty: overrides.min_stock_qty ?? 0,
      allow_negative_stock: overrides.allow_negative_stock ?? 0,
    });
  return Number(info.lastInsertRowid);
}

async function postSale(body) {
  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

before(async () => {
  db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  openCashSession({ terminal_id: 'TERM-1', operator_name: 'tester', opening_amount_cents: 10000 });
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('venda cartão exige CREDIT ou DEBIT', async () => {
  const productId = insertProduct();
  const missing = await postSale({
    payment_method: 'cartao',
    items: [{ product_id: productId, quantity: 1 }],
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.json.code, 'CARD_TYPE_REQUIRED');

  const bad = await postSale({
    payment_method: 'cartao',
    card_type: 'VOUCHER',
    items: [{ product_id: productId, quantity: 1 }],
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'INVALID_CARD_TYPE');
});

test('nova venda cartão crédito e débito persistem card_type', async () => {
  const pCredit = insertProduct({ name: 'Item Crédito' });
  const credit = await postSale({
    payment_method: 'cartao',
    card_type: 'CREDIT',
    items: [{ product_id: pCredit, quantity: 1 }],
  });
  assert.equal(credit.status, 201);
  assert.equal(credit.json.payment_method, 'cartao_credito');
  assert.equal(credit.json.payments[0].method, 'cartao');
  assert.equal(credit.json.payments[0].card_type, 'CREDIT');

  const pDebit = insertProduct({ name: 'Item Débito' });
  const debit = await postSale({
    payment_method: 'cartao',
    card_type: 'DEBIT',
    items: [{ product_id: pDebit, quantity: 1 }],
  });
  assert.equal(debit.status, 201);
  assert.equal(debit.json.payment_method, 'cartao_debito');
  assert.equal(debit.json.payments[0].card_type, 'DEBIT');

  const list = await fetch(`${baseUrl}/api/sales?limit=20`).then((r) => r.json());
  const foundCredit = list.find((s) => s.id === credit.json.id);
  const foundDebit = list.find((s) => s.id === debit.json.id);
  assert.equal(foundCredit.payment_method, 'cartao_credito');
  assert.equal(foundDebit.payment_method, 'cartao_debito');
});

test('vendas antigas com cartão NULL continuam como CARTÃO', async () => {
  const productId = insertProduct({ name: 'Legado Cartão' });
  const saleInfo = db
    .prepare(
      `INSERT INTO sales (sale_number, status, subtotal_cents, discount_cents, total_cents, amount_received_cents, change_cents, cash_session_id)
       VALUES ('VD-LEGACY-CARD', 'completed', 1000, 0, 1000, 0, 0, (SELECT id FROM cash_sessions WHERE status='open' LIMIT 1))`
    )
    .run();
  const saleId = Number(saleInfo.lastInsertRowid);
  db.prepare(
    `INSERT INTO sale_items (sale_id, product_id, name, unit_price_cents, quantity, discount_cents, line_total_cents, is_misc)
     VALUES (?, ?, 'Legado Cartão', 1000, 1, 0, 1000, 0)`
  ).run(saleId, productId);
  db.prepare(
    `INSERT INTO sale_payments (sale_id, method, amount_cents, card_type) VALUES (?, 'cartao', 1000, NULL)`
  ).run(saleId);

  const res = await fetch(`${baseUrl}/api/sales/${saleId}`).then((r) => r.json());
  assert.equal(res.payment_method, 'cartao');
  assert.equal(res.payments[0].card_type, null);
});

// Backup real do cliente (server/data não é versionado). Sem ele o teste pula em
// vez de reprovar: em máquina com o banco real presente ele roda normalmente.
const REAL_BACKUP = join(
  __dirname,
  '../data/backups/onca-pdv-backup-pre-card-type-20260811T221620Z.db'
);

test('migration 021 no banco real (cópia) preserva dados e NULL em cartões antigos', {
  skip: existsSync(REAL_BACKUP) ? false : `backup real ausente (${REAL_BACKUP})`,
}, () => {
  const backup = REAL_BACKUP;
  const copy = join(tmp, 'compat-real.db');
  copyFileSync(backup, copy);
  const real = new Database(copy);
  real.pragma('foreign_keys = ON');
  const before = {
    products: real.prepare('SELECT COUNT(*) AS c FROM products').get().c,
    customers: real.prepare('SELECT COUNT(*) AS c FROM customers').get().c,
    sales: real.prepare('SELECT COUNT(*) AS c FROM sales').get().c,
    cartao: real.prepare(`SELECT COUNT(*) AS c FROM sale_payments WHERE method='cartao'`).get().c,
  };
  runMigrations(real);
  const cols = real.prepare('PRAGMA table_info(sale_payments)').all().map((c) => c.name);
  assert.ok(cols.includes('card_type'));
  assert.equal(real.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.equal(real.pragma('foreign_key_check').length, 0);
  assert.equal(real.prepare('SELECT COUNT(*) AS c FROM products').get().c, before.products);
  assert.equal(real.prepare('SELECT COUNT(*) AS c FROM customers').get().c, before.customers);
  assert.equal(real.prepare('SELECT COUNT(*) AS c FROM sales').get().c, before.sales);
  assert.equal(
    real
      .prepare(`SELECT COUNT(*) AS c FROM sale_payments WHERE method='cartao' AND card_type IS NULL`)
      .get().c,
    before.cartao
  );
  real.close();
});
