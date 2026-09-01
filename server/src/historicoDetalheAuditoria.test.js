import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ALTERAÇÕES 5, 6 e 7 — histórico detalhado, alteração de venda concluída e
 * cancelamento/exclusão com autorização administrativa.
 */
const tmp = mkdtempSync(join(tmpdir(), 'onca-historico-detalhe-'));
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

async function product(name, { stock = 50, price = 1000, cost = 300 } = {}) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `922${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `HD-${seq}-${Date.now()}`,
    price_cents: price,
    cost_cents: cost,
    stock_qty: stock,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

function auditFor(saleId, action) {
  const row = getDb()
    .prepare(
      `SELECT action, details, user_name, created_at FROM audit_logs
       WHERE entity_type = 'sale' AND entity_id = ? AND action = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(saleId, action);
  return row ? { ...row, details: JSON.parse(row.details) } : null;
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
    operator_name: 'Joana Caixa',
    opening_amount_cents: 50000,
  });
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('ALT5 lista do histórico traz número, data/hora, cliente, operador, itens, pagamento, total e status', async () => {
  const p = await product('Hist Lista', { price: 2500 });
  const cliente = await api('POST', '/api/customers', { name: 'Cliente Histórico', phone: '11933332222' });
  const venda = await api('POST', '/api/sales', {
    customer_id: cliente.json.id,
    payment_method: 'dinheiro',
    amount_received_cents: 10000,
    items: [{ product_id: p.id, quantity: 3 }],
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));

  const lista = await api('GET', '/api/sales?paged=1&limit=10');
  assert.equal(lista.status, 200);
  const row = lista.json.items.find((s) => s.id === venda.json.id);
  assert.ok(row, 'venda deve aparecer na lista');
  assert.ok(row.sale_number);
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/, 'data e hora disponíveis');
  assert.equal(row.customer_name, 'Cliente Histórico');
  assert.equal(row.operator_name, 'Joana Caixa');
  assert.equal(row.items_count, 3);
  assert.equal(row.payment_method, 'dinheiro');
  assert.equal(row.total_cents, 7500);
  assert.ok(row.situation_label || row.status);
});

test('ALT5 detalhe completo: itens com desconto, resumo, recebido e troco', async () => {
  const p1 = await product('Hist Item 1', { price: 1000 });
  const p2 = await product('Hist Item 2', { price: 2000 });
  const venda = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    discount_cents: 300,
    notes: 'entregar na portaria',
    items: [
      { product_id: p1.id, quantity: 2, unit_price_cents: 1000, discount_cents: 100 },
      { product_id: p2.id, quantity: 1, unit_price_cents: 2000 },
    ],
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));

  const d = (await api('GET', `/api/sales/${venda.json.id}`)).json;
  assert.equal(d.items.length, 2);
  for (const item of d.items) {
    assert.ok(item.name);
    assert.ok('barcode' in item);
    assert.equal(typeof item.quantity, 'number');
    assert.equal(typeof item.unit_price_cents, 'number');
    assert.equal(typeof item.discount_cents, 'number');
    assert.equal(typeof item.line_total_cents, 'number');
  }
  const itemComDesconto = d.items.find((i) => i.discount_cents === 100);
  assert.ok(itemComDesconto);
  assert.equal(itemComDesconto.line_total_cents, 1900);

  assert.equal(d.subtotal_cents, 3900);
  assert.equal(d.discount_cents, 300);
  assert.equal(d.total_cents, 3600);
  assert.equal(d.amount_received_cents, 5000);
  assert.equal(d.change_cents, 1400);
  assert.equal(d.notes, 'entregar na portaria');
  assert.equal(d.payments.length, 1);
});

test('ALT5 pagamento misto aparece separado por forma', async () => {
  const p = await product('Hist Misto', { price: 10000 });
  const venda = await api('POST', '/api/sales', {
    payments: [
      { method: 'dinheiro', amount_cents: 3000 },
      { method: 'pix', amount_cents: 2000 },
      { method: 'cartao', amount_cents: 5000, card_type: 'CREDIT' },
    ],
    amount_received_cents: 3000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));
  const d = (await api('GET', `/api/sales/${venda.json.id}`)).json;
  assert.equal(d.payments.length, 3);
  const porForma = Object.fromEntries(d.payments.map((p2) => [p2.method, p2.amount_cents]));
  assert.equal(porForma.dinheiro, 3000);
  assert.equal(porForma.pix, 2000);
  assert.equal(porForma.cartao, 5000);
  assert.equal(d.payments.find((p2) => p2.method === 'cartao').card_type, 'CREDIT');
});

test('ALT5 detalhe mostra crediário e devolução quando existem', async () => {
  const p = await product('Hist Crediario', { price: 20000, stock: 10 });
  const cliente = await api('POST', '/api/customers', { name: 'Cliente Crediário', phone: '11922221111' });
  const venda = await api('POST', '/api/sales', {
    customer_id: cliente.json.id,
    payment_method: 'crediario',
    items: [{ product_id: p.id, quantity: 1 }],
    credit: { entry_cents: 5000, installment_count: 3, first_due_date: '2026-10-10' },
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));

  const rel = await api('GET', `/api/sales/${venda.json.id}/related`);
  assert.equal(rel.status, 200);
  assert.ok(rel.json.credit, 'crediário deve vir no detalhe');
  assert.equal(rel.json.credit.total_cents, 20000);
  assert.equal(rel.json.credit.entry_cents, 5000);
  assert.equal(rel.json.credit.installment_count, 3);
  assert.equal(rel.json.credit.installments.length, 3);
  assert.equal(rel.json.delivery_order, null);
  assert.deepEqual(rel.json.returns, []);

  // venda sem crediário devolve tudo vazio
  const simples = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  const relSimples = await api('GET', `/api/sales/${simples.json.id}/related`);
  assert.equal(relSimples.json.credit, null);

  const inexistente = await api('GET', '/api/sales/999999/related');
  assert.equal(inexistente.status, 404);
});

test('ALT6 alterar venda exige PIN e registra auditoria completa', async () => {
  const a = await product('Alt A', { price: 1000 });
  const b = await product('Alt B', { price: 2500 });
  const venda = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    items: [{ product_id: a.id, quantity: 2 }],
  });
  assert.equal(venda.json.total_cents, 2000);

  const semPin = await api('PUT', `/api/sales/${venda.json.id}`, {
    reason: 'sem pin',
    items: [{ product_id: a.id, quantity: 1, unit_price_cents: 1000 }],
  });
  assert.ok(semPin.status >= 400, 'sem PIN precisa falhar');

  const pinErrado = await api('PUT', `/api/sales/${venda.json.id}`, {
    admin_password: '000000',
    reason: 'pin errado',
    items: [{ product_id: a.id, quantity: 1, unit_price_cents: 1000 }],
  });
  assert.equal(pinErrado.status, 401);

  const alterada = await api('PUT', `/api/sales/${venda.json.id}`, {
    admin_password: '230808',
    authorized_by: 'Leandro Admin',
    user_name: 'Joana Caixa',
    reason: 'Cliente trocou o produto',
    items: [{ product_id: b.id, quantity: 1, unit_price_cents: 2500 }],
  });
  assert.equal(alterada.status, 200, JSON.stringify(alterada.json));
  assert.equal(alterada.json.total_cents, 2500);
  assert.ok(alterada.json.amended_at);
  assert.equal(alterada.json.amend_reason, 'Cliente trocou o produto');
  assert.equal(alterada.json.amend_authorized_by, 'Leandro Admin');
  assert.equal(alterada.json.situation_label, 'Alterada');

  const audit = auditFor(venda.json.id, 'sale.amend');
  assert.ok(audit, 'auditoria de alteração deve existir');
  assert.equal(audit.details.reason, 'Cliente trocou o produto');
  assert.equal(audit.details.total_before_cents, 2000);
  assert.equal(audit.details.total_after_cents, 2500);
  assert.equal(audit.details.delta_cents, 500);
  assert.equal(audit.details.operator, 'Joana Caixa');
  assert.equal(audit.details.authorized_by, 'Leandro Admin');
  assert.equal(audit.details.items_before.length, 1);
  assert.equal(audit.details.items_after.length, 1);
  assert.ok(audit.created_at, 'auditoria tem data e hora');

  // estoque: A devolvido (2), B baixado (1)
  const estoqueA = (await api('GET', `/api/products/${a.id}`)).json.stock_qty;
  const estoqueB = (await api('GET', `/api/products/${b.id}`)).json.stock_qty;
  assert.equal(estoqueA, 50);
  assert.equal(estoqueB, 49);

  // o PIN nunca volta em resposta nem em auditoria
  const serializado = JSON.stringify({ sale: alterada.json, audit });
  assert.ok(!serializado.includes('230808'), 'PIN não pode aparecer em resposta/auditoria');
});

test('ALT7 cancelar exige motivo e PIN, estorna estoque, caixa e crediário', async () => {
  const p = await product('Cancel Estoque', { price: 1500, stock: 20 });
  const cliente = await api('POST', '/api/customers', { name: 'Cliente Cancel', phone: '11911110000' });
  const caixaAntes = (await api('GET', '/api/cash/sessions/current')).json;

  const venda = await api('POST', '/api/sales', {
    customer_id: cliente.json.id,
    payment_method: 'crediario',
    items: [{ product_id: p.id, quantity: 4 }],
    credit: { entry_cents: 0, installment_count: 2, first_due_date: '2026-10-05' },
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));
  const estoqueDepoisVenda = (await api('GET', `/api/products/${p.id}`)).json.stock_qty;
  assert.equal(estoqueDepoisVenda, 16);

  const semMotivo = await api('POST', `/api/sales/${venda.json.id}/cancel`, {
    admin_password: '230808',
  });
  assert.equal(semMotivo.status, 400);
  assert.equal(semMotivo.json.code, 'CANCEL_REASON_REQUIRED');

  const pinErrado = await api('POST', `/api/sales/${venda.json.id}/cancel`, {
    reason: 'Duplicidade',
    admin_password: '999999',
  });
  assert.equal(pinErrado.status, 401);
  assert.equal(
    (await api('GET', `/api/products/${p.id}`)).json.stock_qty,
    16,
    'tentativa recusada não pode estornar'
  );

  const cancelada = await api('POST', `/api/sales/${venda.json.id}/cancel`, {
    reason: 'Duplicidade',
    admin_password: '230808',
    authorized_by: 'Leandro Admin',
    user_name: 'Joana Caixa',
  });
  assert.equal(cancelada.status, 200, JSON.stringify(cancelada.json));
  assert.equal(cancelada.json.status, 'cancelled');
  assert.equal(cancelada.json.cancel_reason, 'Duplicidade');
  assert.ok(cancelada.json.cancelled_at);

  // venda preservada no histórico (não apagada)
  const aindaExiste = getDb()
    .prepare('SELECT status FROM sales WHERE id = ?')
    .get(venda.json.id);
  assert.equal(aindaExiste.status, 'cancelled');

  // estoque devolvido com movimentação própria
  assert.equal((await api('GET', `/api/products/${p.id}`)).json.stock_qty, 20);
  const mov = getDb()
    .prepare(
      `SELECT movement_type, quantity_delta, stock_before, stock_after FROM stock_movements
       WHERE reference_type='sale' AND reference_id=? ORDER BY id DESC LIMIT 1`
    )
    .get(venda.json.id);
  assert.equal(mov.movement_type, 'sale_cancel');
  assert.equal(mov.quantity_delta, 4);
  assert.equal(mov.stock_after, 20);

  // crediário cancelado e sem saldo
  const rel = await api('GET', `/api/sales/${venda.json.id}/related`);
  assert.equal(rel.json.credit.status, 'cancelado');
  assert.equal(rel.json.credit.balance_cents, 0);

  // caixa volta ao valor anterior à venda
  const caixaDepois = (await api('GET', '/api/cash/sessions/current')).json;
  assert.equal(
    Number(caixaDepois.sales_crediario_cents || 0),
    Number(caixaAntes.sales_crediario_cents || 0),
    'crediário do caixa precisa voltar ao valor anterior'
  );

  // auditoria do cancelamento
  const audit = auditFor(venda.json.id, 'sale.cancel');
  assert.ok(audit);
  assert.equal(audit.details.reason, 'Duplicidade');
  assert.equal(audit.details.operator, 'Joana Caixa');
  assert.equal(audit.details.authorized_by, 'Leandro Admin');
  assert.equal(audit.details.total_before_cents, 6000);
  assert.ok(audit.created_at);
});

test('ALT7 cancelamento é idempotente e não duplica estorno', async () => {
  const p = await product('Cancel Idem', { price: 1000, stock: 10 });
  const venda = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: p.id, quantity: 2 }],
  });
  await api('POST', `/api/sales/${venda.json.id}/cancel`, {
    reason: 'Teste',
    admin_password: '230808',
  });
  const estoque1 = (await api('GET', `/api/products/${p.id}`)).json.stock_qty;
  assert.equal(estoque1, 10);

  const denovo = await api('POST', `/api/sales/${venda.json.id}/cancel`, {
    reason: 'Teste',
    admin_password: '230808',
  });
  assert.equal(denovo.status, 200);
  const estoque2 = (await api('GET', `/api/products/${p.id}`)).json.stock_qty;
  assert.equal(estoque2, 10, 'segundo cancelamento não pode estornar de novo');

  const movs = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM stock_movements
       WHERE reference_type='sale' AND reference_id=? AND movement_type='sale_cancel'`
    )
    .get(venda.json.id).c;
  assert.equal(movs, 1, 'só uma movimentação de cancelamento');
});

test('ALT6/7 venda cancelada não pode ser alterada e integridade se mantém', async () => {
  const p = await product('Cancel Bloqueio', { price: 1000 });
  const venda = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  await api('POST', `/api/sales/${venda.json.id}/cancel`, {
    reason: 'Erro operacional',
    admin_password: '230808',
  });
  const tentativa = await api('PUT', `/api/sales/${venda.json.id}`, {
    admin_password: '230808',
    reason: 'tentando alterar cancelada',
    items: [{ product_id: p.id, quantity: 5, unit_price_cents: 1000 }],
  });
  assert.ok(tentativa.status >= 400, 'venda cancelada não pode ser alterada');

  const db = getDb();
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
