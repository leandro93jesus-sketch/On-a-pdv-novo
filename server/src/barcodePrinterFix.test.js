import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-bpf-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'fix.db');
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
    operator_name: 'Admin BPF',
    opening_amount_cents: 20000,
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

let seq = 0;
async function product(name, stock = 20, price = 1000, barcode) {
  seq += 1;
  const code = barcode || `900${String(Date.now()).slice(-7)}${String(seq).padStart(3, '0')}`;
  const res = await api('POST', '/api/products', {
    name,
    barcode: code,
    sku: `BPF-${seq}`,
    price_cents: price,
    stock_qty: stock,
    confirm_similar_name: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

async function paidOrder(items) {
  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `bpf-ord-${Date.now()}-${seq}`,
    address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items,
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const pay = await api('POST', `/api/delivery-orders/${created.json.id}/payments`, {
    client_request_id: `bpf-pay-${Date.now()}-${seq}`,
    payments: [{ method: 'pix', amount_cents: created.json.total_cents }],
  });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  return pay.json;
}

test('scan barcode: incrementa conferência e bloqueia excedente/produto errado', async () => {
  const p1 = await product('BPF Detergente', 10, 500);
  const p2 = await product('BPF Outro', 10, 500);
  const order = await paidOrder([{ product_id: p1.id, quantity: 2 }]);

  const s1 = await api('POST', `/api/delivery-orders/${order.id}/scan`, { barcode: p1.barcode });
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  assert.equal(s1.json.item.checked_qty, 1);
  assert.equal(s1.json.item.check_status, 'PARCIAL');

  const s2 = await api('POST', `/api/delivery-orders/${order.id}/scan`, { barcode: p1.barcode });
  assert.equal(s2.status, 200);
  assert.equal(s2.json.item.checked_qty, 2);
  assert.equal(s2.json.item.check_status, 'CONFERIDO');

  const s3 = await api('POST', `/api/delivery-orders/${order.id}/scan`, { barcode: p1.barcode });
  assert.equal(s3.status, 409);
  assert.equal(s3.json.code, 'ALREADY_CHECKED');

  const wrong = await api('POST', `/api/delivery-orders/${order.id}/scan`, { barcode: p2.barcode });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.json.code, 'PRODUCT_NOT_IN_ORDER');
  assert.equal(wrong.json.details.product_name, p2.name);
});

test('separado bloqueia sem conferência; admin libera com motivo', async () => {
  const p = await product('BPF Sep', 10, 800);
  const order = await paidOrder([{ product_id: p.id, quantity: 1 }]);

  const blocked = await api('PATCH', `/api/delivery-orders/${order.id}/status`, {
    status: 'separado',
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'ITEMS_NOT_CHECKED');

  const noReason = await api('PATCH', `/api/delivery-orders/${order.id}/status`, {
    status: 'separado',
    allow_unchecked: true,
  });
  assert.equal(noReason.status, 400);

  const ok = await api('PATCH', `/api/delivery-orders/${order.id}/status`, {
    status: 'separado',
    allow_unchecked: true,
    note: 'Urgência — liberação admin',
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.status, 'separado');
});

test('conferência manual e reset impressoras não apaga dados', async () => {
  const p = await product('BPF Manual', 5, 300);
  // remove barcode via SQL para simular sem código
  getDb().prepare(`UPDATE products SET barcode = NULL WHERE id = ?`).run(p.id);
  const order = await paidOrder([{ product_id: p.id, quantity: 2 }]);
  const itemId = order.items[0].id;

  const man = await api('POST', `/api/delivery-orders/${order.id}/items/${itemId}/confirm-manual`, {});
  assert.equal(man.status, 200, JSON.stringify(man.json));
  assert.equal(man.json.items[0].checked_qty, 2);
  assert.equal(man.json.all_items_checked, true);

  const sep = await api('PATCH', `/api/delivery-orders/${order.id}/status`, { status: 'pronto_para_entrega' });
  assert.equal(sep.status, 200);

  const productsBefore = (await api('GET', '/api/products')).json.length;
  const reset = await api('POST', '/api/settings/printers/reset', {});
  assert.equal(reset.status, 200);
  assert.equal(reset.json.settings.receipt_printer, '');
  const productsAfter = (await api('GET', '/api/products')).json.length;
  assert.equal(productsAfter, productsBefore);
});

test('config impressoras corrompida não derruba status portátil', async () => {
  mkdirSync(join(tmp, 'configuracoes'), { recursive: true });
  writeFileSync(join(tmp, 'configuracoes', 'impressoras.json'), '{ invalido', 'utf8');
  const st = await api('GET', '/api/settings/printers/portable-status');
  assert.equal(st.status, 200);
  assert.equal(st.json.ok, false);
  assert.equal(st.json.needs_reconfigure, true);

  const printers = await api('GET', '/api/settings/printers');
  assert.equal(printers.status, 200);
  assert.ok(printers.json.profile);
});
