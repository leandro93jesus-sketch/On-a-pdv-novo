import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ALTERAÇÃO 4 — Produtos e Estoque na mesma área.
 * Cobre os três movimentos da tela (entrada, saída e ajuste por contagem) e o
 * registro completo em stock_movements: produto, antes, movimentação, depois,
 * tipo, data/hora, usuário e motivo. Também confere o histórico por produto.
 */
const tmp = mkdtempSync(join(tmpdir(), 'onca-produtos-estoque-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, getDb, closeDb } = await import('./db/index.js');
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

async function product(name, { stock = 10, price = 1000, cost = 400, category = 'Limpeza' } = {}) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `944${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `PE-${seq}-${Date.now()}`,
    price_cents: price,
    cost_cents: cost,
    category,
    stock_qty: stock,
    min_stock_qty: 2,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

function movementsOf(productId) {
  return getDb()
    .prepare(
      `SELECT movement_type, quantity_delta, stock_before, stock_after, reason, user_name, created_at
       FROM stock_movements WHERE product_id = ? ORDER BY id`
    )
    .all(productId);
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
  token = (await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null)).json
    .token;
  await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Estoque',
    opening_amount_cents: 10000,
  });
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('a lista da área traz os dados das colunas da tela', async () => {
  const p = await product('Estoque Colunas', { stock: 7, price: 1990, cost: 890 });
  const list = await api('GET', `/api/products?q=${encodeURIComponent('Estoque Colunas')}`);
  assert.equal(list.status, 200);
  const row = list.json.find((x) => x.id === p.id);
  assert.ok(row);
  // Produto, Código, Estoque, Custo, Preço, Categoria
  assert.equal(row.name, 'Estoque Colunas');
  assert.ok(row.barcode);
  assert.equal(row.stock_qty, 7);
  assert.equal(row.cost_cents, 890);
  assert.equal(row.price_cents, 1990);
  assert.equal(row.category, 'Limpeza');
});

test('+ ESTOQUE: 10 + 20 = 30 com movimentação de entrada', async () => {
  const p = await product('Estoque Entrada', { stock: 10 });
  const res = await api('POST', '/api/stock/movements', {
    product_id: p.id,
    movement_type: 'entry',
    quantity: 20,
    reason: 'Entrada manual',
  });
  assert.ok(res.status < 300, JSON.stringify(res.json));
  assert.equal(res.json.stock_before, 10);
  assert.equal(res.json.stock_after, 30);

  const atual = (await api('GET', `/api/products/${p.id}`)).json.stock_qty;
  assert.equal(atual, 30);

  const movs = movementsOf(p.id);
  const entrada = movs.at(-1);
  assert.equal(entrada.movement_type, 'entry');
  assert.equal(entrada.quantity_delta, 20);
  assert.equal(entrada.stock_before, 10);
  assert.equal(entrada.stock_after, 30);
  assert.equal(entrada.reason, 'Entrada manual');
  assert.ok(entrada.created_at, 'data/hora obrigatória');
  assert.ok(entrada.user_name, 'usuário obrigatório');
});

test('− ESTOQUE: 30 − 5 = 25 com movimentação de saída', async () => {
  const p = await product('Estoque Saida', { stock: 30 });
  const res = await api('POST', '/api/stock/movements', {
    product_id: p.id,
    movement_type: 'exit',
    quantity: 5,
    reason: 'Perda / avaria',
  });
  assert.ok(res.status < 300, JSON.stringify(res.json));
  assert.equal(res.json.stock_before, 30);
  assert.equal(res.json.stock_after, 25);

  const movs = movementsOf(p.id);
  const saida = movs.at(-1);
  assert.equal(saida.movement_type, 'exit');
  assert.equal(saida.quantity_delta, -5);
  assert.equal(saida.stock_before, 30);
  assert.equal(saida.stock_after, 25);
  assert.equal(saida.reason, 'Perda / avaria');
});

test('AJUSTE por contagem: sistema 32, contagem 29, diferença -3', async () => {
  const p = await product('Estoque Ajuste', { stock: 32 });
  const res = await api('POST', '/api/stock/set-balance', {
    product_id: p.id,
    new_qty: 29,
    reason: 'Contagem física',
    note: 'conferencia de prateleira',
  });
  assert.ok(res.status < 300, JSON.stringify(res.json));
  assert.equal(res.json.stock_before, 32);
  assert.equal(res.json.stock_after, 29);

  const movs = movementsOf(p.id);
  const ajuste = movs.at(-1);
  assert.equal(ajuste.movement_type, 'adjust_out');
  assert.equal(ajuste.quantity_delta, -3, 'diferença registrada');
  assert.equal(ajuste.stock_before, 32);
  assert.equal(ajuste.stock_after, 29);
  assert.equal(ajuste.reason, 'Contagem física');
});

test('saída não pode deixar o estoque negativo', async () => {
  const p = await product('Estoque Negativo', { stock: 3 });
  const res = await api('POST', '/api/stock/movements', {
    product_id: p.id,
    movement_type: 'exit',
    quantity: 10,
    reason: 'Perda / avaria',
  });
  assert.ok(res.status >= 400, JSON.stringify(res.json));
  const atual = (await api('GET', `/api/products/${p.id}`)).json.stock_qty;
  assert.equal(atual, 3, 'estoque não pode mudar em movimento recusado');
});

test('HISTÓRICO por produto lista as movimentações na ordem, incluindo venda', async () => {
  const p = await product('Estoque Historico', { stock: 10 });
  await api('POST', '/api/stock/movements', {
    product_id: p.id,
    movement_type: 'entry',
    quantity: 5,
    reason: 'Entrada manual',
  });
  await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: p.id, quantity: 2 }],
  });
  await api('POST', '/api/stock/set-balance', {
    product_id: p.id,
    new_qty: 12,
    reason: 'Contagem física',
  });

  const hist = await api('GET', `/api/stock/movements?product_id=${p.id}&limit=100`);
  assert.equal(hist.status, 200);
  const tipos = hist.json.map((m) => m.movement_type);
  assert.ok(tipos.includes('entry'));
  assert.ok(tipos.includes('sale'), 'venda também aparece no histórico do produto');
  assert.ok(tipos.includes('adjust_out') || tipos.includes('adjust_in'));

  for (const m of hist.json) {
    assert.equal(typeof m.stock_after, 'number');
    assert.ok(m.created_at, 'toda movimentação tem data/hora');
  }

  // encadeamento: o depois de uma movimentação é o antes da seguinte
  const ordenadas = movementsOf(p.id);
  for (let i = 1; i < ordenadas.length; i += 1) {
    assert.equal(
      ordenadas[i].stock_before,
      ordenadas[i - 1].stock_after,
      'saldo precisa ser contínuo entre movimentações'
    );
  }
  const final = (await api('GET', `/api/products/${p.id}`)).json.stock_qty;
  assert.equal(final, ordenadas.at(-1).stock_after);
  assert.equal(final, 12);
});

test('histórico de um produto não mistura movimentações de outro', async () => {
  const a = await product('Estoque Isolado A', { stock: 10 });
  const b = await product('Estoque Isolado B', { stock: 10 });
  await api('POST', '/api/stock/movements', {
    product_id: a.id,
    movement_type: 'entry',
    quantity: 4,
    reason: 'Entrada manual',
  });

  const histA = await api('GET', `/api/stock/movements?product_id=${a.id}&limit=100`);
  const histB = await api('GET', `/api/stock/movements?product_id=${b.id}&limit=100`);
  assert.ok(histA.json.every((m) => m.product_id === a.id));
  assert.ok(histB.json.every((m) => m.product_id === b.id));
  assert.ok(histA.json.length > histB.json.length);
});
