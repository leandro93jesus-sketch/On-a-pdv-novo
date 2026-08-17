import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-test-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'test.db');
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { openCashSession } = await import('./services/cashService.js');

let server;
let baseUrl;
let db;

function insertProduct(overrides = {}) {
  const info = db
    .prepare(
      `INSERT INTO products (sku, barcode, name, category, price_cents, cost_cents, stock_qty, min_stock_qty, allow_negative_stock, active)
       VALUES (@sku, @barcode, @name, @category, @price_cents, @cost_cents, @stock_qty, @min_stock_qty, @allow_negative_stock, 1)`
    )
    .run({
      sku: overrides.sku ?? `SKU-${Math.random().toString(36).slice(2, 8)}`,
      barcode: overrides.barcode ?? null,
      name: overrides.name ?? 'Produto Teste',
      category: overrides.category ?? 'Teste',
      price_cents: overrides.price_cents ?? 1000,
      cost_cents: overrides.cost_cents ?? 400,
      stock_qty: overrides.stock_qty ?? 10,
      min_stock_qty: overrides.min_stock_qty ?? 0,
      allow_negative_stock: overrides.allow_negative_stock ?? 0,
    });
  return Number(info.lastInsertRowid);
}

async function postSale(body) {
  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { res, json };
}

function resetCash() {
  db.exec(`
    DELETE FROM cash_movements;
    DELETE FROM cash_sessions;
  `);
  openCashSession({
    terminal_id: 'TERM-1',
    operator_name: 'Operador Teste',
    opening_amount_cents: 10000,
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

test('health responde ok', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.name, 'ONÇA PDV');
});

test('busca produto por código de barras e por nome', async () => {
  insertProduct({ barcode: '7891000100103', name: 'Água Mineral', sku: 'BEB-001', price_cents: 350, stock_qty: 5 });
  const byBarcode = await fetch(`${baseUrl}/api/products?barcode=7891000100103`).then((r) => r.json());
  assert.equal(byBarcode.length, 1);
  assert.equal(byBarcode[0].name, 'Água Mineral');

  const byName = await fetch(`${baseUrl}/api/products?q=Água`).then((r) => r.json());
  assert.ok(byName.some((p) => p.name === 'Água Mineral'));

  const bySku = await fetch(`${baseUrl}/api/products?q=BEB-001`).then((r) => r.json());
  assert.equal(bySku.length, 1);
});

test('finaliza venda, persiste e baixa estoque', async () => {
  const id = insertProduct({
    name: 'Café',
    barcode: '111',
    price_cents: 1000,
    stock_qty: 5,
  });

  const { res, json: sale } = await postSale({
    payment_method: 'pix',
    discount_cents: 100,
    items: [{ product_id: id, quantity: 2 }],
  });
  assert.equal(res.status, 201, JSON.stringify(sale));

  assert.equal(sale.subtotal_cents, 2000);
  assert.equal(sale.discount_cents, 100);
  assert.equal(sale.total_cents, 1900);
  assert.equal(sale.payment_method, 'pix');
  assert.equal(sale.items.length, 1);
  assert.ok(sale.sale_number.startsWith('VD-'));
  assert.ok(sale.cash_session_id);

  const product = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id);
  assert.equal(product.stock_qty, 3);

  const movement = db
    .prepare('SELECT quantity_delta, stock_after, movement_type FROM stock_movements WHERE product_id = ?')
    .get(id);
  assert.equal(movement.quantity_delta, -2);
  assert.equal(movement.stock_after, 3);
  assert.equal(movement.movement_type, 'sale');

  const hist = await fetch(`${baseUrl}/api/sales`);
  const sales = await hist.json();
  assert.ok(sales.some((s) => s.id === sale.id));
});

test('permite venda com estoque insuficiente (estoque fica negativo)', async () => {
  const id = insertProduct({ name: 'Arroz', price_cents: 2000, stock_qty: 1 });

  const { res } = await postSale({
    payment_method: 'dinheiro',
    items: [{ product_id: id, quantity: 3 }],
  });
  assert.equal(res.status, 201);

  const product = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id);
  assert.equal(product.stock_qty, -2);
});

test('agrega estoque quando o mesmo produto aparece em várias linhas', async () => {
  const id = insertProduct({ name: 'Biscoito', price_cents: 200, stock_qty: 5 });
  const { res } = await postSale({
    payment_method: 'dinheiro',
    items: [
      { product_id: id, quantity: 3 },
      { product_id: id, quantity: 3 },
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id).stock_qty, -1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sales').get().c, 1);
});

test('permite estoque negativo quando allow_negative_stock = 1', async () => {
  const id = insertProduct({
    name: 'Produto Liberado',
    price_cents: 500,
    stock_qty: 1,
    allow_negative_stock: 1,
  });

  const { res } = await postSale({
    payment_method: 'cartao',
    card_type: 'CREDIT',
    items: [{ product_id: id, quantity: 3 }],
  });
  assert.equal(res.status, 201);
  const product = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id);
  assert.equal(product.stock_qty, -2);
});

test('item diversos não altera estoque e fica registrado', async () => {
  const id = insertProduct({ name: 'Queijo', price_cents: 650, stock_qty: 10 });

  const { res, json: sale } = await postSale({
    payment_method: 'dinheiro',
    items: [
      { product_id: id, quantity: 1 },
      {
        is_misc: true,
        name: 'Embalagem especial',
        unit_price_cents: 200,
        quantity: 1,
      },
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(sale.total_cents, 850);
  assert.equal(sale.items.filter((i) => i.is_misc).length, 1);
  assert.equal(sale.items.find((i) => i.is_misc).name, 'Embalagem especial');

  const product = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id);
  assert.equal(product.stock_qty, 9);
});

test('rejeita venda vazia', async () => {
  const { res, json: body } = await postSale({ items: [] });
  assert.equal(res.status, 400);
  assert.equal(body.code, 'EMPTY_CART');
});

test('rejeita desconto inválido e total negativo', async () => {
  const id = insertProduct({ name: 'Leite', price_cents: 500, stock_qty: 10 });

  const neg = await postSale({
    payment_method: 'pix',
    discount_cents: -10,
    items: [{ product_id: id, quantity: 1 }],
  });
  assert.equal(neg.res.status, 400);
  assert.equal(neg.json.code, 'INVALID_MONEY');

  const over = await postSale({
    payment_method: 'pix',
    discount_cents: 9999,
    items: [{ product_id: id, quantity: 1 }],
  });
  assert.equal(over.res.status, 400);
  assert.equal(over.json.code, 'INVALID_DISCOUNT');
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id).stock_qty, 10);
});

test('grava dinheiro, pix e cartão corretamente', async () => {
  for (const method of ['dinheiro', 'pix', 'cartao']) {
    const id = insertProduct({ name: `Prod ${method}`, price_cents: 100, stock_qty: 5 });
    const { res, json: sale } = await postSale({
      payment_method: method,
      ...(method === 'cartao' ? { card_type: 'CREDIT' } : {}),
      items: [{ product_id: id, quantity: 1 }],
    });
    assert.equal(res.status, 201);
    assert.equal(sale.payment_method, method === 'cartao' ? 'cartao_credito' : method);
    const pay = db.prepare('SELECT method, card_type FROM sale_payments WHERE sale_id = ?').get(sale.id);
    assert.equal(pay.method, method);
    if (method === 'cartao') assert.equal(pay.card_type, 'CREDIT');
  }
});

test('reenvio com client_request_id não duplica venda nem estoque', async () => {
  const id = insertProduct({ name: 'Sabão', price_cents: 300, stock_qty: 10 });
  const payload = {
    client_request_id: 'idem-abc-123',
    payment_method: 'pix',
    items: [{ product_id: id, quantity: 2 }],
  };

  const first = await postSale(payload);
  const second = await postSale(payload);
  assert.equal(first.res.status, 201);
  assert.equal(second.res.status, 201);
  assert.equal(first.json.id, second.json.id);
  assert.equal(first.json.sale_number, second.json.sale_number);

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sales').get().c, 1);
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id).stock_qty, 8);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?').get(id).c,
    1
  );
});

test('falha no meio da gravação faz rollback completo', async () => {
  const id = insertProduct({ name: 'TriggerFail', price_cents: 400, stock_qty: 10 });
  db.exec(`
    CREATE TRIGGER fail_after_stock
    AFTER UPDATE ON products
    BEGIN
      SELECT RAISE(ABORT, 'falha simulada após baixa de estoque');
    END;
  `);

  const { res, json } = await postSale({
    payment_method: 'dinheiro',
    items: [{ product_id: id, quantity: 2 }],
  });

  db.exec('DROP TRIGGER fail_after_stock');

  assert.equal(res.status, 500);
  assert.equal(json.code, 'TRANSACTION_FAILED');
  assert.ok(json.error);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sales').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sale_items').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM sale_payments').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get().c, 0);
  assert.equal(db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id).stock_qty, 10);
});

test('comprovante e histórico contêm dados completos', async () => {
  const id = insertProduct({ name: 'Detergente', barcode: '999', price_cents: 390, stock_qty: 8 });
  const { json: created } = await postSale({
    payment_method: 'cartao',
    card_type: 'CREDIT',
    discount_cents: 40,
    items: [
      { product_id: id, quantity: 2 },
      { is_misc: true, name: 'Sacola', unit_price_cents: 100, quantity: 1 },
    ],
  });

  const sale = await fetch(`${baseUrl}/api/sales/${created.id}`).then((r) => r.json());
  assert.equal(sale.items.length, 2);
  assert.equal(sale.items[0].name, 'Detergente');
  assert.equal(sale.items[0].quantity, 2);
  assert.equal(sale.items[1].name, 'Sacola');
  assert.equal(sale.discount_cents, 40);
  assert.equal(sale.total_cents, 390 * 2 + 100 - 40);
  assert.equal(sale.payments[0].method, 'cartao');

  const list = await fetch(`${baseUrl}/api/sales`).then((r) => r.json());
  const row = list.find((s) => s.id === sale.id);
  assert.ok(row);
  assert.equal(row.sale_number, sale.sale_number);
  assert.ok(row.created_at);
  assert.equal(row.total_cents, sale.total_cents);
  assert.equal(row.payment_method, 'cartao_credito');
});

test('venda sem caixa aberto é bloqueada', async () => {
  db.exec(`DELETE FROM cash_movements; DELETE FROM cash_sessions;`);
  const id = insertProduct({ name: 'Sem Caixa', price_cents: 100, stock_qty: 5 });
  const { res, json } = await postSale({
    payment_method: 'dinheiro',
    items: [{ product_id: id, quantity: 1 }],
  });
  assert.equal(res.status, 409);
  assert.equal(json.code, 'CASH_SESSION_REQUIRED');
});
