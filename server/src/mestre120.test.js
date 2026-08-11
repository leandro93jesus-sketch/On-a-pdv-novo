import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-m120-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'mestre120.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');

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
  return { status: res.status, json };
}

before(async () => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  ensureBootstrapAdmin();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
  await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Admin M120',
    opening_amount_cents: 50000,
  });
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

let seq = 0;
async function product(name, stock = 20, price = 1000) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `812${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `M120-${seq}-${Date.now()}`,
    price_cents: price,
    stock_qty: stock,
    confirm_similar_name: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

test('pedido entrega: reserva estoque e não entra no caixa enquanto não pago', async () => {
  const p = await product('M120 Pedido Reserva', 20, 1500);
  const beforeCash = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(beforeCash.json?.sales_total_cents || 0);

  const order = await api('POST', '/api/delivery-orders', {
    client_request_id: `m120-ord-${Date.now()}`,
    customer_name: 'Cliente Pedido',
        address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [{ product_id: p.id, quantity: 5 }],
  });
  assert.equal(order.status, 201, JSON.stringify(order.json));
  assert.equal(order.json.status, 'aguardando_pagamento');
  assert.equal(order.json.payment_status, 'nao_pago');
  assert.equal(order.json.amount_paid_cents, 0);
  assert.equal(order.json.total_cents, 7500);

  const avail = await api('GET', `/api/delivery-orders/availability/${p.id}`);
  assert.equal(avail.status, 200);
  assert.equal(avail.json.stock_qty, 20);
  assert.equal(avail.json.reserved_qty, 5);
  assert.equal(avail.json.available_qty, 15);

  const afterCash = await api('GET', '/api/cash/sessions/current');
  const salesAfter = Number(afterCash.json?.sales_total_cents || 0);
  assert.equal(salesAfter, salesBefore, 'pedido não pago não deve alterar caixa');
});

test('pedido: pagamento parcial lança só o valor pago; quitação converte reserva', async () => {
  const p = await product('M120 Parcial', 10, 2000);
  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `m120-par-${Date.now()}`,
        address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [{ product_id: p.id, quantity: 3 }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const orderId = created.json.id;
  assert.equal(created.json.total_cents, 6000);

  const reqId = `m120-pay-partial-${Date.now()}`;
  const partial = await api('POST', `/api/delivery-orders/${orderId}/payments`, {
    client_request_id: reqId,
    payments: [{ method: 'pix', amount_cents: 2000 }],
  });
  assert.equal(partial.status, 200, JSON.stringify(partial.json));
  assert.equal(partial.json.payment_status, 'parcial');
  assert.equal(partial.json.amount_paid_cents, 2000);
  assert.equal(partial.json.sale_id != null, true);

  // estoque físico ainda 10; reserva ainda ativa
  const mid = await api('GET', `/api/delivery-orders/availability/${p.id}`);
  assert.equal(mid.json.stock_qty, 10);
  assert.equal(mid.json.reserved_qty, 3);

  // idempotência
  const again = await api('POST', `/api/delivery-orders/${orderId}/payments`, {
    client_request_id: reqId,
    payments: [{ method: 'pix', amount_cents: 2000 }],
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.amount_paid_cents, 2000);

  const full = await api('POST', `/api/delivery-orders/${orderId}/payments`, {
    client_request_id: `m120-pay-full-${Date.now()}`,
    payments: [
      { method: 'dinheiro', amount_cents: 2000, amount_received_cents: 2000 },
      { method: 'cartao', amount_cents: 2000, card_type: 'CREDIT' },
    ],
  });
  assert.equal(full.status, 200, JSON.stringify(full.json));
  assert.equal(full.json.payment_status, 'pago');
  assert.equal(full.json.amount_paid_cents, 6000);
  assert.equal(full.json.status, 'aguardando_separacao');

  const done = await api('GET', `/api/delivery-orders/availability/${p.id}`);
  assert.equal(done.json.stock_qty, 7);
  assert.equal(done.json.reserved_qty, 0);
  assert.equal(done.json.available_qty, 7);

  // dupla quitação bloqueada
  const dup = await api('POST', `/api/delivery-orders/${orderId}/payments`, {
    client_request_id: `m120-dup-${Date.now()}`,
    payments: [{ method: 'pix', amount_cents: 100 }],
  });
  assert.equal(dup.status, 409);
});

test('pedido: cancelamento libera reserva sem apagar histórico', async () => {
  const p = await product('M120 Cancel', 8, 1000);
  const created = await api('POST', '/api/delivery-orders', {
    client_request_id: `m120-can-${Date.now()}`,
        address: 'Rua Teste Entrega',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01000-000',
    items: [{ product_id: p.id, quantity: 4 }],
  });
  const orderId = created.json.id;
  const cancel = await api('POST', `/api/delivery-orders/${orderId}/cancel`, {
    reason: 'Cliente desistiu',
  });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  assert.equal(cancel.json.status, 'cancelado');
  assert.ok(cancel.json.cancel_reason);

  const avail = await api('GET', `/api/delivery-orders/availability/${p.id}`);
  assert.equal(avail.json.reserved_qty, 0);
  assert.equal(avail.json.stock_qty, 8);

  const detail = await api('GET', `/api/delivery-orders/${orderId}`);
  assert.ok(detail.json.history?.length >= 1);
});

test('fila de impressão: enqueue, erro, requeue e log', async () => {
  const job = await api('POST', '/api/print/jobs', {
    document_type: 'comprovante',
    document_ref: 'VD-TEST',
    title: 'Teste fila',
    paper_format: '80mm',
  });
  assert.equal(job.status, 201, JSON.stringify(job.json));
  assert.equal(job.json.status, 'pendente');

  const fail = await api('POST', `/api/print/jobs/${job.json.id}/result`, {
    ok: false,
    error: 'Impressora offline',
    printer_name: 'Fake Printer',
  });
  assert.equal(fail.status, 200);
  assert.equal(fail.json.status, 'erro');

  const rq = await api('POST', `/api/print/jobs/${job.json.id}/requeue`, {});
  assert.equal(rq.status, 200);
  assert.equal(rq.json.status, 'pendente');

  const ok = await api('POST', `/api/print/jobs/${job.json.id}/result`, {
    ok: true,
    printer_name: 'Fake Printer',
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'impresso');

  const log = await api('GET', '/api/print/log?limit=20');
  assert.equal(log.status, 200);
  assert.ok(Array.isArray(log.json));
  assert.ok(log.json.some((r) => r.print_job_id === job.json.id));
});

test('config portátil impressoras: export/import/match e arquivo', async () => {
  const put = await api('PUT', '/api/settings/printers', {
    receipt_printer: 'KAPBOM KA-1445',
    reports_printer: 'Microsoft Print to PDF',
    delivery_printer: 'TAICON TA-TP610L',
    profile: { format: '80mm', copies: 1, mode: 'manual', auto_print: false },
    per_printer: {
      'KAPBOM KA-1445': { format: '58mm', copies: 1 },
    },
  });
  assert.equal(put.status, 200, JSON.stringify(put.json));

  const exp = await api('GET', '/api/settings/printers/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.json.schema, 'onca-pdv-impressoras/v1');
  assert.equal(exp.json.printers.receipt_printer, 'KAPBOM KA-1445');
  assert.equal(exp.json.printers.profile.format, '80mm');

  const filePath = join(tmp, 'configuracoes', 'impressoras.json');
  assert.equal(existsSync(filePath), true);
  const disk = JSON.parse(readFileSync(filePath, 'utf8'));
  assert.equal(disk.printers.delivery_printer, 'TAICON TA-TP610L');

  const match = await api('POST', '/api/settings/printers/match', {
    printers: ['Microsoft Print to PDF', 'Outra'],
  });
  assert.equal(match.status, 200);
  assert.equal(match.json.receipt.found, false);
  assert.equal(match.json.reports.found, true);

  const imp = await api('POST', '/api/settings/printers/import', {
    printers: {
      receipt_printer: 'Equiv-58mm',
      reports_printer: 'Microsoft Print to PDF',
      delivery_printer: '',
      profile: { format: '58mm', copies: 2 },
      per_printer: { 'Equiv-58mm': { format: '58mm' } },
    },
  });
  assert.equal(imp.status, 200);
  assert.equal(imp.json.settings.receipt_printer, 'Equiv-58mm');
  assert.equal(imp.json.settings.profile.format, '58mm');
});

test('sqlite integrity após mestre', () => {
  const db = getDb();
  const integrity = db.prepare('PRAGMA integrity_check').get();
  assert.equal(integrity.integrity_check, 'ok');
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  assert.equal(fk.length, 0);
});
