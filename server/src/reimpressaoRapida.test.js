import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ETAPA 4 — Reimpressão rápida (REIMPRIMIR / PDF direto na lista).
 *
 * A reimpressão é SOMENTE LEITURA: não pode duplicar venda, criar sale_items,
 * criar pagamento, baixar estoque nem alterar faturamento.
 */
const tmp = mkdtempSync(join(tmpdir(), 'onca-reimpressao-'));
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
let venda;
let produto;
let clienteId;

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

/** Fotografia do banco para comparar antes/depois. */
function snapshot() {
  const db = getDb();
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  return {
    sales: one('SELECT COUNT(*) AS c FROM sales').c,
    items: one('SELECT COUNT(*) AS c FROM sale_items').c,
    payments: one('SELECT COUNT(*) AS c FROM sale_payments').c,
    movements: one('SELECT COUNT(*) AS c FROM stock_movements').c,
    cashMovements: one('SELECT COUNT(*) AS c FROM cash_movements').c,
    stock: one('SELECT stock_qty AS q FROM products WHERE id = ?', produto.id).q,
    faturamento: one('SELECT COALESCE(SUM(total_cents),0) AS t FROM sales WHERE status = ?', 'completed').t,
    caixaVendas: one('SELECT sales_total_cents AS t FROM cash_sessions ORDER BY id DESC LIMIT 1').t,
  };
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
    operator_name: 'Reimpressao',
    opening_amount_cents: 20000,
  });

  seq += 1;
  produto = (
    await api('POST', '/api/products', {
      name: 'Reimpressao Produto',
      barcode: `988${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
      sku: `RI-${seq}-${Date.now()}`,
      price_cents: 3750,
      cost_cents: 1500,
      stock_qty: 10,
    })
  ).json;

  const cliente = await api('POST', '/api/customers', {
    name: 'Cliente Reimpressao',
    phone: '11988887777',
  });
  clienteId = cliente.json.id;

  venda = (
    await api('POST', '/api/sales', {
      customer_id: clienteId,
      payment_method: 'dinheiro',
      amount_received_cents: 5000,
      items: [{ product_id: produto.id, quantity: 1 }],
    })
  ).json;
  assert.equal(venda.total_cents, 3750);
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('PDF da venda é gerado com os dados originais', async () => {
  const gerado = await api('POST', `/api/receipts/sales/${venda.id}/pdf`, { force: false });
  assert.equal(gerado.status, 200, JSON.stringify(gerado.json));
  assert.ok(gerado.json.filename, 'deve devolver o nome do arquivo');
  assert.ok(gerado.json.download_url, 'deve devolver a URL de download');

  const pdf = await raw(`/api/receipts/sales/${venda.id}/pdf?download=1`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.equal(pdf.body.subarray(0, 4).toString('latin1'), '%PDF');
  assert.ok(pdf.body.length > 1000, `PDF pequeno: ${pdf.body.length} bytes`);
});

test('gerar PDF não cria venda, item, pagamento nem movimenta estoque/caixa', async () => {
  const antes = snapshot();

  await api('POST', `/api/receipts/sales/${venda.id}/pdf`, { force: false });
  await raw(`/api/receipts/sales/${venda.id}/pdf`);
  await raw(`/api/receipts/sales/${venda.id}/pdf?download=1`);
  // regerar o arquivo também não pode ter efeito no banco
  await api('POST', `/api/receipts/sales/${venda.id}/pdf`, { force: true });

  const depois = snapshot();
  assert.deepEqual(depois, antes, 'nenhum registro pode mudar por causa da reimpressão');
});

test('reimpressão mantém número, data, cliente, produtos, pagamento e total', async () => {
  const d = (await api('GET', `/api/sales/${venda.id}`)).json;
  assert.equal(d.sale_number, venda.sale_number);
  assert.equal(d.created_at, venda.created_at);
  assert.equal(d.customer?.name || d.customer_name, 'Cliente Reimpressao');
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].name, 'Reimpressao Produto');
  assert.equal(d.items[0].quantity, 1);
  assert.equal(d.total_cents, 3750);
  assert.equal(d.amount_received_cents, 5000);
  assert.equal(d.change_cents, 1250);
  assert.equal(d.payments[0].method, 'dinheiro');
});

test('reimprimir duas vezes seguidas continua sem duplicar nada', async () => {
  const antes = snapshot();
  for (let i = 0; i < 3; i += 1) {
    const pdf = await raw(`/api/receipts/sales/${venda.id}/pdf`);
    assert.equal(pdf.status, 200);
  }
  const depois = snapshot();
  assert.equal(depois.sales, antes.sales);
  assert.equal(depois.items, antes.items);
  assert.equal(depois.payments, antes.payments);
  assert.equal(depois.stock, antes.stock);
  assert.equal(depois.faturamento, antes.faturamento);
});

test('fila de impressão registra a reimpressão sem tocar na venda', async () => {
  const antes = snapshot();
  const job = await api('POST', '/api/print/jobs', {
    document_type: 'comprovante_reimpressao',
    document_ref: venda.sale_number,
    title: `REIMPRESSÃO — Comprovante ${venda.sale_number}`,
    kind: 'receipt',
  });
  assert.ok(job.status < 300, JSON.stringify(job.json));

  const registrado = getDb()
    .prepare(
      `SELECT document_type, document_ref FROM print_jobs
       WHERE document_ref = ? ORDER BY id DESC LIMIT 1`
    )
    .get(venda.sale_number);
  assert.equal(registrado.document_type, 'comprovante_reimpressao', 'reimpressão fica identificada');

  const depois = snapshot();
  assert.equal(depois.sales, antes.sales);
  assert.equal(depois.items, antes.items);
  assert.equal(depois.payments, antes.payments);
  assert.equal(depois.stock, antes.stock);
  assert.equal(depois.caixaVendas, antes.caixaVendas);
});

test('venda cancelada também pode ser reimpressa, sem reverter nada', async () => {
  seq += 1;
  const p2 = (
    await api('POST', '/api/products', {
      name: 'Reimpressao Cancelada',
      barcode: `989${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
      sku: `RC-${seq}-${Date.now()}`,
      price_cents: 1000,
      stock_qty: 5,
    })
  ).json;
  const v2 = (
    await api('POST', '/api/sales', {
      payment_method: 'pix',
      items: [{ product_id: p2.id, quantity: 2 }],
    })
  ).json;
  await api('POST', `/api/sales/${v2.id}/cancel`, { reason: 'Teste', admin_password: '230808' });

  const estoqueAntes = getDb().prepare('SELECT stock_qty AS q FROM products WHERE id = ?').get(p2.id).q;
  const pdf = await raw(`/api/receipts/sales/${v2.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 4).toString('latin1'), '%PDF');

  const estoqueDepois = getDb().prepare('SELECT stock_qty AS q FROM products WHERE id = ?').get(p2.id).q;
  assert.equal(estoqueDepois, estoqueAntes);
  const status = getDb().prepare('SELECT status FROM sales WHERE id = ?').get(v2.id).status;
  assert.equal(status, 'cancelled', 'reimprimir não muda o status da venda');
});

test('integridade preservada após as reimpressões', () => {
  const db = getDb();
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
