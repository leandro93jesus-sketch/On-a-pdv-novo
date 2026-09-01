import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-f3-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'fase3.db');
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
  return { status: res.status, json };
}

before(async () => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  ensureBootstrapAdmin();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
  await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Admin F3',
    opening_amount_cents: 10000,
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

let productSeq = 0;
async function product(name, stock = 20, price = 1000) {
  productSeq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `793${String(Date.now()).slice(-8)}${String(productSeq).padStart(3, '0')}`,
    sku: `F3-${productSeq}-${Date.now()}`,
    price_cents: price,
    stock_qty: stock,
    confirm_similar_name: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

test('pagamento misto dinheiro+pix registra cada forma', async () => {
  const p = await product('F3 Misto Pix');
  const sale = await api('POST', '/api/sales', {
    client_request_id: `f3-mix-pix-${Date.now()}`,
    discount_cents: 0,
    payments: [
      { method: 'dinheiro', amount_cents: 400 },
      { method: 'pix', amount_cents: 600 },
    ],
    amount_received_cents: 500,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(sale.json.total_cents, 1000);
  assert.equal(sale.json.change_cents, 100);
  assert.equal(sale.json.payments.length, 2);
  assert.equal(sale.json.payment_method, 'misto');

  const cash = await api('GET', '/api/cash/sessions/current');
  assert.ok(cash.json.sales_dinheiro_cents >= 400);
  assert.ok(cash.json.sales_pix_cents >= 600);
});

test('misto rejeita soma menor ou maior', async () => {
  const p = await product('F3 Soma Errada');
  const low = await api('POST', '/api/sales', {
    client_request_id: `f3-low-${Date.now()}`,
    payments: [
      { method: 'pix', amount_cents: 200 },
      { method: 'cartao', amount_cents: 200, card_type: 'CREDIT' },
    ],
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(low.status, 400);
  assert.equal(low.json.code, 'PAYMENT_INSUFFICIENT');

  const high = await api('POST', '/api/sales', {
    client_request_id: `f3-high-${Date.now()}`,
    payments: [
      { method: 'pix', amount_cents: 600 },
      { method: 'cartao', amount_cents: 600, card_type: 'DEBIT' },
    ],
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(high.status, 400);
  assert.equal(high.json.code, 'PAYMENT_OVERPAID');
});

test('crediário no misto exige cliente e registra só a parte', async () => {
  const p = await product('F3 Cred Misto', 10, 2000);
  const noCust = await api('POST', '/api/sales', {
    client_request_id: `f3-cred-nocust-${Date.now()}`,
    payments: [
      { method: 'pix', amount_cents: 500 },
      { method: 'crediario', amount_cents: 1500 },
    ],
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(noCust.status, 400);
  assert.equal(noCust.json.code, 'CUSTOMER_REQUIRED_FOR_CREDIT');

  const cust = await api('POST', '/api/customers', {
    name: 'Cliente F3 Misto',
    phone: '11999990000',
  });
  assert.equal(cust.status, 201);
  const ok = await api('POST', '/api/sales', {
    client_request_id: `f3-cred-ok-${Date.now()}`,
    customer_id: cust.json.id,
    payments: [
      { method: 'dinheiro', amount_cents: 500 },
      { method: 'crediario', amount_cents: 1500 },
    ],
    amount_received_cents: 500,
    items: [{ product_id: p.id, quantity: 1 }],
    credit: { installment_count: 2 },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const account = getDb()
    .prepare(`SELECT total_cents, balance_cents FROM credit_accounts WHERE sale_id = ?`)
    .get(ok.json.id);
  assert.equal(account.total_cents, 1500);
});

test('troco em dinheiro simples', async () => {
  const p = await product('F3 Troco', 5, 1500);
  const sale = await api('POST', '/api/sales', {
    client_request_id: `f3-troco-${Date.now()}`,
    payment_method: 'dinheiro',
    amount_received_cents: 2000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.json.change_cents, 500);
  assert.equal(sale.json.amount_received_cents, 2000);
  assert.equal(sale.json.payments[0].amount_cents, 1500);
});

test('histórico com filtros de período e pagamento', async () => {
  const list = await api('GET', '/api/sales?period=today&limit=50');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.json));
  assert.ok(list.json.length >= 1);

  const mixed = await api('GET', '/api/sales?payment_method=misto&period=today');
  assert.equal(mixed.status, 200);
  assert.ok(mixed.json.every((s) => s.payment_method === 'misto'));
});

test('item diversos continua funcionando com misto', async () => {
  const sale = await api('POST', '/api/sales', {
    client_request_id: `f3-misc-${Date.now()}`,
    payments: [
      { method: 'pix', amount_cents: 300 },
      { method: 'cartao', amount_cents: 200, card_type: 'CREDIT' },
    ],
    items: [
      {
        name: 'Item Diversos F3',
        quantity: 1,
        unit_price_cents: 500,
        is_misc: true,
      },
    ],
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.json.items[0].is_misc, 1);
  assert.equal(sale.json.items[0].product_id, null);
});

test('integridade SQLite fase 3', () => {
  const db = getDb();
  db.pragma('foreign_keys = ON');
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
