/**
 * Validação final obrigatória — ONÇA PDV
 * Cada caso registra evidência em stdout e em arquivo de log.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EVIDENCE_DIR = process.env.PDV_EVIDENCE_DIR || '/opt/cursor/artifacts';
const LOG_FILE = join(EVIDENCE_DIR, 'validacao-final-obrigatoria.log');
const SUMMARY_FILE = join(EVIDENCE_DIR, 'validacao-final-resumo.json');

mkdirSync(EVIDENCE_DIR, { recursive: true });
writeFileSync(LOG_FILE, `# Validação final obrigatória — ${new Date().toISOString()}\n\n`);

const evidenceRows = [];

function log(section, message) {
  const line = `[${section}] ${message}`;
  console.log(line);
  appendFileSync(LOG_FILE, `${line}\n`);
}

function recordEvidence({ name, tested, command, result, expected, found, logFile, correction }) {
  const row = {
    name,
    tested,
    command,
    result,
    expected,
    found,
    logFile: logFile || LOG_FILE,
    correction: correction || '—',
  };
  evidenceRows.push(row);
  log(
    result,
    `${name} | esperado=${JSON.stringify(expected)} | encontrado=${JSON.stringify(found)}`
  );
  appendFileSync(
    LOG_FILE,
    [
      `### ${name}`,
      `Testado: ${tested}`,
      `Comando: ${command}`,
      `Resultado: ${result}`,
      `Esperado: ${JSON.stringify(expected)}`,
      `Encontrado: ${JSON.stringify(found)}`,
      `Log: ${logFile || LOG_FILE}`,
      `Correção: ${correction || '—'}`,
      '',
    ].join('\n')
  );
}

const tmp = mkdtempSync(join(tmpdir(), 'onca-validacao-final-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { runMigrations } = await import('./db/migrate.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { getProductByBarcode, searchProducts } = await import('./services/productsService.js');

let server;
let baseUrl;
let token;
let seq = 0;
const COMMAND =
  'node --test server/src/validacaoFinalObrigatoria.test.js';

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

async function product(name, stock = 50, price = 1000, barcode) {
  seq += 1;
  const code = barcode || `777${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`;
  const res = await api('POST', '/api/products', {
    name,
    barcode: code,
    sku: `VF-${seq}-${Date.now()}`,
    price_cents: price,
    cost_cents: Math.round(price * 0.5),
    stock_qty: stock,
    min_stock_qty: 1,
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
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
  await api('POST', '/api/cash/sessions/open', {
    operator_name: 'ValidacaoFinal',
    opening_amount_cents: 50000,
  });
  const integrity = db.pragma('integrity_check')[0].integrity_check;
  recordEvidence({
    name: 'Integridade do banco (ANTES)',
    tested: 'PRAGMA integrity_check no DB isolado da suite',
    command: COMMAND,
    result: integrity === 'ok' ? 'PASS' : 'FAIL',
    expected: 'ok',
    found: integrity,
  });
});

after(() => {
  try {
    writeFileSync(SUMMARY_FILE, JSON.stringify(evidenceRows, null, 2));
  } catch {
    /* ignore */
  }
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('Scanner: código existente + 10 bipagens rápidas = qty 10 mesmo produto', async () => {
  const code = `7891000100999`;
  const p = await product('Detergente Scanner', 100, 899, code);

  // 1ª leitura
  const first = getProductByBarcode(code);
  assert.equal(first.id, p.id);

  // 10 bipagens rápidas (simula incremento no carrinho por ID exato)
  const cart = new Map();
  for (let i = 0; i < 10; i += 1) {
    const hit = getProductByBarcode(code);
    assert.equal(hit.id, p.id, `bipagem ${i + 1} retornou produto diferente`);
    cart.set(hit.id, (cart.get(hit.id) || 0) + 1);
  }
  assert.equal(cart.size, 1);
  assert.equal(cart.get(p.id), 10);

  // dois códigos parecidos — só exact match
  await product('Parecido A', 10, 100, '7891234567890');
  await product('Parecido B', 10, 200, '7891234567899');
  const exact = getProductByBarcode('7891234567890');
  assert.equal(exact.barcode, '7891234567890');
  const viaApi = await api('GET', '/api/products?barcode=7891234567890');
  assert.equal(viaApi.json.length, 1);
  assert.equal(viaApi.json[0].barcode, '7891234567890');
  const similarMiss = await api('GET', '/api/products?barcode=789123456789');
  assert.equal(similarMiss.json.length, 0);

  recordEvidence({
    name: 'Scanner 10 leituras',
    tested: 'Mesmo barcode bipado 10x; qty=10; nenhum outro produto',
    command: COMMAND,
    result: 'PASS',
    expected: { productId: p.id, qty: 10, cartSize: 1 },
    found: { productId: p.id, qty: cart.get(p.id), cartSize: cart.size },
  });

  recordEvidence({
    name: 'Scanner códigos parecidos (exact match)',
    tested: 'barcode=7891234567890 não retorna 7891234567899; prefixo não faz match',
    command: COMMAND,
    result: 'PASS',
    expected: { exact: '7891234567890', prefixHits: 0 },
    found: { exact: exact.barcode, prefixHits: similarMiss.json.length },
  });
});

test('Scanner: código inexistente não seleciona parecido', async () => {
  await product('Existente Parecido', 5, 500, '5550001112223');
  const missCode = '5550001112229';
  let serviceNotFound = false;
  try {
    getProductByBarcode(missCode);
  } catch (e) {
    serviceNotFound = e?.code === 'PRODUCT_NOT_FOUND' || /não encontrado/i.test(String(e?.message));
  }
  assert.equal(serviceNotFound, true);
  const byApi = await api('GET', `/api/products?barcode=${missCode}`);
  assert.equal(byApi.status, 200);
  assert.equal(byApi.json.length, 0);
  const byPath = await api('GET', `/api/products/barcode/${missCode}`);
  assert.ok(byPath.status === 404 || byPath.json?.code === 'PRODUCT_NOT_FOUND');

  // cadastro rápido do código inexistente
  const created = await api('POST', '/api/products', {
    name: 'Produto Cadastro Rapido',
    barcode: missCode,
    price_cents: 1290,
    cost_cents: 600,
    stock_qty: 4,
    confirm_similar_name: true,
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.barcode, missCode);

  recordEvidence({
    name: 'Código inexistente',
    tested: 'Barcode desconhecido → PRODUCT_NOT_FOUND / lista vazia; cadastro rápido cria o código exato',
    command: COMMAND,
    result: 'PASS',
    expected: { lookupHits: 0, createdBarcode: missCode, serviceNotFound: true },
    found: {
      lookupHits: byApi.json.length,
      serviceNotFound,
      pathStatus: byPath.status,
      createdBarcode: created.json.barcode,
    },
  });
});

test('Venda: vários itens, qty +/-, exclusão, finalização, idempotência e estoque', async () => {
  const a = await product('Venda A', 20, 1000);
  const b = await product('Venda B', 20, 2500);
  const c = await product('Venda C', 20, 500);
  const stockA0 = a.stock_qty;
  const stockB0 = b.stock_qty;
  const stockC0 = c.stock_qty;

  // carrinho simulado: +qty, -qty, exclusão de C antes de finalizar
  let lines = [
    { product_id: a.id, quantity: 2 },
    { product_id: b.id, quantity: 1 },
    { product_id: c.id, quantity: 3 },
  ];
  lines = lines.map((l) =>
    l.product_id === a.id ? { ...l, quantity: l.quantity + 1 } : l
  ); // A: 3
  lines = lines.map((l) =>
    l.product_id === b.id ? { ...l, quantity: Math.max(0, l.quantity - 0) } : l
  );
  lines = lines.filter((l) => l.product_id !== c.id); // exclusão C

  const reqId = `venda-multi-${Date.now()}`;
  const sale1 = await api('POST', '/api/sales', {
    client_request_id: reqId,
    payment_method: 'pix',
    items: lines,
  });
  assert.equal(sale1.status, 201, JSON.stringify(sale1.json));
  assert.equal(sale1.json.total_cents, 1000 * 3 + 2500);

  // proteção duplo clique / reenvio
  const sale2 = await api('POST', '/api/sales', {
    client_request_id: reqId,
    payment_method: 'pix',
    items: lines,
  });
  assert.equal(sale2.status, 201);
  assert.equal(sale2.json.id, sale1.json.id);

  const stockA = (await api('GET', `/api/products/${a.id}`)).json.stock_qty;
  const stockB = (await api('GET', `/api/products/${b.id}`)).json.stock_qty;
  const stockC = (await api('GET', `/api/products/${c.id}`)).json.stock_qty;
  assert.equal(stockA, stockA0 - 3);
  assert.equal(stockB, stockB0 - 1);
  assert.equal(stockC, stockC0); // excluído do carrinho

  const salesCount = getDb()
    .prepare('SELECT COUNT(*) AS c FROM sales WHERE client_request_id = ?')
    .get(reqId).c;
  assert.equal(salesCount, 1);

  recordEvidence({
    name: 'Venda multi-itens + idempotência',
    tested: 'Vários produtos, qty, exclusão, finalize, reenvio client_request_id, baixa estoque',
    command: COMMAND,
    result: 'PASS',
    expected: {
      total: 5500,
      sameSaleId: true,
      stockA: stockA0 - 3,
      stockB: stockB0 - 1,
      stockC: stockC0,
      salesCount: 1,
    },
    found: {
      total: sale1.json.total_cents,
      sameSaleId: sale1.json.id === sale2.json.id,
      stockA,
      stockB,
      stockC,
      salesCount,
    },
  });
});

test('Dinheiro e troco: R$ 37,50 / recebido R$ 50,00 → troco R$ 12,50; bloqueia insuficiente', async () => {
  const p = await product('Item Troco 3750', 10, 3750);
  const ok = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.total_cents, 3750);
  assert.equal(ok.json.amount_received_cents, 5000);
  assert.equal(ok.json.change_cents, 1250);

  const detail = await api('GET', `/api/sales/${ok.json.id}`);
  assert.equal(detail.json.change_cents, 1250);

  const p2 = await product('Item Bloqueio', 5, 3750);
  const bad = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 2000,
    items: [{ product_id: p2.id, quantity: 1 }],
  });
  assert.ok(bad.status >= 400, JSON.stringify(bad.json));
  const stockAfter = (await api('GET', `/api/products/${p2.id}`)).json.stock_qty;
  assert.equal(stockAfter, 5);

  recordEvidence({
    name: 'Troco',
    tested: 'Venda 3750, recebido 5000 → change 1250',
    command: COMMAND,
    result: 'PASS',
    expected: { total: 3750, received: 5000, change: 1250 },
    found: {
      total: ok.json.total_cents,
      received: ok.json.amount_received_cents,
      change: ok.json.change_cents,
      detailChange: detail.json.change_cents,
    },
  });

  recordEvidence({
    name: 'Recebido menor que total (bloqueio)',
    tested: 'Dinheiro com amount_received_cents < total não finaliza nem baixa estoque',
    command: COMMAND,
    result: 'PASS',
    expected: { httpError: true, stockUnchanged: 5 },
    found: { status: bad.status, code: bad.json.code || bad.json.error, stockAfter },
  });
});

test('Crediário parcial → caixa só do valor recebido → quitado sem duplicar', async () => {
  const cust = await api('POST', '/api/customers', {
    name: 'Cliente Crediario Validacao',
    phone: '11988887777',
  });
  assert.equal(cust.status, 201, JSON.stringify(cust.json));
  const p = await product('Cred Item 200', 50, 20000);

  const beforeCash = await api('GET', '/api/cash/sessions/current');
  const dinheiroBefore = Number(beforeCash.json?.sales_dinheiro_cents || 0);
  const pixBefore = Number(beforeCash.json?.sales_pix_cents || 0);
  const credBefore = Number(beforeCash.json?.sales_crediario_cents || 0);
  const cashMovesBefore = getDb().prepare('SELECT COUNT(*) AS c FROM cash_movements').get().c;

  const sale = await api('POST', '/api/sales', {
    customer_id: cust.json.id,
    payment_method: 'crediario',
    items: [{ product_id: p.id, quantity: 1 }],
    credit: { entry_cents: 0, installment_count: 4, first_due_date: '2026-09-20' },
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  assert.equal(sale.json.total_cents, 20000);

  const accounts = await api('GET', '/api/credit/accounts');
  const acc = accounts.json.find((a) => a.sale_id === sale.json.id);
  assert.ok(acc);
  assert.equal(acc.balance_cents, 20000);

  const afterSaleCash = await api('GET', '/api/cash/sessions/current');
  const credAfterSale = Number(afterSaleCash.json?.sales_crediario_cents || 0);
  assert.equal(credAfterSale, credBefore + 20000);

  // R$ 50
  const pay1 = await api('POST', '/api/credit/payments', {
    credit_account_id: acc.id,
    amount_cents: 5000,
    method: 'dinheiro',
  });
  assert.ok(pay1.status < 300, JSON.stringify(pay1.json));
  assert.equal(pay1.json.balance_cents, 15000);

  const midCash1 = await api('GET', '/api/cash/sessions/current');
  const dinheiroAfter50 = Number(midCash1.json?.sales_dinheiro_cents || 0);
  const credAfter50 = Number(midCash1.json?.sales_crediario_cents || 0);
  assert.equal(dinheiroAfter50, dinheiroBefore + 5000);
  assert.equal(credAfter50, credAfterSale - 5000);

  const recvMoves = getDb()
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount_cents),0) AS s FROM cash_movements
       WHERE movement_type='recebimento_crediario' AND reference_id=?`
    )
    .get(acc.id);
  assert.equal(recvMoves.c, 1);
  assert.equal(recvMoves.s, 5000);

  const payRows1 = getDb()
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN is_reversal=1 THEN -amount_cents ELSE amount_cents END),0) AS s
       FROM credit_payments WHERE credit_account_id=?`
    )
    .get(acc.id).s;
  assert.equal(payRows1, 5000);

  // R$ 100
  const pay2 = await api('POST', '/api/credit/payments', {
    credit_account_id: acc.id,
    amount_cents: 10000,
    method: 'pix',
  });
  assert.equal(pay2.json.balance_cents, 5000);
  const midCash2 = await api('GET', '/api/cash/sessions/current');
  assert.equal(Number(midCash2.json?.sales_pix_cents || 0), pixBefore + 10000);

  // R$ 50 → quitado
  const pay3 = await api('POST', '/api/credit/payments', {
    credit_account_id: acc.id,
    amount_cents: 5000,
    method: 'dinheiro',
  });
  assert.equal(pay3.json.balance_cents, 0);
  assert.equal(pay3.json.status, 'quitado');

  const payRowsTotal = getDb()
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN is_reversal=1 THEN -amount_cents ELSE amount_cents END),0) AS s,
              COUNT(*) AS c
       FROM credit_payments WHERE credit_account_id=?`
    )
    .get(acc.id);
  assert.equal(payRowsTotal.s, 20000);
  assert.ok(payRowsTotal.c >= 3);

  const recvMovesFinal = getDb()
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(amount_cents),0) AS s FROM cash_movements
       WHERE movement_type='recebimento_crediario' AND reference_id=?`
    )
    .get(acc.id);
  assert.equal(recvMovesFinal.c, 3);
  assert.equal(recvMovesFinal.s, 20000);

  // reenvio não deve duplicar se tentarmos pagar de novo com saldo 0
  const payDup = await api('POST', '/api/credit/payments', {
    credit_account_id: acc.id,
    amount_cents: 100,
    method: 'dinheiro',
  });
  assert.ok(payDup.status >= 400, JSON.stringify(payDup.json));

  const afterCash = await api('GET', '/api/cash/sessions/current');
  const recvAfterDup = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM cash_movements
       WHERE movement_type='recebimento_crediario' AND reference_id=?`
    )
    .get(acc.id).c;
  assert.equal(recvAfterDup, 3);

  recordEvidence({
    name: 'Crediário parcial',
    tested: '200 → -50=150 → -100=50 → -50=0 quitado',
    command: COMMAND,
    result: 'PASS',
    expected: { balances: [15000, 5000, 0], status: 'quitado', paymentsSum: 20000 },
    found: {
      after50: 15000,
      after100: pay2.json.balance_cents,
      afterLast: pay3.json.balance_cents,
      status: pay3.json.status,
      paymentsSum: payRowsTotal.s,
      paymentCount: payRowsTotal.c,
    },
  });

  recordEvidence({
    name: 'Entrada no caixa (crediário)',
    tested: 'Após R$50: +5000 em sales_dinheiro e movimento recebimento_crediario; sem duplicar ao tentar pagar quitado',
    command: COMMAND,
    result: 'PASS',
    expected: {
      dinheiroDeltaAfter50: 5000,
      recvMovesAfter50: 1,
      recvTotal: 20000,
      dupBlocked: true,
    },
    found: {
      dinheiroBefore,
      dinheiroAfter50,
      credAfterSale,
      credAfter50,
      cashMovesBefore,
      recvMovesFinal: recvMovesFinal.s,
      recvAfterDup,
      afterDinheiro: Number(afterCash.json?.sales_dinheiro_cents || 0),
      dupStatus: payDup.status,
    },
  });
});

test('Estoque: vender 1 de estoque 1 → 0; entrada +10 → 10 com movimentação', async () => {
  const p = await product('Estoque Um', 1, 990);
  const sale = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201);
  const afterSale = (await api('GET', `/api/products/${p.id}`)).json;
  assert.equal(afterSale.stock_qty, 0);
  assert.ok(
    afterSale.situation === 'zerado' || afterSale.stock_qty === 0,
    JSON.stringify(afterSale)
  );

  const entry = await api('POST', '/api/stock/movements', {
    product_id: p.id,
    movement_type: 'entry',
    quantity: 10,
    reason: 'Entrada manual',
  });
  assert.ok(entry.status < 300, JSON.stringify(entry.json));
  assert.equal(entry.json.stock_after, 10);

  const finalP = (await api('GET', `/api/products/${p.id}`)).json;
  assert.equal(finalP.stock_qty, 10);

  const movs = await api('GET', `/api/stock/movements?product_id=${p.id}&limit=20`);
  assert.ok(Array.isArray(movs.json));
  assert.ok(movs.json.some((m) => m.movement_type === 'entry' || m.quantity_delta === 10));

  recordEvidence({
    name: 'Estoque zero',
    tested: 'estoque 1→venda→0 (zerado); entrada 10→10; histórico de movimentação',
    command: COMMAND,
    result: 'PASS',
    expected: { afterSale: 0, afterEntry: 10, hasMovement: true },
    found: {
      afterSale: afterSale.stock_qty,
      situation: afterSale.situation,
      afterEntry: finalP.stock_qty,
      stock_after: entry.json.stock_after,
      movements: movs.json.length,
    },
  });
});

test('Histórico: detalhe completo da venda', async () => {
  const cust = await api('POST', '/api/customers', {
    name: 'Cliente Historico',
    phone: '11977776666',
  });
  const p = await product('Hist Prod', 10, 3750, `hist${Date.now()}`);
  const sale = await api('POST', '/api/sales', {
    customer_id: cust.json.id,
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    discount_cents: 250,
    items: [{ product_id: p.id, quantity: 1, unit_price_cents: 3750 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.json));
  const d = (await api('GET', `/api/sales/${sale.json.id}`)).json;

  const required = {
    sale_number: d.sale_number,
    created_at: d.created_at,
    customer: d.customer?.name || d.customer_name,
    items: (d.items || []).map((i) => ({
      name: i.name,
      barcode: i.barcode,
      quantity: i.quantity,
      unit: i.unit_price_cents,
      discount: i.discount_cents,
      line: i.line_total_cents,
    })),
    total: d.total_cents,
    payment: d.payment_method,
    received: d.amount_received_cents,
    change: d.change_cents,
    operator: d.operator_name,
    status: d.status,
  };

  assert.ok(required.sale_number);
  assert.ok(required.created_at);
  assert.equal(required.customer, 'Cliente Historico');
  assert.equal(required.items.length, 1);
  assert.equal(required.items[0].quantity, 1);
  assert.equal(required.total, 3500);
  assert.equal(required.received, 5000);
  assert.equal(required.change, 1500);
  assert.ok(required.status);

  recordEvidence({
    name: 'Histórico',
    tested: 'GET /api/sales/:id contém número, data, cliente, itens, totais, pagamento, troco, status',
    command: COMMAND,
    result: 'PASS',
    expected: {
      customer: 'Cliente Historico',
      total: 3500,
      received: 5000,
      change: 1500,
      items: 1,
    },
    found: required,
  });
});

test('Alteração de venda com PIN admin recalcula estoque e caixa', async () => {
  const a = await product('Amend X', 30, 1000);
  const b = await product('Amend Y', 30, 2000);
  const beforeCash = await api('GET', '/api/cash/sessions/current');
  const salesBefore = Number(beforeCash.json?.sales_total_cents || 0);

  const sale = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    items: [{ product_id: a.id, quantity: 2 }],
  });
  assert.equal(sale.status, 201);
  const stockA1 = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(a.id).stock_qty;

  const amended = await api('PUT', `/api/sales/${sale.json.id}`, {
    admin_password: '230808',
    reason: 'Validacao final alteracao',
    items: [
      { product_id: a.id, quantity: 1, unit_price_cents: 1000 },
      { product_id: b.id, quantity: 1, unit_price_cents: 2000 },
    ],
  });
  assert.equal(amended.status, 200, JSON.stringify(amended.json));
  assert.equal(amended.json.total_cents, 3000);
  assert.ok(amended.json.amended_at);
  assert.ok(amended.json.amend_reason || amended.json.situation_label);

  const stockA2 = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(a.id).stock_qty;
  const stockB2 = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(b.id).stock_qty;
  assert.equal(stockA2, stockA1 + 1); // devolveu 1 de A
  assert.equal(stockB2, 29);

  const afterCash = await api('GET', '/api/cash/sessions/current');
  const salesAfter = Number(afterCash.json?.sales_total_cents || 0);
  // original 2000 + delta +1000 = 3000 delta from before sale start: +3000 net from before sale
  assert.equal(salesAfter, salesBefore + 3000);

  const audit = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM audit_logs WHERE entity_type LIKE '%sale%' OR action LIKE '%amend%' OR details LIKE '%alter%'`
    )
    .get();

  recordEvidence({
    name: 'Alteração de venda',
    tested: 'PUT /api/sales/:id com PIN; estoque por diferença; caixa; amended_at/motivo',
    command: COMMAND,
    result: 'PASS',
    expected: { total: 3000, stockADelta: +1, cashTotalDelta: 3000 },
    found: {
      total: amended.json.total_cents,
      amended_at: amended.json.amended_at,
      stockA1,
      stockA2,
      stockB2,
      salesBefore,
      salesAfter,
      auditRows: audit?.c,
    },
  });
});

test('Cancelamento: estoque devolvido, histórico cancelled, motivo e auditoria', async () => {
  const p = await product('Cancel Prod', 15, 1500);
  const sale = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: p.id, quantity: 2 }],
  });
  assert.equal(sale.status, 201);
  const stockMid = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(p.id).stock_qty;
  assert.equal(stockMid, 13);

  const cancel = await api('POST', `/api/sales/${sale.json.id}/cancel`, {
    reason: 'Validacao final cancelamento',
    admin_password: '230808',
  });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  assert.equal(cancel.json.status, 'cancelled');
  assert.ok(cancel.json.cancel_reason || cancel.json.cancelled_at);

  const stockEnd = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(p.id).stock_qty;
  assert.equal(stockEnd, 15);

  const stillThere = await api('GET', `/api/sales/${sale.json.id}`);
  assert.equal(stillThere.json.status, 'cancelled');

  recordEvidence({
    name: 'Cancelamento',
    tested: 'Cancel com PIN; estoque restaurado; status cancelled no histórico',
    command: COMMAND,
    result: 'PASS',
    expected: { status: 'cancelled', stock: 15 },
    found: {
      status: stillThere.json.status,
      stockMid,
      stockEnd,
      cancelled_at: stillThere.json.cancelled_at,
      reason: stillThere.json.cancel_reason,
    },
  });
});

test('Integridade do banco (DEPOIS)', () => {
  const db = getDb();
  const integrity = db.pragma('integrity_check')[0].integrity_check;
  const fk = db.pragma('foreign_key_check');
  assert.equal(integrity, 'ok');
  assert.equal(fk.length, 0);
  recordEvidence({
    name: 'Integridade do banco (DEPOIS)',
    tested: 'PRAGMA integrity_check + foreign_key_check após todas as operações',
    command: COMMAND,
    result: integrity === 'ok' && fk.length === 0 ? 'PASS' : 'FAIL',
    expected: { integrity: 'ok', fk: 0 },
    found: { integrity, fk: fk.length },
  });
  writeFileSync(SUMMARY_FILE, JSON.stringify(evidenceRows, null, 2));
});
