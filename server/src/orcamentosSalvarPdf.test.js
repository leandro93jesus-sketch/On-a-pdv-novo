import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-quotes-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { runMigrations } = await import('./db/migrate.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');

let server;
let baseUrl;
let token;
let seq = 0;

async function api(method, path, body, auth = token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function product(name, stock = 10, price = 1000, barcode) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: barcode || `977${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `Q-${seq}-${Date.now()}`,
    price_cents: price,
    stock_qty: stock,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

before(async () => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  runMigrations(db);
  ensureBootstrapAdmin();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('orçamento salva sem alterar estoque nem caixa', async () => {
  const a = await product('Detergente A', 5, 1000);
  const b = await product('Detergente B', 0, 2000);
  const stockBefore = getDb()
    .prepare('SELECT id, stock_qty FROM products WHERE id IN (?, ?)')
    .all(a.id, b.id);
  const cashBefore = getDb().prepare('SELECT COUNT(*) AS c FROM cash_movements').get().c;
  const salesBefore = getDb().prepare('SELECT COUNT(*) AS c FROM sales').get().c;

  const created = await api('POST', '/api/quotes', {
    customer_name: 'CLIENTE TESTE',
    customer_phone: '11999990000',
    valid_until: '2099-12-31',
    discount_cents: 100,
    notes: 'Orçamento de teste',
    items: [
      { product_id: a.id, quantity: 2 },
      { product_id: b.id, quantity: 3 },
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.match(created.json.quote_number, /^ORC-\d{6}$/);
  assert.equal(created.json.total_cents, 2 * 1000 + 3 * 2000 - 100);
  assert.equal(created.json.status, 'aberto');

  const stockAfter = getDb()
    .prepare('SELECT id, stock_qty FROM products WHERE id IN (?, ?)')
    .all(a.id, b.id);
  assert.deepEqual(
    stockAfter.map((r) => r.stock_qty).sort(),
    stockBefore.map((r) => r.stock_qty).sort()
  );
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM cash_movements').get().c, cashBefore);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM sales').get().c, salesBefore);

  const pdf = await api('POST', `/api/receipts/quotes/${created.json.id}/pdf`, { force: true });
  assert.equal(pdf.status, 200, JSON.stringify(pdf.json));
  assert.ok(pdf.json.filename.startsWith('ONCA-ORCAMENTO-'));
  assert.ok(existsSync(pdf.json.absolute_path));

  // PDF não altera estoque
  assert.equal(
    getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(a.id).stock_qty,
    5
  );
});

test('conversão bloqueia segunda vez; payload não cria venda', async () => {
  const p = await product('Item Conv', 20, 500);
  const q = await api('POST', '/api/quotes', {
    customer_name: 'Conv',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(q.status, 201);
  const payload = await api('GET', `/api/quotes/${q.json.id}/conversion-payload`);
  assert.equal(payload.status, 200);
  assert.equal(payload.json.items.length, 1);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM sales').get().c, 0);

  await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Administrador',
    opening_amount_cents: 1000,
  });
  const sale = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  const marked = await api('POST', `/api/quotes/${q.json.id}/mark-converted`, {
    sale_id: sale.json.id,
  });
  assert.equal(marked.status, 200);
  assert.equal(marked.json.status, 'convertido');

  const again = await api('GET', `/api/quotes/${q.json.id}/conversion-payload`);
  assert.equal(again.status, 409);
});

test('PDF de venda e crediário não alteram totais', async () => {
  const p = await product('PdfProd', 8, 1500);
  const stock = getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(p.id).stock_qty;
  const sale = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  const pdf = await api('POST', `/api/receipts/sales/${sale.json.id}/pdf`, { force: true });
  assert.equal(pdf.status, 200);
  assert.ok(pdf.json.filename.startsWith('ONCA-VENDA-'));
  assert.equal(
    getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(p.id).stock_qty,
    stock - 1
  );
});
