import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(mkdtempSync(join(tmpdir(), 'pdv-test-')), 'test.db');

const { app } = await import('./index.js');

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
});

test('health endpoint responds ok', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('products are seeded', async () => {
  const res = await fetch(`${baseUrl}/api/products`);
  assert.equal(res.status, 200);
  const products = await res.json();
  assert.ok(products.length >= 10);
  assert.ok(products.every((p) => typeof p.price_cents === 'number'));
});

test('completing a sale persists items and total', async () => {
  const productsRes = await fetch(`${baseUrl}/api/products`);
  const products = await productsRes.json();
  const [a, b] = products;

  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payment_method: 'cartao',
      items: [
        { product_id: a.id, quantity: 2 },
        { product_id: b.id, quantity: 1 },
      ],
    }),
  });
  assert.equal(res.status, 201);
  const sale = await res.json();
  const expectedTotal = a.price_cents * 2 + b.price_cents * 1;
  assert.equal(sale.total_cents, expectedTotal);
  assert.equal(sale.payment_method, 'cartao');
  assert.equal(sale.items.length, 2);

  const listRes = await fetch(`${baseUrl}/api/sales`);
  const sales = await listRes.json();
  assert.ok(sales.some((s) => s.id === sale.id));
});

test('rejects empty sale', async () => {
  const res = await fetch(`${baseUrl}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [] }),
  });
  assert.equal(res.status, 400);
});
