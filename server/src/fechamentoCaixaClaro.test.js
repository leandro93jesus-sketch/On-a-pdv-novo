import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ETAPA 1 — Fechamento diário de caixa mais claro.
 *
 * O objetivo é apresentação: os valores e regras já existentes NÃO podem mudar.
 * Estes testes fixam justamente isso — o valor esperado na gaveta continua vindo
 * de saldo inicial + dinheiro de vendas + suprimentos - sangrias, sem somar pix,
 * cartão ou crediário — e conferem os complementos de leitura que a tela usa.
 */
const tmp = mkdtempSync(join(tmpdir(), 'onca-fechamento-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { runMigrations } = await import('./db/migrate.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { computeExpectedCash } = await import('./services/cashService.js');

let server;
let baseUrl;
let token;
let seq = 0;
let sessionId;

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

async function raw(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

async function product(name, price, cost = 0) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `911${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `FC-${seq}-${Date.now()}`,
    price_cents: price,
    cost_cents: cost,
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

  // Cenário do enunciado: saldo inicial 100,00
  const abertura = await api('POST', '/api/cash/sessions/open', {
    operator_name: 'Fechamento',
    opening_amount_cents: 10000,
  });
  sessionId = abertura.json.id;

  const p = await product('Fechamento Produto', 8500, 4000);
  // Vendas em dinheiro somando 850,00 (10 x 85,00)
  for (let i = 0; i < 10; i += 1) {
    const venda = await api('POST', '/api/sales', {
      payment_method: 'dinheiro',
      amount_received_cents: 10000,
      items: [{ product_id: p.id, quantity: 1 }],
    });
    assert.equal(venda.status, 201, JSON.stringify(venda.json));
  }
  // Formas que NÃO entram na gaveta
  await api('POST', '/api/sales', { payment_method: 'pix', items: [{ product_id: p.id, quantity: 1 }] });
  await api('POST', '/api/sales', {
    payment_method: 'cartao',
    card_type: 'DEBIT',
    items: [{ product_id: p.id, quantity: 1 }],
  });
  await api('POST', '/api/sales', {
    payment_method: 'cartao',
    card_type: 'CREDIT',
    items: [{ product_id: p.id, quantity: 2 }],
  });
  const cliente = await api('POST', '/api/customers', { name: 'Cliente Fechamento', phone: '11900001111' });
  await api('POST', '/api/sales', {
    customer_id: cliente.json.id,
    payment_method: 'crediario',
    items: [{ product_id: p.id, quantity: 1 }],
    credit: { entry_cents: 0, installment_count: 2, first_due_date: '2026-10-10' },
  });

  // Suprimento 50,00 e sangria 300,00
  await api('POST', '/api/cash/movements', {
    movement_type: 'suprimento',
    amount_cents: 5000,
    reason: 'Troco inicial',
  });
  await api('POST', '/api/cash/movements', {
    movement_type: 'sangria',
    amount_cents: 30000,
    reason: 'Retirada para o banco',
  });
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('valor esperado na gaveta segue a regra existente e ignora pix/cartão/crediário', async () => {
  const conf = await api('GET', `/api/cash/sessions/${sessionId}`);
  assert.equal(conf.status, 200);
  const b = conf.json.breakdown;

  // 100,00 + 850,00 + 50,00 - 300,00 = 700,00 (exemplo do enunciado)
  assert.equal(b.opening_amount_cents, 10000);
  assert.equal(b.sales_dinheiro_cents, 85000);
  assert.equal(b.suprimentos_cents, 5000);
  assert.equal(b.sangrias_cents, 30000);
  assert.equal(conf.json.expected_amount_cents, 70000);

  // a função de cálculo não foi alterada
  assert.equal(computeExpectedCash(conf.json.session), 70000);

  // pix, cartão e crediário existem no faturamento mas ficam fora da gaveta
  assert.ok(b.sales_pix_cents > 0);
  assert.ok(b.sales_cartao_debito_cents > 0);
  assert.ok(b.sales_cartao_credito_cents > 0);
  assert.ok(b.sales_crediario_cents > 0);
  const naoDinheiro =
    b.sales_pix_cents + b.sales_cartao_cents + b.sales_crediario_cents + b.sales_outras_cents;
  assert.ok(naoDinheiro > 0);
  assert.equal(
    conf.json.expected_amount_cents,
    b.opening_amount_cents + b.sales_dinheiro_cents + b.cash_in_cents - b.cash_out_cents,
    'esperado não pode incluir formas que não são dinheiro'
  );
});

test('vendas do período separadas por forma, com total vendido', async () => {
  const b = (await api('GET', `/api/cash/sessions/${sessionId}`)).json.breakdown;
  for (const campo of [
    'sales_dinheiro_cents',
    'sales_pix_cents',
    'sales_cartao_debito_cents',
    'sales_cartao_credito_cents',
    'sales_crediario_cents',
    'sales_outras_cents',
    'sales_total_cents',
  ]) {
    assert.equal(typeof b[campo], 'number', `campo ausente: ${campo}`);
  }
  const soma =
    b.sales_dinheiro_cents +
    b.sales_pix_cents +
    b.sales_cartao_cents +
    b.sales_crediario_cents +
    b.sales_outras_cents;
  assert.equal(soma, b.sales_total_cents, 'formas de pagamento devem somar o total vendido');
  assert.equal(b.sales_cartao_debito_cents + b.sales_cartao_credito_cents, b.sales_cartao_cents);
});

test('resumo final traz vendas, itens, bruto, descontos e líquido', async () => {
  const b = (await api('GET', `/api/cash/sessions/${sessionId}`)).json.breakdown;
  // 10 dinheiro + pix + débito + crédito + crediário = 14 vendas
  assert.equal(b.sales_count, 14);
  // 10x1 + 1 + 1 + 2 + 1 = 15 itens
  assert.equal(b.items_sold, 15);
  assert.equal(b.gross_cents, b.net_cents + b.discount_cents);
  assert.equal(b.net_cents, b.sales_total_cents);
});

test('cancelamento em dinheiro sai da gaveta sem alterar a regra de cálculo', async () => {
  const p = await product('Fechamento Cancelar', 5000);
  const venda = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    amount_received_cents: 5000,
    items: [{ product_id: p.id, quantity: 1 }],
  });
  const antes = (await api('GET', `/api/cash/sessions/${sessionId}`)).json;
  assert.equal(antes.expected_amount_cents, 75000, 'venda de 50,00 entra na gaveta');

  await api('POST', `/api/sales/${venda.json.id}/cancel`, {
    reason: 'Teste',
    admin_password: '230808',
  });

  const depois = (await api('GET', `/api/cash/sessions/${sessionId}`)).json;
  assert.equal(depois.expected_amount_cents, 70000, 'cancelamento devolve a gaveta ao valor anterior');
  assert.equal(depois.breakdown.cancelamentos_dinheiro_cents, 5000, 'valor cancelado fica visível');
  assert.equal(
    depois.expected_amount_cents,
    depois.breakdown.opening_amount_cents +
      depois.breakdown.sales_dinheiro_cents +
      depois.breakdown.cash_in_cents -
      depois.breakdown.cash_out_cents
  );
});

test('PDF do fechamento é gerado e não altera nada', async () => {
  const antes = (await api('GET', `/api/cash/sessions/${sessionId}`)).json;

  const pdf = await raw(`/api/cash/sessions/${sessionId}/pdf?download=1`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.match(pdf.headers.get('content-disposition'), /attachment; filename="onca-pdv-fechamento-caixa-/);
  assert.equal(pdf.body.subarray(0, 4).toString('latin1'), '%PDF');
  assert.ok(pdf.body.length > 1000, `PDF pequeno: ${pdf.body.length} bytes`);

  const depois = (await api('GET', `/api/cash/sessions/${sessionId}`)).json;
  assert.equal(depois.expected_amount_cents, antes.expected_amount_cents);
  assert.equal(depois.breakdown.sales_total_cents, antes.breakdown.sales_total_cents);
  assert.equal(depois.session.status, antes.session.status, 'gerar PDF não fecha o caixa');
});

test('fechar caixa grava esperado, contado, diferença e observação sem duplicar registro', async () => {
  const { getDb } = await import('./db/index.js');
  const antesQtd = getDb().prepare('SELECT COUNT(*) AS c FROM cash_sessions').get().c;

  // Contado 695,00 para esperado 700,00 => falta 5,00 (exemplo do enunciado)
  const fechamento = await api('POST', '/api/cash/sessions/close', {
    counted_amount_cents: 69500,
    close_notes: 'Conferido em duas contagens',
  });
  assert.equal(fechamento.status, 200, JSON.stringify(fechamento.json));
  assert.equal(fechamento.json.session.expected_amount_cents, 70000);
  assert.equal(fechamento.json.session.counted_amount_cents, 69500);
  assert.equal(fechamento.json.session.difference_cents, -500, 'diferença negativa = falta');
  assert.equal(fechamento.json.session.close_notes, 'Conferido em duas contagens');
  assert.ok(fechamento.json.session.closed_at);
  assert.equal(fechamento.json.session.operator_name, 'Fechamento');

  const depoisQtd = getDb().prepare('SELECT COUNT(*) AS c FROM cash_sessions').get().c;
  assert.equal(depoisQtd, antesQtd, 'fechar não pode criar outra sessão');

  // o PDF do caixa fechado continua disponível para reimpressão
  const pdf = await raw(`/api/cash/sessions/${sessionId}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString('latin1'), '%PDF');
});
