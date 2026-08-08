#!/usr/bin/env node
/**
 * Revisão Etapa 2 — operações reais na API + SQLite de desenvolvimento.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const BASE = process.env.PDV_API_URL || 'http://localhost:3001';
const DB_PATH =
  process.env.PDV_DB_PATH ||
  resolve(dirname(fileURLToPath(import.meta.url)), '../server/data/onca-pdv.db');

const results = [];
function record(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}. ${title}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  console.log(`API: ${BASE}`);
  console.log(`DB:  ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  // Ensure open cash
  let open = (await api('GET', '/api/cash/sessions/current')).json;
  if (!open) {
    const opened = await api('POST', '/api/cash/sessions/open', {
      operator_name: 'Revisor E2',
      opening_amount_cents: 10000,
    });
    record('cash-open', 'Abrir caixa para revisão', opened.status === 201, opened.json?.id);
    open = opened.json;
  } else {
    record('cash-open', 'Caixa já aberto', true, `id=${open.id}`);
  }

  const sku = `RV-${Date.now()}`;
  const prod = await api('POST', '/api/products', {
    name: 'Produto Review E2',
    sku,
    barcode: `${Date.now()}`.slice(0, 13),
    price_cents: 1000,
    cost_cents: 400,
    stock_qty: 20,
    min_stock_qty: 5,
  });
  record(1, 'Cadastro produto', prod.status === 201, prod.json?.id);

  const edit = await api('PUT', `/api/products/${prod.json.id}`, {
    name: 'Produto Review E2 Editado',
    price_cents: 1200,
  });
  record(2, 'Edição produto', edit.status === 200 && edit.json.price_cents === 1200);

  const dup = await api('POST', '/api/products', {
    name: 'Dup',
    barcode: prod.json.barcode,
    price_cents: 100,
  });
  record(3, 'Barcode duplicado bloqueado', dup.status === 409);

  const entry = await api('POST', '/api/stock/movements', {
    product_id: prod.json.id,
    movement_type: 'entry',
    quantity: 5,
    reason: 'Review entrada',
  });
  record(4, 'Entrada estoque', entry.status === 201 && entry.json.stock_after === 25);

  const exit = await api('POST', '/api/stock/movements', {
    product_id: prod.json.id,
    movement_type: 'exit',
    quantity: 3,
    reason: 'Review saída',
  });
  record(5, 'Saída estoque', exit.status === 201 && exit.json.stock_after === 22);

  const adj = await api('POST', '/api/stock/movements', {
    product_id: prod.json.id,
    movement_type: 'adjust_out',
    quantity: 2,
    reason: 'Review ajuste',
  });
  record(6, 'Ajuste estoque', adj.status === 201 && adj.json.stock_after === 20);

  await api('PUT', `/api/products/${prod.json.id}`, { min_stock_qty: 50 });
  const alerts = await api('GET', '/api/stock?alerts=1');
  record(7, 'Estoque baixo', alerts.json.some((r) => r.id === prod.json.id));

  const cust = await api('POST', '/api/customers', {
    name: 'Cliente Review',
    document: '52998224725',
    phone: '11988887777',
  });
  record(15, 'Cadastro cliente', cust.status === 201, cust.json?.id);

  const stockBefore = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(prod.json.id).stock_qty;
  const saleWith = await api('POST', '/api/sales', {
    client_request_id: `e2-with-${Date.now()}`,
    customer_id: cust.json.id,
    payment_method: 'pix',
    items: [{ product_id: prod.json.id, quantity: 2 }],
  });
  record(16, 'Venda com cliente', saleWith.status === 201 && saleWith.json.customer_id === cust.json.id);
  record(9, 'Venda vinculada ao caixa', !!saleWith.json.cash_session_id);

  const saleWithout = await api('POST', '/api/sales', {
    client_request_id: `e2-without-${Date.now()}`,
    payment_method: 'dinheiro',
    items: [{ product_id: prod.json.id, quantity: 1 }],
  });
  record(17, 'Venda sem cliente', saleWithout.status === 201 && saleWithout.json.customer_id == null);

  const stockMid = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(prod.json.id).stock_qty;
  record('2b', 'Estoque baixado nas vendas', stockMid === stockBefore - 3, `${stockBefore}->${stockMid}`);

  const cancel = await api('POST', `/api/sales/${saleWith.json.id}/cancel`, {
    reason: 'Teste cancelamento review',
    user_name: 'Revisor',
  });
  const stockAfterCancel = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(prod.json.id).stock_qty;
  record(13, 'Cancelamento pós-venda', cancel.status === 200 && cancel.json.status === 'cancelled');
  record(14, 'Estorno estoque', stockAfterCancel === stockMid + 2, `${stockMid}->${stockAfterCancel}`);
  record(
    'cancel-kept',
    'Venda cancelada permanece no banco',
    db.prepare('SELECT status FROM sales WHERE id=?').get(saleWith.json.id).status === 'cancelled'
  );

  const sangria = await api('POST', '/api/cash/movements', {
    movement_type: 'sangria',
    amount_cents: 300,
    reason: 'Review sangria',
  });
  record(11, 'Sangria', sangria.status === 201);

  const suprimento = await api('POST', '/api/cash/movements', {
    movement_type: 'suprimento',
    amount_cents: 200,
    reason: 'Review suprimento',
  });
  record(12, 'Suprimento', suprimento.status === 201);

  // Close and reopen for close test on a fresh session would disrupt - instead conference current
  const conf = await api('GET', `/api/cash/sessions/${open.id}`);
  record('10a', 'Conferência de caixa', conf.status === 200 && conf.json.expected_amount_cents != null);

  const orphans = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sale_items si LEFT JOIN sales s ON s.id=si.sale_id WHERE s.id IS NULL`
    )
    .get().c;
  const neg = db
    .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock=0`)
    .get().c;
  record(19, 'Integridade SQLite', orphans === 0 && neg === 0, `orphans=${orphans} neg=${neg}`);

  // Etapa1 regression smoke
  const health = await api('GET', '/api/health');
  record(20, 'Regressão health', health.status === 200 && health.json.status === 'ok');

  db.close();
  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(` - ${f.id}. ${f.title}: ${f.detail}`);
    process.exit(1);
  }
  console.log('REVISÃO ETAPA 2: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
