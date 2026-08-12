import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-quick-product-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'test.db');
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { runMigrations } = await import('./db/migrate.js');
const { createProduct, getProductByBarcode, searchProducts } = await import(
  './services/productsService.js'
);

before(() => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  runMigrations(db);
});

after(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('cadastro rápido: cria produto por barcode e localiza na busca da venda', () => {
  const barcode = '7891000100103';
  const product = createProduct({
    name: 'Detergente Teste Rápido',
    barcode,
    price_cents: 599,
    stock_qty: 10,
    min_stock_qty: 2,
    category: 'Limpeza',
    confirm_similar_name: true,
  });

  assert.equal(product.barcode, barcode);
  assert.equal(product.price_cents, 599);
  assert.equal(product.stock_qty, 10);

  const found = getProductByBarcode(barcode);
  assert.ok(found);
  assert.equal(found.id, product.id);

  const search = searchProducts({ barcode });
  assert.equal(search.length, 1);
  assert.equal(search[0].id, product.id);
});

test('cadastro rápido: bloqueia duplicidade de código de barras', () => {
  const barcode = '7891000100104';
  createProduct({
    name: 'Produto A',
    barcode,
    price_cents: 100,
    confirm_similar_name: true,
  });

  assert.throws(
    () =>
      createProduct({
        name: 'Produto B',
        barcode,
        price_cents: 200,
        confirm_similar_name: true,
      }),
    (err) => err && err.code === 'DUPLICATE_BARCODE'
  );
});
