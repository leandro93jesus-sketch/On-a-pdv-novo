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

let server;
let baseUrl;
let db;

function insertProduct(overrides = {}) {
  const info = db
    .prepare(
      `INSERT INTO products (sku, barcode, name, category, price_cents, cost_cents, stock_qty, allow_negative_stock, active)
       VALUES (@sku, @barcode, @name, @category, @price_cents, @cost_cents, @stock_qty, @allow_negative_stock, 1)`
    )
    .run({
      sku: overrides.sku ?? `SKU-${Math.random().toString(36).slice(2, 8)}`,
      barcode: overrides.barcode ?? null,
      name: overrides.name ?? 'Produto Teste',
      category: overrides.category ?? 'Teste',
      price_cents: overrides.price_cents ?? 1000,
      cost_cents: overrides.cost_cents ?? 400,
      stock_qty: overrides.stock_qty ?? 10,
      allow_negative_stock: overrides.allow_negative_stock ?? 0,
    });
  return Number(info.lastInsertRowid);
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
  `);
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

test('busca produto por código de barras', async () => {
  insertProduct({ barcode: '7891000100103', name: 'Água', price_cents: 350, stock_qty: 5 });
  const res = await fetch(`${baseUrl}/api/products?barcode=7891000100103`);
  assert.equal(res.status, 200);
  const products = await res.json();
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Água');
});

test('finaliza venda, persiste e baixa estoque', async () => {
  const id = insertProduct({
    name: 'Café',
    barcode: '111',
    price_cents: 1000,
    stock_qty: 5,
  });

  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_method: 'pix',
      discount_cents: 100,
      items: [{ product_id: id, quantity: 2 }],
    }),
  });
  const saleBody = await res.json();
  assert.equal(res.status, 201, JSON.stringify(saleBody));
  const sale = saleBody;

  assert.equal(sale.subtotal_cents, 2000);
  assert.equal(sale.discount_cents, 100);
  assert.equal(sale.total_cents, 1900);
  assert.equal(sale.payment_method, 'pix');
  assert.equal(sale.items.length, 1);
  assert.ok(sale.sale_number.startsWith('VD-'));

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

test('bloqueia estoque negativo sem regra explícita', async () => {
  const id = insertProduct({ name: 'Arroz', price_cents: 2000, stock_qty: 1 });

  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_method: 'dinheiro',
      items: [{ product_id: id, quantity: 3 }],
    }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.code, 'STOCK_INSUFFICIENT');

  const product = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id);
  assert.equal(product.stock_qty, 1);
  const salesCount = db.prepare('SELECT COUNT(*) AS c FROM sales').get().c;
  assert.equal(salesCount, 0);
});

test('permite estoque negativo quando allow_negative_stock = 1', async () => {
  const id = insertProduct({
    name: 'Produto Liberado',
    price_cents: 500,
    stock_qty: 1,
    allow_negative_stock: 1,
  });

  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_method: 'cartao',
      items: [{ product_id: id, quantity: 3 }],
    }),
  });
  assert.equal(res.status, 201);
  const product = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id);
  assert.equal(product.stock_qty, -2);
});

test('item diversos não altera estoque', async () => {
  const id = insertProduct({ name: 'Queijo', price_cents: 650, stock_qty: 10 });

  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
  });
  assert.equal(res.status, 201);
  const sale = await res.json();
  assert.equal(sale.total_cents, 850);
  assert.equal(sale.items.filter((i) => i.is_misc).length, 1);

  const product = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id);
  assert.equal(product.stock_qty, 9);
});

test('rejeita venda vazia', async () => {
  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'EMPTY_CART');
});

test('aceita múltiplas formas de pagamento (preparado para o futuro)', async () => {
  const id = insertProduct({ name: 'Feijão', price_cents: 1000, stock_qty: 5 });
  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ product_id: id, quantity: 1 }],
      payments: [
        { method: 'dinheiro', amount_cents: 400 },
        { method: 'pix', amount_cents: 600 },
      ],
    }),
  });
  assert.equal(res.status, 201);
  const sale = await res.json();
  assert.equal(sale.payments.length, 2);
  assert.equal(
    sale.payments.reduce((s, p) => s + p.amount_cents, 0),
    1000
  );
});

test('comprovante contém itens e pagamentos', async () => {
  const id = insertProduct({ name: 'Detergente', price_cents: 390, stock_qty: 8 });
  const createRes = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_method: 'cartao',
      items: [{ product_id: id, quantity: 2 }],
    }),
  });
  const created = await createRes.json();
  const res = await fetch(`${baseUrl}/api/sales/${created.id}`);
  assert.equal(res.status, 200);
  const sale = await res.json();
  assert.equal(sale.items[0].name, 'Detergente');
  assert.equal(sale.items[0].quantity, 2);
  assert.equal(sale.payments[0].method, 'cartao');
  assert.equal(sale.total_cents, 780);
});
