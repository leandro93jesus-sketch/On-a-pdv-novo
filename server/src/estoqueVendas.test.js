import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-ev-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'estoque-vendas.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');

let server;
let baseUrl;
let token;

async function api(method, path, body, auth = token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

before(async () => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  ensureBootstrapAdmin();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('produto novo com estoque inicial gera movimento Estoque inicial', async () => {
  const p = await api('POST', '/api/products', {
    name: 'Detergente EV 500ml',
    barcode: '7911001001001',
    sku: 'EV-DET-01',
    category: 'Limpeza',
    unit: 'UN',
    price_cents: 450,
    cost_cents: 200,
    stock_qty: 24,
    min_stock_qty: 5,
    confirm_similar_name: true,
  });
  assert.equal(p.status, 201);
  assert.equal(p.json.stock_qty, 24);
  assert.equal(p.json.min_stock_qty, 5);

  const hist = await api('GET', `/api/products/${p.json.id}/history`);
  assert.equal(hist.status, 200);
  const initial = hist.json.movements.find(
    (m) => m.movement_type === 'entry' && /estoque inicial/i.test(m.reason || '')
  );
  assert.ok(initial, 'deve haver movimento de estoque inicial');
  assert.equal(initial.stock_before, 0);
  assert.equal(initial.quantity_delta, 24);
  assert.equal(initial.stock_after, 24);
});

test('produto novo com estoque inicial zero não cria movimento', async () => {
  const p = await api('POST', '/api/products', {
    name: 'Esponja EV Zero',
    barcode: '7911001001002',
    price_cents: 100,
    stock_qty: 0,
    min_stock_qty: 2,
    confirm_similar_name: true,
  });
  assert.equal(p.status, 201);
  assert.equal(p.json.stock_qty, 0);
  const hist = await api('GET', `/api/products/${p.json.id}/history`);
  assert.equal(hist.json.movements.length, 0);
});

test('definir quantidade maior/menor/zero registra diferença e motivo', async () => {
  const p = await api('POST', '/api/products', {
    name: 'Água Sanitária EV',
    barcode: '7911001001003',
    price_cents: 800,
    stock_qty: 20,
    min_stock_qty: 5,
    confirm_similar_name: true,
  });
  const id = p.json.id;

  const up = await api('POST', '/api/stock/set-balance', {
    product_id: id,
    new_qty: 35,
    reason: 'Contagem física',
    note: 'Inventário loja',
  });
  assert.equal(up.status, 201);
  assert.equal(up.json.stock_before, 20);
  assert.equal(up.json.quantity_delta, 15);
  assert.equal(up.json.stock_after, 35);

  const down = await api('POST', '/api/stock/set-balance', {
    product_id: id,
    new_qty: 12,
    reason: 'Correção de estoque',
  });
  assert.equal(down.status, 201);
  assert.equal(down.json.quantity_delta, -23);
  assert.equal(down.json.stock_after, 12);

  const zero = await api('POST', '/api/stock/set-balance', {
    product_id: id,
    new_qty: 0,
    reason: 'Perda / avaria',
  });
  assert.equal(zero.status, 201);
  assert.equal(zero.json.stock_after, 0);

  const entry = await api('POST', '/api/stock/movements', {
    product_id: id,
    movement_type: 'entry',
    quantity: 10,
    reason: 'Entrada manual',
  });
  assert.equal(entry.status, 201);
  assert.equal(entry.json.stock_after, 10);

  const exit = await api('POST', '/api/stock/movements', {
    product_id: id,
    movement_type: 'exit',
    quantity: 4,
    reason: 'Correção de cadastro',
  });
  assert.equal(exit.status, 201);
  assert.equal(exit.json.stock_after, 6);

  const hist = await api('GET', `/api/products/${id}/history`);
  assert.ok(hist.json.movements.every((m) => m.reason && String(m.reason).trim()));
  assert.ok(hist.json.movements.every((m) => m.stock_before != null));
});

test('venda após ajuste e Item Diversos seguem ok; SQLite íntegro', async () => {
  const p = await api('POST', '/api/products', {
    name: 'Sabão EV Venda',
    barcode: '7911001001004',
    price_cents: 500,
    stock_qty: 5,
    confirm_similar_name: true,
  });
  await api('POST', '/api/stock/set-balance', {
    product_id: p.json.id,
    new_qty: 3,
    reason: 'Contagem física',
  });

  let cash = await api('GET', '/api/cash/sessions/current');
  if (!cash.json) {
    await api('POST', '/api/cash/sessions/open', {
      operator_name: 'Admin',
      opening_amount_cents: 0,
    });
  }

  const sale = await api('POST', '/api/sales', {
    client_request_id: `ev-sale-${Date.now()}`,
    payment_method: 'dinheiro',
    amount_received_cents: 1500,
    items: [
      { product_id: p.json.id, quantity: 1 },
      { name: 'Item Diversos EV', quantity: 1, unit_price_cents: 250, is_misc: true },
    ],
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.json.change_cents, 750);

  const after = await api('GET', `/api/products/${p.json.id}`);
  assert.equal(after.json.stock_qty, 2);

  const integrity = getDb().pragma('integrity_check');
  assert.equal(integrity[0].integrity_check, 'ok');
  assert.equal(getDb().pragma('foreign_key_check').length, 0);
});
