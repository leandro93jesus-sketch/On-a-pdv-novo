import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-entregas-fluxo-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'entregas-fluxo.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
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

async function product(name, stock = 20, price = 1000) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `913${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `EF-${seq}-${Date.now()}`,
    price_cents: price,
    stock_qty: stock,
    confirm_similar_name: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
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
    operator_name: 'Admin Entregas',
    opening_amount_cents: 10000,
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('fluxo: montar pedido com vários itens, aguardando pagamento, sem caixa', async () => {
  const detergente = await product('Detergente EF', 20, 500);
  const agua = await product('Água Sanitária EF', 20, 800);
  const before = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(before.json?.sales_total_cents || 0);

  const order = await api('POST', '/api/delivery-orders', {
    client_request_id: `ef-cart-${Date.now()}`,
    customer_name: 'Maria',
    phone: '11999990000',
    address: 'Rua A, 100',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [
      { product_id: detergente.id, quantity: 2 },
      { product_id: agua.id, quantity: 1 },
    ],
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  assert.equal(order.json.status, 'aguardando_pagamento');
  assert.equal(order.json.payment_status, 'nao_pago');
  assert.equal(order.json.amount_paid_cents, 0);
  assert.equal(order.json.total_cents, 500 * 2 + 800);
  assert.equal(order.json.items?.length, 2);

  const availDet = await api('GET', `/api/delivery-orders/availability/${detergente.id}`);
  assert.equal(availDet.json.reserved_qty, 2);
  assert.equal(availDet.json.available_qty, 18);

  const after = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(after.json?.sales_total_cents || 0), salesBefore);
});

test('fluxo: PIX pendente não entra no caixa; confirmar PIX entra', async () => {
  const p = await product('Pix Pendente EF', 10, 2000);
  const before = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(before.json?.sales_total_cents || 0);

  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `ef-pix-${Date.now()}`,
        address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(created.status, 201);

  const pending = await api('POST', `/api/delivery-orders/${created.json.id}/payments`, {
    mark_pix_pending: true,
  });
  assert.equal(pending.status, 200, JSON.stringify(pending.json));
  assert.equal(pending.json.payment_status, 'pix_pendente');
  assert.equal(pending.json.amount_paid_cents, 0);

  const mid = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(mid.json?.sales_total_cents || 0), salesBefore);

  const confirm = await api('POST', `/api/delivery-orders/${created.json.id}/payments`, {
    client_request_id: `ef-pix-ok-${Date.now()}`,
    payments: [{ method: 'pix', amount_cents: 2000 }],
  });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.json));
  assert.equal(confirm.json.payment_status, 'pago');
  assert.equal(confirm.json.amount_paid_cents, 2000);

  const end = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(end.json?.sales_total_cents || 0), salesBefore + 2000);
});

test('fluxo: pagamento na entrega fica pendente; confirmar recebimento lança caixa', async () => {
  const p = await product('COD EF', 10, 1500);
  const before = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(before.json?.sales_total_cents || 0);

  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `ef-cod-${Date.now()}`,
        address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [{ product_id: p.id, quantity: 1 }],
  });

  const mark = await api('POST', `/api/delivery-orders/${created.json.id}/payments`, {
    mark_pagamento_na_entrega: true,
  });
  assert.equal(mark.status, 200, JSON.stringify(mark.json));
  assert.equal(mark.json.payment_status, 'pagamento_na_entrega');
  assert.equal(mark.json.amount_paid_cents, 0);

  const mid = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(mid.json?.sales_total_cents || 0), salesBefore);

  const receive = await api('POST', `/api/delivery-orders/${created.json.id}/payments`, {
    client_request_id: `ef-cod-ok-${Date.now()}`,
    payments: [{ method: 'dinheiro', amount_cents: 1500, amount_received_cents: 1500 }],
  });
  assert.equal(receive.status, 200, JSON.stringify(receive.json));
  assert.equal(receive.json.payment_status, 'pago');

  const end = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(end.json?.sales_total_cents || 0), salesBefore + 1500);
});

test('fluxo: impedir pagamento duplicado com PAGAMENTO JÁ CONFIRMADO', async () => {
  const p = await product('Dup Pay EF', 5, 1000);
  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `ef-dup-${Date.now()}`,
        address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  const pay = await api('POST', `/api/delivery-orders/${created.json.id}/payments`, {
    client_request_id: `ef-dup-pay-${Date.now()}`,
    payments: [{ method: 'dinheiro', amount_cents: 1000, amount_received_cents: 1000 }],
  });
  assert.equal(pay.status, 200);
  assert.equal(pay.json.payment_status, 'pago');

  const again = await api('POST', `/api/delivery-orders/${created.json.id}/payments`, {
    client_request_id: `ef-dup-again-${Date.now()}`,
    payments: [{ method: 'pix', amount_cents: 1000 }],
  });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'ORDER_ALREADY_PAID');
  assert.match(String(again.json.error || ''), /PAGAMENTO JÁ CONFIRMADO/i);
  assert.ok(again.json.details);
});

test('fluxo: cancelar não pago libera reserva e não altera caixa', async () => {
  const p = await product('Cancel EF', 12, 700);
  const before = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(before.json?.sales_total_cents || 0);

  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `ef-can-${Date.now()}`,
        address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [{ product_id: p.id, quantity: 3 }],
  });
  const avail1 = await api('GET', `/api/delivery-orders/availability/${p.id}`);
  assert.equal(avail1.json.reserved_qty, 3);

  const cancel = await api('POST', `/api/delivery-orders/${created.json.id}/cancel`, {
    reason: 'Cliente desistiu no balcão',
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.status, 'cancelado');

  const avail2 = await api('GET', `/api/delivery-orders/availability/${p.id}`);
  assert.equal(avail2.json.reserved_qty, 0);
  assert.equal(avail2.json.stock_qty, 12);

  const after = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(after.json?.sales_total_cents || 0), salesBefore);

  const detail = await api('GET', `/api/delivery-orders/${created.json.id}`);
  assert.ok(detail.json.history?.length >= 1);
  assert.equal(detail.json.cancel_reason, 'Cliente desistiu no balcão');
});
