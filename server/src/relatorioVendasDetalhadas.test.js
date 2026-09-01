import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-relatorio-detalhado-'));
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
let saleDinheiro;
let salePix;
let saleCancelada;
let produtoA;
let produtoB;
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

async function product(name, { stock = 50, price = 1000, cost = 400 } = {}) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `988${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `RD-${seq}-${Date.now()}`,
    price_cents: price,
    cost_cents: cost,
    stock_qty: stock,
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
    operator_name: 'Maria Balcao',
    opening_amount_cents: 10000,
  });

  const cust = await api('POST', '/api/customers', {
    name: 'Cliente Detalhado',
    phone: '11988887777',
  });
  clienteId = cust.json.id;

  // custo 400 x2 = 800; total 2000 - 200 desconto = 1800
  produtoA = await product('Detalhado Desinfetante', { price: 1000, cost: 400 });
  produtoB = await product('Detalhado Sabao', { price: 2500, cost: 900 });

  saleDinheiro = (
    await api('POST', '/api/sales', {
      customer_id: clienteId,
      payment_method: 'dinheiro',
      amount_received_cents: 5000,
      discount_cents: 200,
      items: [{ product_id: produtoA.id, quantity: 2 }],
    })
  ).json;

  salePix = (
    await api('POST', '/api/sales', {
      payment_method: 'pix',
      items: [{ product_id: produtoB.id, quantity: 1 }],
    })
  ).json;

  saleCancelada = (
    await api('POST', '/api/sales', {
      payment_method: 'pix',
      items: [{ product_id: produtoB.id, quantity: 1 }],
    })
  ).json;
  await api('POST', `/api/sales/${saleCancelada.id}/cancel`, {
    reason: 'teste de relatorio',
    admin_password: '230808',
  });
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('catálogo expõe o relatório Vendas detalhadas', async () => {
  const catalog = await api('GET', '/api/reports');
  assert.equal(catalog.status, 200);
  const item = catalog.json.find((r) => r.id === 'vendas_detalhadas');
  assert.ok(item, 'vendas_detalhadas deve estar no catálogo');
  assert.equal(item.title, 'Vendas detalhadas');
});

test('linhas trazem recebido, troco, subtotal, desconto e produtos', async () => {
  const res = await api('GET', '/api/reports/vendas_detalhadas?period=hoje');
  assert.equal(res.status, 200);

  for (const col of [
    'sale_number',
    'sale_date',
    'sale_time',
    'customer_name',
    'operator_name',
    'products_summary',
    'items_count',
    'subtotal_cents',
    'discount_cents',
    'total_cents',
    'payment_methods',
    'amount_received_cents',
    'change_cents',
    'status_label',
  ]) {
    assert.ok(res.json.columns.includes(col), `coluna ausente: ${col}`);
  }

  const row = res.json.rows.find((r) => r.id === saleDinheiro.id);
  assert.ok(row, 'venda em dinheiro deve aparecer');
  assert.equal(row.subtotal_cents, 2000);
  assert.equal(row.discount_cents, 200);
  assert.equal(row.total_cents, 1800);
  assert.equal(row.amount_received_cents, 5000);
  assert.equal(row.change_cents, 3200);
  assert.equal(row.items_count, 2);
  assert.equal(row.customer_name, 'Cliente Detalhado');
  assert.equal(row.operator_name, 'Maria Balcao');
  assert.match(row.products_summary, /2x Detalhado Desinfetante/);
  assert.equal(row.payment_methods, 'dinheiro');
  assert.equal(row.status_label, 'Concluída');
  assert.equal(row.cost_cents, 800);
  assert.equal(row.profit_cents, 1000);
});

test('resumo do período traz itens, custo, lucro e ticket médio', async () => {
  const res = await api('GET', '/api/reports/vendas_detalhadas?period=hoje');
  const t = res.json.totals;
  // Concluídas: dinheiro (subtotal 2000, desc 200, total 1800, custo 800)
  //             pix (subtotal 2500, desc 0, total 2500, custo 900)
  assert.equal(t.sales_count, 2);
  assert.equal(t.cancelled_count, 1);
  assert.equal(t.items_sold, 3);
  assert.equal(t.gross_cents, 4500);
  assert.equal(t.discount_cents, 200);
  assert.equal(t.net_cents, 4300);
  assert.equal(t.cost_cents, 1700);
  assert.equal(t.profit_cents, 2600);
  assert.equal(t.ticket_avg_cents, 2150);
  assert.equal(t.gross_cents - t.discount_cents, t.net_cents);
});

test('filtros: hoje, ontem, produto, cliente, operador, pagamento, situação e número', async () => {
  const hoje = await api('GET', '/api/reports/vendas_detalhadas?period=hoje');
  assert.equal(hoje.json.rows.length, 3);

  const ontem = await api('GET', '/api/reports/vendas_detalhadas?period=ontem');
  assert.equal(ontem.json.rows.length, 0, 'nada foi vendido ontem no banco isolado');

  const porProduto = await api(
    'GET',
    `/api/reports/vendas_detalhadas?period=hoje&product=${encodeURIComponent('Detalhado Desinfetante')}`
  );
  assert.equal(porProduto.json.rows.length, 1);
  assert.equal(porProduto.json.rows[0].id, saleDinheiro.id);

  const porBarcode = await api(
    'GET',
    `/api/reports/vendas_detalhadas?period=hoje&product=${produtoB.barcode}`
  );
  assert.equal(porBarcode.json.rows.length, 2, 'produto B está em duas vendas (uma cancelada)');

  const porCliente = await api('GET', '/api/reports/vendas_detalhadas?period=hoje&customer=Detalhado');
  assert.equal(porCliente.json.rows.length, 1);

  const porOperador = await api('GET', '/api/reports/vendas_detalhadas?period=hoje&operator=Maria');
  assert.equal(porOperador.json.rows.length, 3);

  const porPagamento = await api(
    'GET',
    '/api/reports/vendas_detalhadas?period=hoje&payment_method=dinheiro'
  );
  assert.equal(porPagamento.json.rows.length, 1);
  assert.equal(porPagamento.json.rows[0].id, saleDinheiro.id);

  const canceladas = await api('GET', '/api/reports/vendas_detalhadas?period=hoje&status=cancelled');
  assert.equal(canceladas.json.rows.length, 1);
  assert.equal(canceladas.json.rows[0].id, saleCancelada.id);

  const porNumero = await api(
    'GET',
    `/api/reports/vendas_detalhadas?period=hoje&sale_number=${salePix.sale_number}`
  );
  assert.equal(porNumero.json.rows.length, 1);
  assert.equal(porNumero.json.rows[0].id, salePix.id);
});

test('exportação CSV traz cabeçalho, linhas e resumo', async () => {
  const res = await raw('/api/reports/vendas_detalhadas/csv?period=hoje');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="onca-pdv-vendas_detalhadas-/);
  const csv = res.body.toString('utf8');
  assert.ok(csv.startsWith('\uFEFF'), 'CSV precisa de BOM para o Excel');
  assert.match(csv, /Nº venda;Data;Hora/);
  assert.match(csv, /RESUMO DO PERÍODO/);
  // Intl usa espaço não separável entre R$ e o valor.
  assert.match(csv, /Lucro;"R\$\s26,00"/);
  const dataLines = csv.split('\r\n').filter((l) => l.includes('Detalhado Desinfetante'));
  assert.equal(dataLines.length, 1);
});

test('exportação PDF devolve um PDF válido', async () => {
  const res = await raw('/api/reports/vendas_detalhadas/pdf?period=hoje&download=1');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/pdf/);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.equal(res.body.subarray(0, 4).toString('latin1'), '%PDF');
  assert.ok(res.body.length > 1000, `PDF muito pequeno: ${res.body.length} bytes`);
});

test('relatório é somente leitura: não altera venda, estoque nem caixa', async () => {
  const before = {
    sale: (await api('GET', `/api/sales/${saleDinheiro.id}`)).json,
    stock: (await api('GET', `/api/products/${produtoA.id}`)).json.stock_qty,
    cash: (await api('GET', '/api/cash/sessions/current')).json,
  };

  await api('GET', '/api/reports/vendas_detalhadas?period=hoje');
  await raw('/api/reports/vendas_detalhadas/csv?period=hoje');
  await raw('/api/reports/vendas_detalhadas/pdf?period=hoje');

  const after = {
    sale: (await api('GET', `/api/sales/${saleDinheiro.id}`)).json,
    stock: (await api('GET', `/api/products/${produtoA.id}`)).json.stock_qty,
    cash: (await api('GET', '/api/cash/sessions/current')).json,
  };

  assert.equal(after.sale.total_cents, before.sale.total_cents);
  assert.equal(after.sale.status, before.sale.status);
  assert.equal(after.stock, before.stock);
  assert.equal(after.cash.sales_total_cents, before.cash.sales_total_cents);
});

test('relatório vendas_periodo original continua funcionando (regressão)', async () => {
  const res = await api('GET', '/api/reports/vendas_periodo');
  assert.equal(res.status, 200);
  assert.ok(res.json.totals);
  assert.ok(res.json.columns.includes('sale_number'));
  assert.equal(res.json.rows.length, 3);
});
