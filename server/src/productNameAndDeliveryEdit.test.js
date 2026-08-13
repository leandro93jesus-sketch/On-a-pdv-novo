import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-prod-name-edit-'));
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

test('permite mesmo nome com códigos diferentes', async () => {
  const a = await api('POST', '/api/products', {
    name: 'TESTE MESMO NOME',
    sku: 'TESTE001',
    price_cents: 350,
    stock_qty: 10,
  });
  assert.equal(a.status, 201, JSON.stringify(a.json));

  const b = await api('POST', '/api/products', {
    name: 'TESTE MESMO NOME',
    sku: 'TESTE002',
    price_cents: 400,
    stock_qty: 5,
  });
  assert.equal(b.status, 201, JSON.stringify(b.json));
  assert.equal(a.json.name, b.json.name);
  assert.notEqual(a.json.id, b.json.id);
});

test('bloqueia mesmo código interno', async () => {
  const c = await api('POST', '/api/products', {
    name: 'Outro produto',
    sku: 'TESTE001',
    price_cents: 100,
  });
  assert.equal(c.status, 409);
  assert.equal(c.json.code, 'DUPLICATE_SKU');
  assert.match(String(c.json.error || ''), /Já existe um produto com este código/i);
});

test('bloqueia mesmo código de barras', async () => {
  const a = await api('POST', '/api/products', {
    name: 'Produto Barras A',
    barcode: '789000000001',
    sku: 'BAR-A',
    price_cents: 100,
  });
  assert.equal(a.status, 201);
  const b = await api('POST', '/api/products', {
    name: 'Produto Barras B',
    barcode: '789000000001',
    sku: 'BAR-B',
    price_cents: 100,
  });
  assert.equal(b.status, 409);
  assert.equal(b.json.code, 'DUPLICATE_BARCODE');
});

test('edita produto em entrega sem alterar item/preço/estoque histórico', async () => {
  const product = await api('POST', '/api/products', {
    name: 'Detergente Ypê Entrega',
    sku: `ENT-${Date.now()}`,
    price_cents: 300,
    stock_qty: 20,
  });
  assert.equal(product.status, 201, JSON.stringify(product.json));
  const productId = product.json.id;
  const stockBefore = product.json.stock_qty;

  const order = await api('POST', '/api/delivery-orders', {
    customer_name: 'Cliente Teste',
    phone: '11999999999',
    address: 'Rua A',
    address_number: '100',
    city: 'São Paulo',
    state: 'SP',
    items: [{ product_id: productId, quantity: 2, unit_price_cents: 300 }],
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  const orderId = order.json.id;
  const itemBefore = (order.json.items || []).find((i) => i.product_id === productId);
  assert.ok(itemBefore);
  assert.equal(itemBefore.unit_price_cents, 300);
  assert.equal(itemBefore.quantity, 2);
  assert.equal(itemBefore.product_name, 'Detergente Ypê Entrega');
  const statusBefore = order.json.status;
  const totalBefore = order.json.total_cents;

  const edited = await api('PUT', `/api/products/${productId}`, {
    name: 'Detergente Ypê Editado',
    price_cents: 350,
    category: 'Limpeza',
    notes: 'editado em entrega',
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.name, 'Detergente Ypê Editado');
  assert.equal(edited.json.price_cents, 350);

  const after = await api('GET', `/api/delivery-orders/${orderId}`);
  assert.equal(after.status, 200);
  const itemAfter = (after.json.items || []).find((i) => i.product_id === productId);
  assert.ok(itemAfter);
  assert.equal(itemAfter.product_name, 'Detergente Ypê Entrega', 'nome histórico da entrega');
  assert.equal(itemAfter.unit_price_cents, 300, 'preço histórico da entrega');
  assert.equal(itemAfter.quantity, 2);
  assert.equal(after.json.status, statusBefore);
  assert.equal(after.json.total_cents, totalBefore);

  const stockAfter = getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(productId)
    .stock_qty;
  assert.equal(stockAfter, stockBefore, 'estoque físico não deve mudar na edição cadastral');
});
