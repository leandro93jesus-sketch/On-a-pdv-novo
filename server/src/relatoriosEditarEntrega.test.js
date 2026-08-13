import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-relatorios-edit-entrega-'));
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

async function product(name, stock = 50, price = 1000) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `977${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `RE-${seq}-${Date.now()}`,
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

test('relatório vendas_periodo lista todas as vendas com colunas e canceladas', async () => {
  const p = await product('Relatório Produto A', 100, 500);
  const sales = [];
  for (let i = 0; i < 3; i += 1) {
    const sale = await api('POST', '/api/sales', {
      client_request_id: `rep-sale-${Date.now()}-${i}`,
      items: [{ product_id: p.id, quantity: 1 }],
      payments: [{ method: i === 1 ? 'pix' : 'dinheiro', amount_cents: 500 }],
    });
    assert.equal(sale.status, 201, JSON.stringify(sale.json));
    sales.push(sale.json);
  }

  const cancel = await api('POST', `/api/sales/${sales[2].id}/cancel`, {
    reason: 'Teste cancelamento relatório',
  });
  assert.ok(cancel.status === 200 || cancel.status === 201, JSON.stringify(cancel.json));

  const today = new Date().toISOString().slice(0, 10);
  const report = await api(
    'GET',
    `/api/reports/vendas_periodo?from=${today}&to=${today}`
  );
  assert.equal(report.status, 200, JSON.stringify(report.json));
  assert.ok(Array.isArray(report.json.rows));
  assert.ok(report.json.rows.length >= 3);

  const cols = report.json.columns || [];
  for (const required of [
    'sale_number',
    'sale_date',
    'sale_time',
    'customer_name',
    'items_count',
    'total_cents',
    'payment_methods',
    'operator_name',
    'status_label',
  ]) {
    assert.ok(cols.includes(required), `faltou coluna ${required}`);
  }

  const numbers = new Set(report.json.rows.map((r) => r.sale_number));
  assert.ok(numbers.has(sales[0].sale_number));
  assert.ok(numbers.has(sales[1].sale_number));
  assert.ok(numbers.has(sales[2].sale_number));

  const cancelledRow = report.json.rows.find((r) => r.sale_number === sales[2].sale_number);
  assert.ok(cancelledRow);
  assert.equal(cancelledRow.status, 'cancelled');
  assert.match(String(cancelledRow.status_label), /Cancelad/i);
  assert.ok(Number(cancelledRow.id) > 0);

  const totals = report.json.totals || {};
  assert.ok(Number(totals.cancelled_count) >= 1);
  assert.ok(Number(totals.gross_cents) >= 1000);
  assert.equal(Number(totals.net_cents) >= 0, true);
  // Canceladas não entram no bruto líquido de concluídas
  assert.ok(Number(totals.completed_count) >= 2);

  // Reimpressão/consulta não altera venda
  const beforeStock = getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(p.id).stock_qty;
  const detail = await api('GET', `/api/sales/${sales[0].id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.sale_number, sales[0].sale_number);
  const afterStock = getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(p.id).stock_qty;
  assert.equal(afterStock, beforeStock);

  const cash = await api('GET', '/api/cash/sessions/current');
  const salesTotal = Number(cash.json?.sales_total_cents || 0);
  const detail2 = await api('GET', `/api/sales/${sales[0].id}`);
  assert.equal(detail2.status, 200);
  const cash2 = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(cash2.json?.sales_total_cents || 0), salesTotal);
});

test('editar entrega: qtd, mesmo produto, novo, remover, total e histórico', async () => {
  const a = await product('Produto A Edit', 100, 1000);
  const b = await product('Produto B Edit', 100, 2000);
  const c = await product('Produto C Edit', 100, 500);

  const reservedBefore = {
    a: getDb().prepare('SELECT reserved_qty FROM products WHERE id = ?').get(a.id).reserved_qty || 0,
    b: getDb().prepare('SELECT reserved_qty FROM products WHERE id = ?').get(b.id).reserved_qty || 0,
    c: getDb().prepare('SELECT reserved_qty FROM products WHERE id = ?').get(c.id).reserved_qty || 0,
  };
  const stockBefore = {
    a: getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(a.id).stock_qty,
    b: getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(b.id).stock_qty,
    c: getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(c.id).stock_qty,
  };

  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `edit-ord-${Date.now()}`,
    customer_name: 'Cliente Edit',
    phone: '11988887777',
    address: 'Rua Teste',
    address_number: '10',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [
      { product_id: a.id, quantity: 2, unit_price_cents: 1000 },
      { product_id: b.id, quantity: 1, unit_price_cents: 2000 },
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.total_cents, 4000);
  const orderId = created.json.id;

  // A: 2→5, adicionar C qtd 3, remover B, e também enviar A de novo (+3) → deve mergear para 8? 
  // Spec teste 31: A 2→5, add C 3, remove B → A5 C3
  // Spec teste 32 separately: A2 + A3 = A5
  const updated = await api('PUT', `/api/delivery-orders/${orderId}`, {
    address: 'Rua Teste',
    address_number: '10',
    city: 'São Paulo',
    discount_cents: 0,
    items: [
      { product_id: a.id, quantity: 5, unit_price_cents: 1000, name: a.name },
      { product_id: c.id, quantity: 3, unit_price_cents: 500, name: c.name },
    ],
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.total_cents, 5 * 1000 + 3 * 500);
  const itemMap = Object.fromEntries(
    (updated.json.items || []).map((it) => [it.product_id, it.quantity])
  );
  assert.equal(itemMap[a.id], 5);
  assert.equal(itemMap[c.id], 3);
  assert.equal(itemMap[b.id], undefined);

  const hist = (updated.json.history || []).map((h) => h.note || '').join('\n');
  assert.match(hist, /Produto A Edit/i);
  assert.match(hist, /2 → 5|5/);
  assert.match(hist, /Produto C Edit/i);
  assert.match(hist, /adicionad/i);
  assert.match(hist, /Produto B Edit/i);
  assert.match(hist, /removid/i);
  assert.match(hist, /Total:/i);

  // Merge do mesmo produto
  const merged = await api('PUT', `/api/delivery-orders/${orderId}`, {
    address: 'Rua Teste',
    address_number: '10',
    city: 'São Paulo',
    items: [
      { product_id: a.id, quantity: 5, unit_price_cents: 1000, name: a.name },
      { product_id: a.id, quantity: 3, unit_price_cents: 1000, name: a.name },
      { product_id: c.id, quantity: 3, unit_price_cents: 500, name: c.name },
    ],
  });
  assert.equal(merged.status, 200, JSON.stringify(merged.json));
  const linesA = (merged.json.items || []).filter((it) => it.product_id === a.id);
  assert.equal(linesA.length, 1, 'não deve duplicar linha do mesmo produto');
  assert.equal(linesA[0].quantity, 8);
  assert.equal(merged.json.total_cents, 8 * 1000 + 3 * 500);

  // Estoque físico não baixado (ainda não pago); reserva reajustada
  const stockAfter = {
    a: getDb().prepare('SELECT stock_qty, reserved_qty FROM products WHERE id = ?').get(a.id),
    b: getDb().prepare('SELECT stock_qty, reserved_qty FROM products WHERE id = ?').get(b.id),
    c: getDb().prepare('SELECT stock_qty, reserved_qty FROM products WHERE id = ?').get(c.id),
  };
  assert.equal(stockAfter.a.stock_qty, stockBefore.a);
  assert.equal(stockAfter.b.stock_qty, stockBefore.b);
  assert.equal(stockAfter.c.stock_qty, stockBefore.c);
  assert.equal(stockAfter.a.reserved_qty, reservedBefore.a + 8);
  assert.equal(stockAfter.b.reserved_qty, reservedBefore.b);
  assert.equal(stockAfter.c.reserved_qty, reservedBefore.c + 3);

  // Pedido pago bloqueia edição
  const pay = await api('POST', `/api/delivery-orders/${orderId}/payments`, {
    client_request_id: `pay-edit-${Date.now()}`,
    payments: [{ method: 'dinheiro', amount_cents: merged.json.total_cents }],
  });
  assert.ok(pay.status === 200 || pay.status === 201, JSON.stringify(pay.json));
  const blocked = await api('PUT', `/api/delivery-orders/${orderId}`, {
    address: 'Rua Teste',
    address_number: '10',
    city: 'São Paulo',
    items: [{ product_id: a.id, quantity: 1, unit_price_cents: 1000 }],
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.code, 'ORDER_ALREADY_PAID');
});

test('pedido vazio na edição é rejeitado pelo servidor', async () => {
  const p = await product('Vazio Edit', 10, 300);
  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `empty-ord-${Date.now()}`,
    customer_name: 'Vazio',
    address: 'Rua V',
    address_number: '1',
    city: 'Campinas',
    items: [{ product_id: p.id, quantity: 1, unit_price_cents: 300 }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const empty = await api('PUT', `/api/delivery-orders/${created.json.id}`, {
    address: 'Rua V',
    address_number: '1',
    city: 'Campinas',
    items: [],
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.code, 'ORDER_EMPTY');
});
