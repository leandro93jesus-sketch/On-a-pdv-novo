import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-e2-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'etapa2.db');
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { openCashSession } = await import('./services/cashService.js');

let server;
let baseUrl;
let db;

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

function resetCash() {
  db.exec('DELETE FROM cash_movements; DELETE FROM cash_sessions;');
  return openCashSession({
    terminal_id: 'TERM-1',
    operator_name: 'Operador E2',
    opening_amount_cents: 5000,
  });
}

before(async () => {
  db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM stock_movements;
    DELETE FROM sale_payments;
    DELETE FROM sale_items;
    DELETE FROM sales;
    DELETE FROM products;
    DELETE FROM customers;
    DELETE FROM suppliers;
    DELETE FROM audit_logs;
  `);
  resetCash();
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('1. cadastro de produto', async () => {
  const { res, json } = await api('POST', '/api/products', {
    name: 'Produto Novo',
    sku: 'SKU-NEW',
    barcode: '1234567890123',
    category: 'Geral',
    unit: 'UN',
    price_cents: 1500,
    cost_cents: 800,
    stock_qty: 10,
    min_stock_qty: 3,
    notes: 'Obs',
  });
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.equal(json.name, 'Produto Novo');
  assert.equal(json.stock_qty, 10);
  assert.equal(json.min_stock_qty, 3);
  const mov = db.prepare('SELECT movement_type, quantity_delta FROM stock_movements WHERE product_id=?').get(json.id);
  assert.equal(mov.movement_type, 'entry');
  assert.equal(mov.quantity_delta, 10);
});

test('2. edição de produto', async () => {
  const created = await api('POST', '/api/products', {
    name: 'Editar',
    sku: 'SKU-ED',
    price_cents: 100,
    stock_qty: 0,
  });
  const { res, json } = await api('PUT', `/api/products/${created.json.id}`, {
    name: 'Editado',
    price_cents: 250,
    min_stock_qty: 5,
  });
  assert.equal(res.status, 200);
  assert.equal(json.name, 'Editado');
  assert.equal(json.price_cents, 250);
  assert.equal(json.min_stock_qty, 5);
});

test('3. código de barras duplicado', async () => {
  await api('POST', '/api/products', {
    name: 'A',
    barcode: '9998887776665',
    price_cents: 100,
  });
  const { res, json } = await api('POST', '/api/products', {
    name: 'B',
    barcode: '9998887776665',
    price_cents: 200,
  });
  assert.equal(res.status, 409);
  assert.equal(json.code, 'DUPLICATE_BARCODE');
});

test('4. entrada de estoque', async () => {
  const p = await api('POST', '/api/products', { name: 'Entrada', price_cents: 100, stock_qty: 2 });
  const { res, json } = await api('POST', '/api/stock/movements', {
    product_id: p.json.id,
    movement_type: 'entry',
    quantity: 5,
    reason: 'Compra avulsa',
  });
  assert.equal(res.status, 201);
  assert.equal(json.stock_after, 7);
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id=?').get(p.json.id).stock_qty, 7);
});

test('5. saída de estoque', async () => {
  const p = await api('POST', '/api/products', { name: 'Saída', price_cents: 100, stock_qty: 8 });
  const { res, json } = await api('POST', '/api/stock/movements', {
    product_id: p.json.id,
    movement_type: 'exit',
    quantity: 3,
    reason: 'Perda',
  });
  assert.equal(res.status, 201);
  assert.equal(json.stock_after, 5);
});

test('6. ajuste de estoque', async () => {
  const p = await api('POST', '/api/products', { name: 'Ajuste', price_cents: 100, stock_qty: 4 });
  const up = await api('POST', '/api/stock/movements', {
    product_id: p.json.id,
    movement_type: 'adjust_in',
    quantity: 2,
    reason: 'Inventário +',
  });
  assert.equal(up.res.status, 201);
  assert.equal(up.json.stock_after, 6);
  const down = await api('POST', '/api/stock/movements', {
    product_id: p.json.id,
    movement_type: 'adjust_out',
    quantity: 1,
    reason: 'Inventário -',
  });
  assert.equal(down.res.status, 201);
  assert.equal(down.json.stock_after, 5);
});

test('7. estoque baixo', async () => {
  await api('POST', '/api/products', {
    name: 'Baixo',
    price_cents: 100,
    stock_qty: 2,
    min_stock_qty: 5,
  });
  await api('POST', '/api/products', {
    name: 'Ok',
    price_cents: 100,
    stock_qty: 20,
    min_stock_qty: 5,
  });
  const { json } = await api('GET', '/api/stock?alerts=1');
  assert.ok(json.some((r) => r.name === 'Baixo' && r.situation === 'baixo'));
  assert.ok(!json.some((r) => r.name === 'Ok'));
});

test('8. abertura de caixa', async () => {
  db.exec('DELETE FROM cash_movements; DELETE FROM cash_sessions;');
  const { res, json } = await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Maria',
    opening_amount_cents: 2000,
    terminal_id: 'TERM-1',
  });
  assert.equal(res.status, 201);
  assert.equal(json.status, 'open');
  assert.equal(json.operator_name, 'Maria');
  assert.equal(json.opening_amount_cents, 2000);

  const dup = await api('POST', '/api/cash/sessions/open', {
    operator_name: 'João',
    opening_amount_cents: 100,
    terminal_id: 'TERM-1',
  });
  assert.equal(dup.res.status, 409);
  assert.equal(dup.json.code, 'CASH_ALREADY_OPEN');
});

test('9. venda vinculada ao caixa', async () => {
  const p = await api('POST', '/api/products', { name: 'Vinculo', price_cents: 500, stock_qty: 5 });
  const { res, json } = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: p.json.id, quantity: 1 }],
  });
  assert.equal(res.status, 201);
  assert.ok(json.cash_session_id);
  const session = db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(json.cash_session_id);
  assert.equal(session.sales_total_cents, 500);
  assert.equal(session.sales_pix_cents, 500);
});

test('10. fechamento de caixa', async () => {
  const p = await api('POST', '/api/products', { name: 'Fecha', price_cents: 1000, stock_qty: 5 });
  await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    items: [{ product_id: p.json.id, quantity: 1 }],
  });
  // expected = 5000 opening + 1000 dinheiro - 0 = 6000
  const { res, json } = await api('POST', '/api/cash/sessions/close', {
    counted_amount_cents: 5900,
  });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.session.status, 'closed');
  assert.equal(json.expected_amount_cents, 6000);
  assert.equal(json.session.difference_cents, -100);
});

test('11. sangria', async () => {
  const { res, json } = await api('POST', '/api/cash/movements', {
    movement_type: 'sangria',
    amount_cents: 500,
    reason: 'Retirada para cofre',
  });
  assert.equal(res.status, 201);
  assert.equal(json.cash_out_cents, 500);
});

test('12. suprimento', async () => {
  const { res, json } = await api('POST', '/api/cash/movements', {
    movement_type: 'suprimento',
    amount_cents: 800,
    reason: 'Troco adicional',
  });
  assert.equal(res.status, 201);
  assert.equal(json.cash_in_cents, 800);
});

test('13 e 14. cancelamento pós-venda e estorno de estoque', async () => {
  const p = await api('POST', '/api/products', { name: 'Cancelável', price_cents: 700, stock_qty: 10 });
  const sale = await api('POST', '/api/sales', {
    payment_method: 'cartao',
    items: [{ product_id: p.json.id, quantity: 2 }],
  });
  assert.equal(sale.res.status, 201);
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id=?').get(p.json.id).stock_qty, 8);

  const { res, json } = await api('POST', `/api/sales/${sale.json.id}/cancel`, {
    reason: 'Cliente desistiu',
    user_name: 'Operador E2',
  });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.status, 'cancelled');
  assert.equal(json.cancel_reason, 'Cliente desistiu');
  assert.ok(json.cancelled_at);
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id=?').get(p.json.id).stock_qty, 10);
  assert.ok(
    db
      .prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE movement_type='sale_cancel' AND product_id=?`)
      .get(p.json.id).c >= 1
  );
  // venda permanece
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sales WHERE id=?').get(sale.json.id).c, 1);
});

test('15. cadastro de cliente', async () => {
  const { res, json } = await api('POST', '/api/customers', {
    name: 'Ana Silva',
    document: '12345678901',
    phone: '11999990000',
    whatsapp: '11999990000',
    city: 'São Paulo',
    state: 'SP',
  });
  assert.equal(res.status, 201);
  assert.equal(json.name, 'Ana Silva');
  assert.equal(json.document, '12345678901');
});

test('16. venda com cliente', async () => {
  const c = await api('POST', '/api/customers', { name: 'Cliente VIP' });
  const p = await api('POST', '/api/products', { name: 'Com Cliente', price_cents: 300, stock_qty: 5 });
  const { res, json } = await api('POST', '/api/sales', {
    customer_id: c.json.id,
    payment_method: 'pix',
    items: [{ product_id: p.json.id, quantity: 1 }],
  });
  assert.equal(res.status, 201);
  assert.equal(json.customer_id, c.json.id);
  assert.equal(json.customer.name, 'Cliente VIP');
});

test('17. venda sem cliente', async () => {
  const p = await api('POST', '/api/products', { name: 'Sem Cliente', price_cents: 300, stock_qty: 5 });
  const { res, json } = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    items: [{ product_id: p.json.id, quantity: 1 }],
  });
  assert.equal(res.status, 201);
  assert.equal(json.customer_id, null);
});

test('19. integridade do SQLite', async () => {
  const p = await api('POST', '/api/products', { name: 'Integridade', price_cents: 100, stock_qty: 5 });
  const c = await api('POST', '/api/customers', { name: 'Integ Cliente' });
  await api('POST', '/api/sales', {
    customer_id: c.json.id,
    payment_method: 'pix',
    items: [{ product_id: p.json.id, quantity: 1 }],
  });
  const orphanItems = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sale_items si LEFT JOIN sales s ON s.id = si.sale_id WHERE s.id IS NULL`
    )
    .get().c;
  const orphanPays = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sale_payments sp LEFT JOIN sales s ON s.id = sp.sale_id WHERE s.id IS NULL`
    )
    .get().c;
  const neg = db
    .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock = 0`)
    .get().c;
  assert.equal(orphanItems, 0);
  assert.equal(orphanPays, 0);
  assert.equal(neg, 0);
});
