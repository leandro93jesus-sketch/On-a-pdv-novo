import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-e3-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'etapa3.db');
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
    operator_name: 'Operador E3',
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
    DELETE FROM credit_payments;
    DELETE FROM credit_installments;
    DELETE FROM credit_accounts;
    DELETE FROM return_items;
    DELETE FROM returns;
    DELETE FROM delivery_history;
    DELETE FROM deliveries;
    DELETE FROM purchase_items;
    DELETE FROM purchases;
    DELETE FROM product_price_history;
    DELETE FROM product_duplicate_reviews;
    DELETE FROM product_merges;
    DELETE FROM cash_session_adjustments;
    DELETE FROM operation_journal;
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

async function seedProduct(stock = 10, price = 1000) {
  const { json } = await api('POST', '/api/products', {
    name: `Prod ${Math.random().toString(36).slice(2, 6)}`,
    sku: `S${Math.random().toString(36).slice(2, 7)}`,
    price_cents: price,
    cost_cents: 400,
    stock_qty: stock,
    min_stock_qty: 2,
  });
  return json;
}

test('1. cadastro de fornecedor', async () => {
  const { res, json } = await api('POST', '/api/suppliers', {
    name: 'Fornecedor ABC Ltda',
    trade_name: 'ABC',
    document: '11222333000181',
    phone: '1133334444',
    city: 'São Paulo',
    state: 'SP',
    contact_name: 'João',
  });
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.equal(json.name, 'Fornecedor ABC Ltda');
  assert.equal(json.trade_name, 'ABC');
});

test('2. edição de fornecedor', async () => {
  const created = await api('POST', '/api/suppliers', { name: 'Editável' });
  const { res, json } = await api('PUT', `/api/suppliers/${created.json.id}`, {
    name: 'Editado SA',
    email: 'contato@editado.com',
  });
  assert.equal(res.status, 200);
  assert.equal(json.name, 'Editado SA');
  assert.equal(json.email, 'contato@editado.com');
});

test('3 e 4. compra concluída atualiza estoque', async () => {
  const supplier = await api('POST', '/api/suppliers', { name: 'Fornecedor Compra' });
  const product = await seedProduct(5, 1000);
  const { res, json } = await api('POST', '/api/purchases', {
    supplier_id: supplier.json.id,
    document_number: 'NF-100',
    items: [{ product_id: product.id, quantity: 4, unit_cost_cents: 600 }],
    freight_cents: 100,
  });
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.equal(json.status, 'completed');
  assert.equal(json.total_cents, 4 * 600 + 100);
  const stock = db.prepare('SELECT stock_qty, cost_cents FROM products WHERE id=?').get(product.id);
  assert.equal(stock.stock_qty, 9);
  assert.equal(stock.cost_cents, 600);
  const mov = db
    .prepare(`SELECT movement_type, quantity_delta FROM stock_movements WHERE product_id=? AND movement_type='purchase'`)
    .get(product.id);
  assert.equal(mov.quantity_delta, 4);
});

test('5 e 6. cancelamento de compra estorna estoque', async () => {
  const supplier = await api('POST', '/api/suppliers', { name: 'Fornecedor Cancel' });
  const product = await seedProduct(2, 500);
  const purchase = await api('POST', '/api/purchases', {
    supplier_id: supplier.json.id,
    items: [{ product_id: product.id, quantity: 3, unit_cost_cents: 200 }],
  });
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty, 5);
  const { res, json } = await api('POST', `/api/purchases/${purchase.json.id}/cancel`, {
    reason: 'Nota incorreta',
  });
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.status, 'cancelled');
  assert.ok(json.cancel_reason);
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM purchases WHERE id=?').get(purchase.json.id).c, 1);
});

test('7 e 8. venda no crediário cria parcelas', async () => {
  const customer = await api('POST', '/api/customers', { name: 'Cliente Crediário', document: '39053344705' });
  const product = await seedProduct(10, 1000);
  const { res, json } = await api('POST', '/api/sales', {
    customer_id: customer.json.id,
    payment_method: 'crediario',
    credit: { entry_cents: 200, installment_count: 4, first_due_date: '2026-09-01' },
    items: [{ product_id: product.id, quantity: 1 }],
  });
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.equal(json.payment_method, 'crediario');
  const accounts = await api('GET', '/api/credit/accounts');
  assert.ok(accounts.json.length >= 1);
  const account = await api('GET', `/api/credit/accounts/${accounts.json[0].id}`);
  assert.equal(account.json.installment_count, 4);
  assert.equal(account.json.entry_cents, 200);
  assert.equal(account.json.balance_cents, 800);
  assert.equal(account.json.installments.length, 4);
  assert.equal(
    account.json.installments.reduce((s, i) => s + i.amount_cents, 0),
    800
  );
});

test('9. pagamento parcial', async () => {
  const customer = await api('POST', '/api/customers', { name: 'Parcial' });
  const product = await seedProduct(5, 1000);
  await api('POST', '/api/sales', {
    customer_id: customer.json.id,
    payment_method: 'crediario',
    credit: { installment_count: 2, first_due_date: '2026-09-01' },
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const list = await api('GET', '/api/credit/accounts');
  const { res, json } = await api('POST', '/api/credit/payments', {
    credit_account_id: list.json[0].id,
    amount_cents: 300,
    method: 'pix',
  });
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.equal(json.balance_cents, 700);
  assert.ok(['parcialmente_pago', 'aberto', 'vencido'].includes(json.status));
  assert.ok(json.payments.length >= 1);
});

test('10. quitação', async () => {
  const customer = await api('POST', '/api/customers', { name: 'Quita' });
  const product = await seedProduct(5, 500);
  await api('POST', '/api/sales', {
    customer_id: customer.json.id,
    payment_method: 'crediario',
    credit: { installment_count: 1, first_due_date: '2026-09-01' },
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const list = await api('GET', '/api/credit/accounts');
  const { res, json } = await api('POST', '/api/credit/payments', {
    credit_account_id: list.json[0].id,
    amount_cents: 500,
    method: 'dinheiro',
  });
  assert.equal(res.status, 201);
  assert.equal(json.balance_cents, 0);
  assert.equal(json.status, 'quitado');
});

test('11. parcela vencida', async () => {
  const customer = await api('POST', '/api/customers', { name: 'Vencido' });
  const product = await seedProduct(5, 900);
  await api('POST', '/api/sales', {
    customer_id: customer.json.id,
    payment_method: 'crediario',
    credit: { installment_count: 1, first_due_date: '2020-01-01' },
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const list = await api('GET', '/api/credit/accounts');
  const detail = await api('GET', `/api/credit/accounts/${list.json[0].id}`);
  assert.equal(detail.json.installments[0].status, 'vencido');
  assert.equal(detail.json.status, 'vencido');
  const summary = await api('GET', '/api/credit/summary');
  assert.ok(summary.json.total_overdue_cents >= 900);
});

test('12 e 15. devolução parcial retorna estoque', async () => {
  const product = await seedProduct(10, 400);
  const sale = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: product.id, quantity: 4 }],
  });
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty, 6);
  const itemId = sale.json.items[0].id;
  const { res, json } = await api('POST', '/api/returns', {
    sale_id: sale.json.id,
    reason: 'Produto com defeito',
    items: [{ sale_item_id: itemId, quantity: 2 }],
  });
  assert.equal(res.status, 201, JSON.stringify(json));
  assert.equal(json.items[0].quantity, 2);
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty, 8);
  assert.ok(
    db.prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE movement_type='return' AND product_id=?`).get(product.id)
      .c >= 1
  );
});

test('13. devolução total', async () => {
  const product = await seedProduct(5, 300);
  const sale = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    items: [{ product_id: product.id, quantity: 2 }],
  });
  const itemId = sale.json.items[0].id;
  const { res, json } = await api('POST', '/api/returns', {
    sale_id: sale.json.id,
    reason: 'Desistência',
    items: [{ sale_item_id: itemId, quantity: 2 }],
  });
  assert.equal(res.status, 201);
  assert.equal(json.total_cents, 600);
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty, 5);
});

test('14. bloqueio devolução acima da quantidade', async () => {
  const product = await seedProduct(5, 300);
  const sale = await api('POST', '/api/sales', {
    payment_method: 'cartao',
    items: [{ product_id: product.id, quantity: 2 }],
  });
  const itemId = sale.json.items[0].id;
  const { res, json } = await api('POST', '/api/returns', {
    sale_id: sale.json.id,
    reason: 'Tentativa inválida',
    items: [{ sale_item_id: itemId, quantity: 5 }],
  });
  assert.equal(res.status, 409);
  assert.equal(json.code, 'RETURN_QTY_EXCEEDED');
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty, 3);
});

test('16 17 18. entrega, status e histórico', async () => {
  const customer = await api('POST', '/api/customers', {
    name: 'Cliente Entrega',
    phone: '11999998888',
    address: 'Rua A',
    city: 'Campinas',
    state: 'SP',
  });
  const product = await seedProduct(5, 200);
  const sale = await api('POST', '/api/sales', {
    customer_id: customer.json.id,
    payment_method: 'pix',
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const created = await api('POST', '/api/deliveries', {
    sale_id: sale.json.id,
    scheduled_date: '2026-08-10',
    period: 'manhã',
    courier_name: 'Motoboy 1',
  });
  assert.equal(created.res.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.status, 'pendente');
  assert.equal(created.json.history.length, 1);

  const updated = await api('POST', `/api/deliveries/${created.json.id}/status`, {
    status: 'saiu_para_entrega',
    note: 'Saiu às 10h',
  });
  assert.equal(updated.res.status, 200);
  assert.equal(updated.json.status, 'saiu_para_entrega');
  assert.ok(updated.json.history.length >= 2);

  const delivered = await api('POST', `/api/deliveries/${created.json.id}/status`, {
    status: 'entregue',
    note: 'Recebido',
  });
  assert.equal(delivered.json.status, 'entregue');
  assert.ok(delivered.json.history.some((h) => h.to_status === 'entregue'));
});

test('20. integridade SQLite etapa 3', async () => {
  const supplier = await api('POST', '/api/suppliers', { name: 'Integ Forn' });
  const product = await seedProduct(3, 100);
  await api('POST', '/api/purchases', {
    supplier_id: supplier.json.id,
    items: [{ product_id: product.id, quantity: 1, unit_cost_cents: 50 }],
  });
  const orphanPurchases = db
    .prepare(
      `SELECT COUNT(*) AS c FROM purchase_items pi LEFT JOIN purchases p ON p.id=pi.purchase_id WHERE p.id IS NULL`
    )
    .get().c;
  const orphanReturns = db
    .prepare(
      `SELECT COUNT(*) AS c FROM return_items ri LEFT JOIN returns r ON r.id=ri.return_id WHERE r.id IS NULL`
    )
    .get().c;
  const neg = db
    .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock=0`)
    .get().c;
  assert.equal(orphanPurchases, 0);
  assert.equal(orphanReturns, 0);
  assert.equal(neg, 0);
});
