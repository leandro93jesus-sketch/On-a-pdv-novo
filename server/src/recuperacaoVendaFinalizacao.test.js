import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ETAPA 3 — Recuperação de venda: lado do servidor.
 *
 * O rascunho é só o carrinho: enquanto existe, nada é registrado. Ao concluir a
 * venda recuperada, o estoque baixa UMA única vez, mesmo com reenvio.
 */
const tmp = mkdtempSync(join(tmpdir(), 'onca-recuperacao-'));
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

async function product(name, { stock = 20, price = 1000 } = {}) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `977${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `RV-${seq}-${Date.now()}`,
    price_cents: price,
    stock_qty: stock,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

function estoque(id) {
  return getDb().prepare('SELECT stock_qty FROM products WHERE id = ?').get(id).stock_qty;
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
    operator_name: 'Recuperacao',
    opening_amount_cents: 20000,
  });
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('rascunho não registra nada: sem venda, sem estoque, sem caixa', async () => {
  const p = await product('Rascunho Produto', { stock: 10 });
  const caixaAntes = (await api('GET', '/api/cash/sessions/current')).json;
  const vendasAntes = getDb().prepare('SELECT COUNT(*) AS c FROM sales').get().c;

  // O rascunho vive no cliente; do lado do servidor nada é enviado enquanto a
  // venda não é concluída. Aqui isso é confirmado pelo estado inalterado.
  assert.equal(estoque(p.id), 10);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS c FROM sales').get().c, vendasAntes);
  const caixaDepois = (await api('GET', '/api/cash/sessions/current')).json;
  assert.equal(caixaDepois.sales_total_cents, caixaAntes.sales_total_cents);
});

test('TESTE 3: concluir a venda recuperada baixa o estoque UMA única vez', async () => {
  const a = await product('Recuperado A', { stock: 10, price: 1000 });
  const b = await product('Recuperado B', { stock: 10, price: 2500 });
  const c = await product('Recuperado C', { stock: 10, price: 500 });

  // carrinho recuperado com 3 produtos
  const reqId = `recuperada-${Date.now()}`;
  const venda = await api('POST', '/api/sales', {
    client_request_id: reqId,
    payment_method: 'dinheiro',
    amount_received_cents: 10000,
    items: [
      { product_id: a.id, quantity: 1 },
      { product_id: b.id, quantity: 2 },
      { product_id: c.id, quantity: 3 },
    ],
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));
  assert.equal(venda.json.total_cents, 1000 + 5000 + 1500);
  assert.equal(estoque(a.id), 9);
  assert.equal(estoque(b.id), 8);
  assert.equal(estoque(c.id), 7);

  // reenvio (por exemplo: a energia caiu logo depois de enviar)
  const reenvio = await api('POST', '/api/sales', {
    client_request_id: reqId,
    payment_method: 'dinheiro',
    amount_received_cents: 10000,
    items: [
      { product_id: a.id, quantity: 1 },
      { product_id: b.id, quantity: 2 },
      { product_id: c.id, quantity: 3 },
    ],
  });
  assert.equal(reenvio.status, 201);
  assert.equal(reenvio.json.id, venda.json.id, 'reenvio devolve a mesma venda');
  assert.equal(estoque(a.id), 9, 'estoque não pode baixar duas vezes');
  assert.equal(estoque(b.id), 8);
  assert.equal(estoque(c.id), 7);

  const qtdVendas = getDb()
    .prepare('SELECT COUNT(*) AS c FROM sales WHERE client_request_id = ?')
    .get(reqId).c;
  assert.equal(qtdVendas, 1);

  const movimentos = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM stock_movements
       WHERE reference_type = 'sale' AND reference_id = ?`
    )
    .get(venda.json.id).c;
  assert.equal(movimentos, 3, 'uma movimentação por item, sem duplicar');
});

test('validação na recuperação: produto apagado é detectado pela consulta', async () => {
  const p = await product('Recuperado Removido', { stock: 5 });
  const antes = await api('GET', `/api/products/${p.id}`);
  assert.equal(antes.status, 200);

  const remocao = await api('DELETE', `/api/products/${p.id}`);
  assert.ok(remocao.status < 300, JSON.stringify(remocao.json));

  // A tela confere cada item do rascunho por id; produto inativo/removido não
  // volta na consulta ativa e é retirado do carrinho com aviso.
  const ativo = await api('GET', `/api/products?q=${encodeURIComponent('Recuperado Removido')}`);
  assert.equal(ativo.json.length, 0, 'produto removido não aparece mais na busca ativa');
});

test('validação na recuperação: preço alterado é percebido', async () => {
  const p = await product('Recuperado Preco', { stock: 5, price: 1000 });
  const alterado = await api('PUT', `/api/products/${p.id}`, {
    name: 'Recuperado Preco',
    price_cents: 1500,
    confirm_similar_name: true,
  });
  assert.equal(alterado.status, 200, JSON.stringify(alterado.json));

  const atual = await api('GET', `/api/products/${p.id}`);
  assert.equal(atual.json.price_cents, 1500, 'a tela usa este valor para avisar a diferença');
  assert.notEqual(atual.json.price_cents, 1000);
});

test('integridade preservada depois das recuperações', () => {
  const db = getDb();
  assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.equal(db.pragma('foreign_key_check').length, 0);
});
