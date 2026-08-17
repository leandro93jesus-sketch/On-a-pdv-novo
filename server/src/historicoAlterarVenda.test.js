import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-hist-amend-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { runMigrations } = await import('./db/migrate.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { verifyAdminOperationPin } = await import('./services/adminAuthService.js');
const { getProductByBarcode, searchProducts } = await import('./services/productsService.js');

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

async function product(name, stock = 50, price = 1000, barcode) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: barcode || `988${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `HA-${seq}-${Date.now()}`,
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

test('PIN admin: senha correta autoriza; errada bloqueia; não vaza senha', () => {
  assert.equal(verifyAdminOperationPin('230808').ok, true);
  assert.throws(() => verifyAdminOperationPin('000000'), /inválida/i);
  assert.throws(() => verifyAdminOperationPin(''), /obrigatória/i);
});

test('busca barcode é EXATA — não devolve produto de código parecido', async () => {
  const a = await product('Prod A Exact', 10, 100, '7891234567890');
  await product('Prod B Similar', 10, 200, '7891234567899');
  const exact = getProductByBarcode('7891234567890');
  assert.equal(exact.id, a.id);
  const like = searchProducts({ q: '789123456789' });
  assert.ok(like.length >= 2);
  const onlyExact = searchProducts({ barcode: '7891234567890' });
  assert.equal(onlyExact.length, 1);
  assert.equal(onlyExact[0].id, a.id);
});

test('venda com estoque zero/negativo é permitida', async () => {
  const p = await product('Zero Stock', 0, 500);
  const sale = await api('POST', '/api/sales', {
    client_request_id: `zero-${Date.now()}`,
    payment_method: 'dinheiro',
    amount_received_cents: 1500,
    items: [{ product_id: p.id, quantity: 3 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  const after = await api('GET', `/api/products/${p.id}`);
  assert.equal(after.json.stock_qty, -3);
});

test('histórico pagina e retorna total', async () => {
  const p = await product('Hist Page', 100, 100);
  for (let i = 0; i < 3; i += 1) {
    await api('POST', '/api/sales', {
      client_request_id: `hist-${Date.now()}-${i}`,
      payment_method: 'pix',
      items: [{ product_id: p.id, quantity: 1 }],
    });
  }
  const page = await api('GET', '/api/sales?paged=1&limit=2&offset=0');
  assert.equal(page.status, 200);
  assert.ok(Array.isArray(page.json.items));
  assert.ok(page.json.total >= 3);
  assert.ok(page.json.items.length <= 2);
});

test('alterar venda: senha, motivo, estoque e caixa por diferença', async () => {
  const a = await product('Amend A', 20, 1000);
  const b = await product('Amend B', 20, 2000);
  const c = await product('Amend C', 20, 500);
  const beforeCash = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(beforeCash.json?.sales_total_cents || 0);

  const sale = await api('POST', '/api/sales', {
    client_request_id: `amend-${Date.now()}`,
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    items: [
      { product_id: a.id, quantity: 2, unit_price_cents: 1000 },
      { product_id: b.id, quantity: 1, unit_price_cents: 2000 },
    ],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(sale.json.total_cents, 4000);

  const badPin = await api('PUT', `/api/sales/${sale.json.id}`, {
    admin_password: '111111',
    reason: 'teste',
    items: [{ product_id: a.id, quantity: 4, unit_price_cents: 1000 }],
  });
  assert.equal(badPin.status, 401);

  const stockA1 = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(a.id).stock_qty;
  const stockB1 = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(b.id).stock_qty;
  const stockC1 = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(c.id).stock_qty;

  const amended = await api('PUT', `/api/sales/${sale.json.id}`, {
    admin_password: '230808',
    reason: 'Cliente adicionou produtos',
    discount_cents: 0,
    items: [
      { product_id: a.id, quantity: 4, unit_price_cents: 1000 },
      { product_id: c.id, quantity: 1, unit_price_cents: 500 },
    ],
  });
  assert.equal(amended.status, 200, JSON.stringify(amended.json));
  assert.equal(amended.json.total_cents, 4500);
  assert.ok(amended.json.amended_at);
  assert.equal(amended.json.situation_label, 'Alterada');

  const stockA2 = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(a.id).stock_qty;
  const stockB2 = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(b.id).stock_qty;
  const stockC2 = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(c.id).stock_qty;
  assert.equal(stockA2, stockA1 - 2); // +2 units sold
  assert.equal(stockB2, stockB1 + 1); // B returned
  assert.equal(stockC2, stockC1 - 1);

  const afterCash = await api('GET', '/api/cash/sessions/current');
  const salesAfter = Number(afterCash.json?.sales_total_cents || 0);
  assert.equal(salesAfter, salesBefore + 4000 + 500); // original + delta 500

  // cancel with pin + idempotent
  const cancel = await api('POST', `/api/sales/${sale.json.id}/cancel`, {
    reason: 'Teste exclusão',
    admin_password: '230808',
  });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  assert.equal(cancel.json.status, 'cancelled');
  const cancel2 = await api('POST', `/api/sales/${sale.json.id}/cancel`, {
    reason: 'de novo',
    admin_password: '230808',
  });
  assert.equal(cancel2.status, 200);
  assert.equal(cancel2.json.status, 'cancelled');
});

test('integridade após operações', () => {
  const db = getDb();
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
