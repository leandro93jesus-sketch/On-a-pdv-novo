import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-troco-prod-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { runMigrations } = await import('./db/migrate.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { getProductByBarcode } = await import('./services/productsService.js');

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

async function product(name, stock = 20, price = 4750, barcode) {
  seq += 1;
  const code = barcode || `966${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`;
  const res = await api('POST', '/api/products', {
    name,
    barcode: code,
    sku: `TP-${seq}-${Date.now()}`,
    price_cents: price,
    cost_cents: Math.round(price * 0.6),
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
  await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Administrador',
    opening_amount_cents: 10000,
  });
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('venda dinheiro grava recebido e troco', async () => {
  const p = await product('Item Troco', 10, 4750);
  const sale = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(sale.json.total_cents, 4750);
  assert.equal(sale.json.amount_received_cents, 5000);
  assert.equal(sale.json.change_cents, 250);

  const detail = await api('GET', `/api/sales/${sale.json.id}`);
  assert.equal(detail.json.change_cents, 250);
  assert.equal(detail.json.amount_received_cents, 5000);
});

test('barcode exact match; código desconhecido não retorna outro produto', async () => {
  const code = `955${Date.now()}01`;
  await product('Exato A', 5, 1000, code);
  const found = getProductByBarcode(code);
  assert.ok(found);
  assert.equal(found.barcode, code);

  const miss = await api('GET', `/api/products?barcode=${code}999`);
  assert.equal(miss.status, 200);
  assert.equal(miss.json.length, 0);
});

test('cadastro rápido via API cria produto com estoque e barcode', async () => {
  const code = `944${Date.now()}77`;
  const created = await api('POST', '/api/products', {
    name: 'Novo Scanner',
    barcode: code,
    price_cents: 1990,
    cost_cents: 900,
    stock_qty: 3,
    min_stock_qty: 1,
    category: 'Teste',
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.barcode, code);
  assert.equal(created.json.stock_qty, 3);

  const stockBefore = created.json.stock_qty;
  const sale = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: created.json.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201);
  assert.equal(
    getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(created.json.id).stock_qty,
    stockBefore - 1
  );
});

test('ajuste de estoque gera movimentação com antes/depois', async () => {
  const p = await product('Ajuste Mov', 4, 800);
  const mov = await api('POST', '/api/stock/movements', {
    product_id: p.id,
    movement_type: 'entry',
    quantity: 6,
    reason: 'Entrada manual',
  });
  assert.equal(mov.status, 201, JSON.stringify(mov.json));
  assert.equal(mov.json.stock_before, 4);
  assert.equal(mov.json.stock_after, 10);
  assert.equal(
    getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(p.id).stock_qty,
    10
  );
});
