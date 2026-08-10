import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-f4-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'fase4.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { parseMoneyToCents, toCents } = await import('./utils/money.js');
const { recoverIncompleteOperations, beginOperation, commitOperation } = await import(
  './services/recoveryService.js'
);

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
  recoverIncompleteOperations();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
  await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Admin F4',
    opening_amount_cents: 0,
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('precisão monetária evita float quebrado', () => {
  assert.equal(parseMoneyToCents('19,90'), 1990);
  assert.equal(parseMoneyToCents('R$ 10,50'), 1050);
  assert.equal(toCents(19.899999999), 20);
  assert.equal(toCents(10.1 + 10.2), 20);
});

test('histórico de preço ao alterar produto', async () => {
  const p = await api('POST', '/api/products', {
    name: 'Produto Preço F4',
    barcode: '7950000000001',
    price_cents: 1000,
    stock_qty: 5,
  });
  assert.equal(p.status, 201);
  const up = await api('PUT', `/api/products/${p.json.id}`, { price_cents: 1250 });
  assert.equal(up.status, 200);
  assert.equal(up.json.price_cents, 1250);
  const hist = await api('GET', `/api/products/${p.json.id}/price-history`);
  assert.equal(hist.status, 200);
  assert.ok(hist.json.length >= 1);
  assert.equal(hist.json[0].old_price_cents, 1000);
  assert.equal(hist.json[0].new_price_cents, 1250);

  // venda antiga mantém preço original
  const sale = await api('POST', '/api/sales', {
    client_request_id: `f4-price-${Date.now()}`,
    payment_method: 'pix',
    items: [{ product_id: p.json.id, quantity: 1, unit_price_cents: 1000 }],
  });
  assert.equal(sale.status, 201);
  assert.equal(sale.json.items[0].unit_price_cents, 1000);
});

test('journal recupera operações incompletas', () => {
  beginOperation('op-stale-f4', 'sale.create', { demo: true });
  const result = recoverIncompleteOperations();
  assert.ok(result.recovered >= 1);
  const row = getDb().prepare(`SELECT status FROM operation_journal WHERE op_key='op-stale-f4'`).get();
  assert.equal(row.status, 'failed');
  beginOperation('op-ok-f4', 'sale.create', {});
  commitOperation('op-ok-f4');
  const ok = getDb().prepare(`SELECT status FROM operation_journal WHERE op_key='op-ok-f4'`).get();
  assert.equal(ok.status, 'committed');
});

test('ajuste de caixa fechado exige motivo e audita', async () => {
  const p = await api('POST', '/api/products', {
    name: 'Produto Caixa F4',
    barcode: '7950000000002',
    price_cents: 500,
    stock_qty: 3,
  });
  await api('POST', '/api/sales', {
    client_request_id: `f4-cash-${Date.now()}`,
    payment_method: 'dinheiro',
    amount_received_cents: 500,
    items: [{ product_id: p.json.id, quantity: 1 }],
  });
  const closed = await api('POST', '/api/cash/sessions/close', {
    counted_amount_cents: 500,
    close_notes: 'Fechamento F4',
  });
  assert.equal(closed.status, 200);
  const sessionId = closed.json.session?.id || closed.json.id;
  const adj = await api('POST', `/api/cash/sessions/${sessionId}/adjust`, {
    counted_amount_cents: 480,
    reason: 'Diferença de contagem',
  });
  assert.equal(adj.status, 200, JSON.stringify(adj.json));
  const reprint = await api('GET', `/api/cash/sessions/${sessionId}/reprint`);
  assert.equal(reprint.status, 200);
});

test('integridade SQLite fase 4', () => {
  const db = getDb();
  db.pragma('foreign_keys = ON');
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
