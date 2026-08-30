import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ALTERAÇÃO 1 — Troco automático.
 * Confirma o contrato usado pela tela de vendas: total, valor recebido e troco,
 * bloqueio de dinheiro insuficiente, ausência de troco em pix/cartão e troco
 * calculado somente sobre a parte em dinheiro no pagamento misto.
 */
const tmp = mkdtempSync(join(tmpdir(), 'onca-troco-auto-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
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

async function product(name, price) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `955${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `TR-${seq}-${Date.now()}`,
    price_cents: price,
    stock_qty: 100,
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
  token = (await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null)).json
    .token;
  await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Troco',
    opening_amount_cents: 30000,
  });
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('dinheiro: total 75,00 recebido 100,00 = troco 25,00', async () => {
  const p = await product('Troco 7500', 7500);
  const sale = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 10000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(sale.json.total_cents, 7500);
  assert.equal(sale.json.amount_received_cents, 10000);
  assert.equal(sale.json.change_cents, 2500);

  // o troco persiste no detalhe (histórico/comprovante)
  const detail = await api('GET', `/api/sales/${sale.json.id}`);
  assert.equal(detail.json.change_cents, 2500);
  assert.equal(detail.json.amount_received_cents, 10000);
});

test('dinheiro insuficiente é bloqueado e não mexe em estoque', async () => {
  const p = await product('Troco Bloqueio', 7500);
  const before = (await api('GET', `/api/products/${p.id}`)).json.stock_qty;

  const bad = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.json));
  assert.equal(bad.json.code, 'CASH_RECEIVED_INSUFFICIENT');

  const after = (await api('GET', `/api/products/${p.id}`)).json.stock_qty;
  assert.equal(after, before, 'estoque não pode mudar em venda recusada');
});

test('pix e cartão não geram troco', async () => {
  const p = await product('Troco Pix', 4300);
  const pix = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(pix.status, 201);
  assert.equal(pix.json.change_cents, 0);
  assert.equal(pix.json.amount_received_cents, 0);

  for (const cardType of ['CREDIT', 'DEBIT']) {
    const card = await api('POST', '/api/sales', {
      payment_method: 'cartao',
      card_type: cardType,
      items: [{ product_id: p.id, quantity: 1 }],
    });
    assert.equal(card.status, 201, JSON.stringify(card.json));
    assert.equal(card.json.change_cents, 0, `cartão ${cardType} não deve ter troco`);
  }
});

test('misto: troco só sobre a parte em dinheiro', async () => {
  const p = await product('Troco Misto', 10000);
  // 100,00 = 40,00 dinheiro + 60,00 pix; cliente entrega 50,00 em espécie
  const sale = await api('POST', '/api/sales', {
    payments: [
      { method: 'dinheiro', amount_cents: 4000 },
      { method: 'pix', amount_cents: 6000 },
    ],
    amount_received_cents: 5000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(sale.json.total_cents, 10000);
  assert.equal(sale.json.change_cents, 1000, 'troco = 50,00 - 40,00 e não sobre o total');

  const insuficiente = await api('POST', '/api/sales', {
    payments: [
      { method: 'dinheiro', amount_cents: 4000 },
      { method: 'pix', amount_cents: 6000 },
    ],
    amount_received_cents: 3000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(insuficiente.status, 400);
  assert.equal(insuficiente.json.code, 'CASH_RECEIVED_INSUFFICIENT');
});

test('caixa recebe a parte em dinheiro, não o valor entregue pelo cliente', async () => {
  const before = (await api('GET', '/api/cash/sessions/current')).json;
  const p = await product('Troco Caixa', 2000);
  const sale = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(sale.json.change_cents, 3000);

  const after = (await api('GET', '/api/cash/sessions/current')).json;
  assert.equal(
    Number(after.sales_dinheiro_cents) - Number(before.sales_dinheiro_cents),
    2000,
    'caixa soma o valor da venda, não o valor recebido em mão'
  );
});
