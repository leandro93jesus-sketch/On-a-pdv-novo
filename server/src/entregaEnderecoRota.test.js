import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-entrega-endereco-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'entrega-endereco.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { buildWhatsAppUrl, normalizeWhatsAppNumber } = await import('./services/whatsappService.js');

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
    barcode: `933${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `EER-${seq}-${Date.now()}`,
    price_cents: price,
    stock_qty: stock,
    confirm_similar_name: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

const ADDR = {
  address: 'Av. Brasil',
  address_number: '500',
  complement: 'Loja 2',
  neighborhood: 'Centro',
  city: 'Campinas',
  state: 'SP',
  zip_code: '13010-000',
  reference_note: 'Próximo ao mercado',
};

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
    operator_name: 'Admin EER',
    opening_amount_cents: 10000,
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('rejeita pedido sem endereço completo', async () => {
  const p = await product('Sem Endereço', 5, 500);
  const bad = await api('POST', '/api/delivery-orders', {
    client_request_id: `eer-bad-${Date.now()}`,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'ADDRESS_INCOMPLETE');
});

test('salva endereço completo e permite WhatsApp/rota sem impacto financeiro', async () => {
  const p = await product('Com Endereço', 10, 1500);
  const before = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(before.json?.sales_total_cents || 0);

  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `eer-ok-${Date.now()}`,
    customer_name: 'Cliente Rota',
    phone: '19988887777',
    ...ADDR,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.city, 'Campinas');
  assert.equal(created.json.address_number, '500');
  assert.equal(created.json.payment_status, 'nao_pago');

  const opened = await api('POST', `/api/delivery-orders/${created.json.id}/route-event`, {
    event: 'route_opened',
  });
  assert.equal(opened.status, 200);
  assert.equal(opened.json.payment_status, 'nao_pago');
  assert.equal(opened.json.amount_paid_cents, 0);

  const msg = [
    'ONÇA PRODUTOS DE LIMPEZA',
    `ENTREGA Nº ${created.json.order_number}`,
    'STATUS: AGUARDANDO PAGAMENTO',
    'https://www.google.com/maps/search/?api=1&query=Av.%20Brasil',
  ].join('\n');
  const wa = await api('POST', `/api/delivery-orders/${created.json.id}/whatsapp`, {
    phone: '19988887777',
    message: msg,
    recipient: 'cliente',
  });
  assert.equal(wa.status, 200, JSON.stringify(wa.json));
  assert.ok(String(wa.json.url).startsWith('https://wa.me/'));
  assert.equal(wa.json.financial_impact, false);
  assert.match(wa.json.url, /text=/);

  const mid = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(mid.json?.sales_total_cents || 0), salesBefore);

  const detail = await api('GET', `/api/delivery-orders/${created.json.id}`);
  const notes = (detail.json.history || []).map((h) => h.note || '').join(' | ');
  assert.match(notes, /Rota aberta/i);
  assert.match(notes, /compartilhada/i);
});

test('corrigir endereço não altera status financeiro', async () => {
  const p = await product('Corrigir Addr', 8, 900);
  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `eer-fix-${Date.now()}`,
    ...ADDR,
    phone: '11999990000',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  const patched = await api('PATCH', `/api/delivery-orders/${created.json.id}/address`, {
    address: 'Rua Nova',
    address_number: '12',
    city: 'Sorocaba',
    state: 'SP',
    zip_code: '18000-000',
    neighborhood: 'Centro',
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.address, 'Rua Nova');
  assert.equal(patched.json.city, 'Sorocaba');
  assert.equal(patched.json.payment_status, 'nao_pago');
});

test('WhatsApp URL encode e normalização BR', () => {
  assert.equal(normalizeWhatsAppNumber('11987654321'), '5511987654321');
  const built = buildWhatsAppUrl({
    phone: '11987654321',
    message: 'Olá\nSTATUS: AGUARDANDO PAGAMENTO',
  });
  assert.ok(built.url.includes(encodeURIComponent('STATUS: AGUARDANDO PAGAMENTO')));
});

test('pagamento na entrega guarda forma prevista e troco', async () => {
  const p = await product('COD Addr', 6, 2000);
  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `eer-cod-${Date.now()}`,
    ...ADDR,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  const mark = await api('POST', `/api/delivery-orders/${created.json.id}/payments`, {
    mark_pagamento_na_entrega: true,
    expected_payment_method: 'dinheiro',
    change_for_cents: 5000,
  });
  assert.equal(mark.status, 200, JSON.stringify(mark.json));
  assert.equal(mark.json.payment_status, 'pagamento_na_entrega');
  assert.equal(mark.json.expected_payment_method, 'dinheiro');
  assert.equal(mark.json.change_for_cents, 5000);
  assert.equal(mark.json.amount_paid_cents, 0);
});
