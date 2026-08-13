import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-f2-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'fase2.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const {
  findDuplicateCandidates,
  mergeProducts,
  normalizeProductName,
} = await import('./services/duplicateProductsService.js');
const { setStockBalance, getProductStockHistory } = await import('./services/stockService.js');

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
  return { status: res.status, json, text };
}

before(async () => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  ensureBootstrapAdmin();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('normaliza nomes para comparar duplicidade', () => {
  assert.equal(
    normalizeProductName('Detergente Limpol 500ml'),
    normalizeProductName('DETERGENTE LIMPOL 500 ML')
  );
});

test('detecta duplicidade por código de barras e nome semelhante', async () => {
  const a = await api('POST', '/api/products', {
    name: 'Detergente Limpol 500ml',
    barcode: '7891001001001',
    price_cents: 500,
    stock_qty: 10,
  });
  assert.equal(a.status, 201);
  const b = await api('POST', '/api/products', {
    name: 'DETERGENTE LIMPOL 500 ML',
    barcode: '7891001001002',
    price_cents: 550,
    stock_qty: 3,
    confirm_similar_name: true,
  });
  assert.equal(b.status, 201);
  const dupBar = await api('POST', '/api/products', {
    name: 'Outro',
    barcode: '7891001001001',
    price_cents: 100,
  });
  assert.equal(dupBar.status, 409);
  assert.equal(dupBar.json.code, 'DUPLICATE_BARCODE');

  const found = findDuplicateCandidates();
  assert.ok(found.candidates.some((c) => c.match_type === 'name_exact' || c.match_type === 'name_similar'));
  assert.ok(found.totals.open >= 1);
});

test('bloqueia sku duplicado e permite mesmo nome', async () => {
  const p = await api('POST', '/api/products', {
    name: 'Água Sanitária 1L',
    sku: 'SKU-F2-AS',
    price_cents: 400,
  });
  assert.equal(p.status, 201);
  const skuDup = await api('POST', '/api/products', {
    name: 'Outra Água',
    sku: 'SKU-F2-AS',
    price_cents: 400,
  });
  assert.equal(skuDup.status, 409);
  assert.equal(skuDup.json.code, 'DUPLICATE_SKU');
  assert.match(String(skuDup.json.error || ''), /Já existe um produto com este código/i);

  const sameName = await api('POST', '/api/products', {
    name: 'Água Sanitária 1L',
    sku: 'SKU-F2-AS2',
    price_cents: 410,
  });
  assert.equal(sameName.status, 201, JSON.stringify(sameName.json));
  assert.equal(sameName.json.name, 'Água Sanitária 1L');
});

test('mesclagem segura consolida estoque e faz rollback em erro', async () => {
  const p1 = await api('POST', '/api/products', {
    name: 'Sabão em Pó Merge Primário XYZ',
    barcode: '7900000000001',
    price_cents: 1000,
    stock_qty: 10,
  });
  const p2 = await api('POST', '/api/products', {
    name: 'Esponja Multiuso Merge Secundário QWE',
    barcode: '7900000000002',
    price_cents: 1100,
    stock_qty: 5,
  });
  assert.equal(p1.status, 201, JSON.stringify(p1.json));
  assert.equal(p2.status, 201, JSON.stringify(p2.json));

  // venda no secundário
  await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Admin',
    opening_amount_cents: 0,
  });
  const sale = await api('POST', '/api/sales', {
    client_request_id: `f2-merge-${Date.now()}`,
    payment_method: 'dinheiro',
    items: [{ product_id: p2.json.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201);

  const preview = await api(
    'GET',
    `/api/products/merge/preview?primary_id=${p1.json.id}&secondary_id=${p2.json.id}`
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.json.stock_rules.sum, 10 + 4); // 5-1 venda

  const noConfirm = await api('POST', '/api/products/merge', {
    primary_id: p1.json.id,
    secondary_id: p2.json.id,
    stock_rule: 'sum',
  });
  assert.equal(noConfirm.status, 400);

  const merged = await api('POST', '/api/products/merge', {
    primary_id: p1.json.id,
    secondary_id: p2.json.id,
    stock_rule: 'sum',
    confirm: true,
  });
  assert.equal(merged.status, 201);
  assert.equal(merged.json.stock_after, 14);
  assert.ok(merged.json.sales_reassigned >= 1);

  const primary = await api('GET', `/api/products/${p1.json.id}`);
  const secondary = await api('GET', `/api/products/${p2.json.id}`);
  assert.equal(primary.json.stock_qty, 14);
  assert.equal(secondary.json.active, 0);

  const saleItem = getDb()
    .prepare(`SELECT product_id FROM sale_items WHERE sale_id = ?`)
    .get(sale.json.id);
  assert.equal(saleItem.product_id, p1.json.id);

  // rollback: forçar falha com ids inválidos
  assert.throws(
    () =>
      mergeProducts({
        primary_id: p1.json.id,
        secondary_id: 999999,
        stock_rule: 'sum',
        confirm: true,
      }),
    /não encontrado/i
  );
});

test('ajustar estoque: entrada, saída e definir saldo', async () => {
  const p = await api('POST', '/api/products', {
    name: 'Produto Estoque F2',
    barcode: '7900000000099',
    price_cents: 200,
    stock_qty: 10,
  });
  assert.equal(p.status, 201);
  const id = p.json.id;

  const entry = await api('POST', '/api/stock/movements', {
    product_id: id,
    movement_type: 'entry',
    quantity: 5,
    reason: 'Compra avulsa',
  });
  assert.equal(entry.status, 201);
  assert.equal(entry.json.stock_after, 15);
  assert.equal(entry.json.stock_before, 10);

  const exit = await api('POST', '/api/stock/movements', {
    product_id: id,
    movement_type: 'exit',
    quantity: 3,
    reason: 'Perda',
  });
  assert.equal(exit.status, 201);
  assert.equal(exit.json.stock_after, 12);

  const setBal = await api('POST', '/api/stock/set-balance', {
    product_id: id,
    new_qty: 8,
    reason: 'Inventário',
    note: 'Contagem física',
  });
  assert.equal(setBal.status, 201);
  assert.equal(setBal.json.stock_before, 12);
  assert.equal(setBal.json.quantity_delta, -4);
  assert.equal(setBal.json.stock_after, 8);

  assert.throws(
    () =>
      setStockBalance({
        product_id: id,
        new_qty: 8,
        reason: 'igual',
      }),
    /igual/i
  );

  const hist = await api('GET', `/api/products/${id}/history`);
  assert.equal(hist.status, 200);
  assert.ok(hist.json.movements.length >= 3);
  assert.ok(hist.json.movements.every((m) => m.stock_before != null));

  const hist2 = getProductStockHistory(id);
  assert.equal(hist2.product.stock_qty, 8);
});

test('venda após ajuste usa estoque atualizado', async () => {
  const p = await api('POST', '/api/products', {
    name: 'Venda Pós Ajuste',
    barcode: '7900000000088',
    price_cents: 300,
    stock_qty: 5,
  });
  await api('POST', '/api/stock/set-balance', {
    product_id: p.json.id,
    new_qty: 2,
    reason: 'Ajuste pré-venda',
  });
  let cash = await api('GET', '/api/cash/sessions/current');
  if (!cash.json) {
    await api('POST', '/api/cash/sessions/open', {
      operator_name: 'Admin',
      opening_amount_cents: 0,
    });
  }
  const sale = await api('POST', '/api/sales', {
    client_request_id: `f2-sale-${Date.now()}`,
    payment_method: 'pix',
    items: [{ product_id: p.json.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201);
  const after = await api('GET', `/api/products/${p.json.id}`);
  assert.equal(after.json.stock_qty, 1);

  const insufficient = await api('POST', '/api/sales', {
    client_request_id: `f2-sale-fail-${Date.now()}`,
    payment_method: 'pix',
    items: [{ product_id: p.json.id, quantity: 5 }],
  });
  assert.equal(insufficient.status, 409);
});

test('integridade SQLite após operações fase 2', () => {
  const db = getDb();
  db.pragma('foreign_keys = ON');
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
