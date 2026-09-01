import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-vendas-modo-entrega-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'vendas-modo-entrega.db');
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
    barcode: `922${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `VME-${seq}-${Date.now()}`,
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
    operator_name: 'Admin VME',
    opening_amount_cents: 20000,
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('modo entrega: carrinho vira pedido aguardando pagamento com reserva e sem caixa', async () => {
  const p = await product('Detergente VME', 20, 500);
  const before = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(before.json?.sales_total_cents || 0);

  const order = await api('POST', '/api/delivery-orders', {
    client_request_id: `vme-cart-${Date.now()}`,
    customer_name: 'Cliente Entrega',
    phone: '11988887777',
    address: 'Rua das Entregas, 10',
    complement: 'Apto 2',
    neighborhood: 'Centro',
    reference_note: 'Portão azul',
    notes: 'Entregar após 18h',
    discount_cents: 100,
    address_number: '100',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [
      { product_id: p.id, quantity: 2, unit_price_cents: 500 },
      { name: 'Item Diversos Sacola', quantity: 1, unit_price_cents: 200, is_misc: true },
    ],
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  assert.equal(order.json.status, 'aguardando_pagamento');
  assert.equal(order.json.payment_status, 'nao_pago');
  assert.equal(order.json.discount_cents, 100);
  assert.equal(order.json.total_cents, 500 * 2 + 200 - 100);
  assert.equal(order.json.complement, 'Apto 2');
  assert.equal(order.json.reference_note, 'Portão azul');
  assert.equal(order.json.items?.length, 2);

  const avail = await api('GET', `/api/delivery-orders/availability/${p.id}`);
  assert.equal(avail.json.stock_qty, 20);
  assert.equal(avail.json.reserved_qty, 2);
  assert.equal(avail.json.available_qty, 18);

  const after = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(after.json?.sales_total_cents || 0), salesBefore);
});

test('modo entrega: editar pedido não pago reajusta reserva sem caixa', async () => {
  const p = await product('Água VME', 15, 800);
  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `vme-edit-${Date.now()}`,
    customer_name: 'Editável',
        address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [{ product_id: p.id, quantity: 3 }],
  });
  assert.equal(created.status, 201);
  const id = created.json.id;

  const edited = await api('PUT', `/api/delivery-orders/${id}`, {
    phone: '11911112222',
    address: 'Rua Nova',
    items: [{ product_id: p.id, quantity: 5, unit_price_cents: 800 }],
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.phone, '11911112222');
  assert.equal(edited.json.total_cents, 4000);
  assert.equal(edited.json.payment_status, 'nao_pago');

  const avail = await api('GET', `/api/delivery-orders/availability/${p.id}`);
  assert.equal(avail.json.reserved_qty, 5);
  assert.equal(avail.json.stock_qty, 15);

  const cash = await api('GET', '/api/cash/sessions/current');
  assert.ok(cash.json);
});

test('venda normal continua lançando no caixa (regressão)', async () => {
  const p = await product('Venda Normal VME', 10, 1000);
  const before = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(before.json?.sales_total_cents || 0);

  const sale = await api('POST', '/api/sales', {
    client_request_id: `vme-sale-${Date.now()}`,
    payment_method: 'dinheiro',
    amount_received_cents: 1000,
    items: [{ product_id: p.id, quantity: 1, unit_price_cents: 1000 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));

  const after = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(after.json?.sales_total_cents || 0), salesBefore + 1000);

  const prod = await api('GET', `/api/products/${p.id}`);
  assert.equal(prod.json.stock_qty, 9);
});

test('após pagamento do pedido: baixa definitiva e bloqueio de edição', async () => {
  const p = await product('Pago VME', 8, 1500);
  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `vme-pay-${Date.now()}`,
        address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [{ product_id: p.id, quantity: 2 }],
  });
  const id = created.json.id;

  const pay = await api('POST', `/api/delivery-orders/${id}/payments`, {
    client_request_id: `vme-pay-ok-${Date.now()}`,
    payments: [{ method: 'dinheiro', amount_cents: 3000, amount_received_cents: 3000 }],
  });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  assert.equal(pay.json.payment_status, 'pago');

  const avail = await api('GET', `/api/delivery-orders/availability/${p.id}`);
  assert.equal(avail.json.stock_qty, 6);
  assert.equal(avail.json.reserved_qty, 0);

  const edit = await api('PUT', `/api/delivery-orders/${id}`, {
    phone: '000',
    items: [{ product_id: p.id, quantity: 1, unit_price_cents: 1500 }],
  });
  assert.equal(edit.status, 409);
  assert.equal(edit.json.code, 'ORDER_ALREADY_PAID');
});
