#!/usr/bin/env node
/**
 * E2E Etapa 3 com timeout global — API real + checagem da UI (HTTP).
 * Impede espera infinita: aborta o processo se ultrapassar E2E_TIMEOUT_MS.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const API = process.env.PDV_API_URL || 'http://localhost:3001';
const WEB = process.env.PDV_WEB_URL || 'http://localhost:5173';
const DB_PATH =
  process.env.PDV_DB_PATH ||
  resolve(dirname(fileURLToPath(import.meta.url)), '../server/data/onca-pdv.db');
// Timeout máximo padrão: 5 minutos (pedido operacional). Sem espera infinita.
const TIMEOUT_MS = Math.min(Number(process.env.E2E_TIMEOUT_MS || 300_000), 300_000);
const REQ_MS = Number(process.env.E2E_REQ_TIMEOUT_MS || 10_000);

const results = [];
let finished = false;

function record(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}. ${title}${detail ? ` — ${detail}` : ''}`);
}

function failHard(message) {
  console.error(`E2E ABORT: ${message}`);
  process.exit(1);
}

const watchdog = setTimeout(() => {
  if (!finished) failHard(`timeout global ${TIMEOUT_MS}ms excedido — teste interrompido`);
}, TIMEOUT_MS);
watchdog.unref?.();

async function req(method, url, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

async function api(method, path, body) {
  return req(method, `${API}${path}`, body);
}

async function main() {
  console.log(`E2E Etapa 3 | API=${API} WEB=${WEB}`);
  console.log(`Timeout global: ${TIMEOUT_MS}ms | por request: ${REQ_MS}ms`);

  const health = await api('GET', '/api/health');
  record('health', 'API health', health.status === 200 && health.json?.status === 'ok');

  const webHome = await req('GET', WEB);
  record('web', 'UI responde', webHome.status === 200 && webHome.text.includes('ONÇA'));

  let open = (await api('GET', '/api/cash/sessions/current')).json;
  if (!open) {
    const opened = await api('POST', '/api/cash/sessions/open', {
      operator_name: 'E2E Timeout Guard',
      opening_amount_cents: 1000,
    });
    record('cash', 'Abrir caixa', opened.status === 201);
    open = opened.json;
  } else {
    record('cash', 'Caixa aberto', true, `id=${open.id}`);
  }

  const stamp = Date.now();
  const supplier = await api('POST', '/api/suppliers', {
    name: `E2E Timed Fornecedor ${stamp}`,
    city: 'São Paulo',
    state: 'SP',
  });
  record(1, 'Fornecedor via API', supplier.status === 201, supplier.json?.id);

  const product = await api('POST', '/api/products', {
    name: `E2E Timed Prod ${stamp}`,
    sku: `E2ET-${stamp}`,
    barcode: `${stamp}`.slice(0, 13),
    price_cents: 1500,
    cost_cents: 700,
    stock_qty: 8,
  });
  record('prod', 'Produto auxiliar', product.status === 201);

  const purchase = await api('POST', '/api/purchases', {
    supplier_id: supplier.json.id,
    items: [{ product_id: product.json.id, quantity: 5, unit_cost_cents: 750 }],
  });
  record(2, 'Compra concluída', purchase.status === 201 && purchase.json.status === 'completed');

  const customer = await api('POST', '/api/customers', {
    name: `E2E Timed Cliente ${stamp}`,
    phone: '11977776666',
  });
  record('cust', 'Cliente auxiliar', customer.status === 201);

  const creditSale = await api('POST', '/api/sales', {
    client_request_id: `e2e-timed-${stamp}`,
    customer_id: customer.json.id,
    payment_method: 'crediario',
    credit: { entry_cents: 0, installment_count: 2, first_due_date: '2020-01-01' },
    items: [{ product_id: product.json.id, quantity: 1 }],
  });
  record(3, 'Venda crediário', creditSale.status === 201);

  const accounts = await api('GET', `/api/credit/accounts?customer_id=${customer.json.id}`);
  const accountId = accounts.json?.find((a) => a.sale_id === creditSale.json.id)?.id;
  const detail = await api('GET', `/api/credit/accounts/${accountId}`);
  record(4, 'Parcelas crediário', detail.status === 200 && detail.json.installments?.length === 2);

  const saleFull = await api('GET', `/api/sales/${creditSale.json.id}`);
  const itemId = saleFull.json.items?.[0]?.id;
  const ret = await api('POST', '/api/returns', {
    sale_id: creditSale.json.id,
    reason: 'E2E timed return',
    items: [{ sale_item_id: itemId, quantity: 1 }],
  });
  record(5, 'Devolução', ret.status === 201);

  const delivery = await api('POST', '/api/deliveries', {
    sale_id: creditSale.json.id,
    scheduled_date: new Date().toISOString().slice(0, 10),
    period: 'tarde',
    courier_name: 'E2E Courier',
  });
  record(6, 'Entrega', delivery.status === 201);

  const status = await api('POST', `/api/deliveries/${delivery.json.id}/status`, {
    status: 'entregue',
    note: 'E2E ok',
  });
  record(7, 'Status entrega', status.status === 200 && status.json.status === 'entregue');

  // Rotas UI (SPA) — Vite deve servir index
  for (const path of ['/fornecedores', '/compras', '/crediario', '/devolucoes', '/entregas', '/vendas']) {
    const page = await req('GET', `${WEB}${path}`);
    record(`ui-${path}`, `UI ${path}`, page.status === 200);
  }

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  const neg = db
    .prepare(
      `SELECT COUNT(*) AS c FROM products
       WHERE stock_qty < 0 AND allow_negative_stock = 0
         AND COALESCE(legacy_source, '') != 'oncas_pdv_v2'`
    )
    .get().c;
  const orphanPurchases = db
    .prepare(
      `SELECT COUNT(*) AS c FROM purchase_items pi LEFT JOIN purchases p ON p.id = pi.purchase_id WHERE p.id IS NULL`
    )
    .get().c;
  record('sqlite', 'Integridade SQLite', neg === 0 && orphanPurchases === 0 && db.pragma('foreign_keys', { simple: true }) === 1, `neg=${neg} orphans=${orphanPurchases}`);
  db.close();

  finished = true;
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(` - ${f.id}. ${f.title}: ${f.detail}`);
    process.exit(1);
  }
  console.log('E2E ETAPA 3: OK (finalizado dentro do timeout)');
}

main().catch((err) => {
  finished = true;
  clearTimeout(watchdog);
  console.error(err);
  process.exit(1);
});
