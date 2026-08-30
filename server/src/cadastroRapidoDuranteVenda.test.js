import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ALTERAÇÃO 3 — Código não cadastrado durante a venda.
 * Fluxo: bipar código inexistente -> cadastrar na hora -> voltar à venda com o
 * carrinho, cliente e desconto preservados e o produto novo incluído.
 */
const tmp = mkdtempSync(join(tmpdir(), 'onca-cadastro-rapido-'));
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

async function product(name, price = 1000) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: `933${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: `CR-${seq}-${Date.now()}`,
    price_cents: price,
    stock_qty: 50,
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
    operator_name: 'CadastroRapido',
    opening_amount_cents: 20000,
  });
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('bipar código inexistente devolve vazio (tela abre o cadastro rápido)', async () => {
  const codigo = `7893000${String(Date.now()).slice(-6)}`;
  const res = await api('GET', `/api/products?barcode=${codigo}`);
  assert.equal(res.status, 200);
  assert.equal(res.json.length, 0, 'sem match a tela deve oferecer cadastrar agora');
});

test('cadastro rápido cria com o código já preenchido e persiste no banco', async () => {
  const codigo = `7893100${String(Date.now()).slice(-6)}`;
  const criado = await api('POST', '/api/products', {
    name: 'Rápido Água Sanitária 1L',
    barcode: codigo,
    price_cents: 799,
    cost_cents: 350,
    stock_qty: 12,
    min_stock_qty: 2,
    category: 'Limpeza',
    confirm_similar_name: true,
  });
  assert.equal(criado.status, 201, JSON.stringify(criado.json));
  assert.equal(criado.json.barcode, codigo);

  // persistência real no SQLite, não só a resposta HTTP
  const row = getDb()
    .prepare('SELECT id, name, barcode, price_cents, stock_qty FROM products WHERE barcode = ?')
    .get(codigo);
  assert.ok(row, 'produto deve existir no banco');
  assert.equal(row.id, criado.json.id);
  assert.equal(row.price_cents, 799);
  assert.equal(row.stock_qty, 12);

  // e a bipagem seguinte já encontra
  const scan = await api('GET', `/api/products?barcode=${codigo}`);
  assert.equal(scan.json.length, 1);
  assert.equal(scan.json[0].id, criado.json.id);
});

test('nova consulta antes de criar impede duplicidade do mesmo código', async () => {
  const codigo = `7893200${String(Date.now()).slice(-6)}`;
  const primeiro = await api('POST', '/api/products', {
    name: 'Rápido Duplicado',
    barcode: codigo,
    price_cents: 500,
    confirm_similar_name: true,
  });
  assert.equal(primeiro.status, 201);

  const consultaAntes = await api('GET', `/api/products?barcode=${codigo}`);
  assert.equal(consultaAntes.json.length, 1, 'a tela reconsulta e oferece "usar existente"');

  const segundo = await api('POST', '/api/products', {
    name: 'Rápido Duplicado 2',
    barcode: codigo,
    price_cents: 600,
    confirm_similar_name: true,
  });
  assert.ok(segundo.status >= 400, JSON.stringify(segundo.json));
  assert.equal(segundo.json.code, 'DUPLICATE_BARCODE');

  const total = getDb()
    .prepare('SELECT COUNT(*) AS c FROM products WHERE barcode = ?')
    .get(codigo).c;
  assert.equal(total, 1, 'não pode criar produto duplicado');
});

test('venda continua com carrinho, cliente e desconto preservados após o cadastro', async () => {
  const jaNoCarrinho = await product('Rápido Item Existente', 2000);
  const cliente = await api('POST', '/api/customers', {
    name: 'Cliente Cadastro Rápido',
    phone: '11955554444',
  });

  // durante a venda: bipou um código desconhecido e cadastrou na hora
  const codigo = `7893300${String(Date.now()).slice(-6)}`;
  const novo = await api('POST', '/api/products', {
    name: 'Rápido Item Novo',
    barcode: codigo,
    price_cents: 1500,
    stock_qty: 5,
    confirm_similar_name: true,
  });
  assert.equal(novo.status, 201);

  // conclui a venda com os dois itens, cliente e desconto preservados
  const venda = await api('POST', '/api/sales', {
    customer_id: cliente.json.id,
    payment_method: 'dinheiro',
    amount_received_cents: 10000,
    discount_cents: 500,
    items: [
      { product_id: jaNoCarrinho.id, quantity: 2 },
      { product_id: novo.json.id, quantity: 1 },
    ],
  });
  assert.equal(venda.status, 201, JSON.stringify(venda.json));
  assert.equal(venda.json.subtotal_cents, 2000 * 2 + 1500);
  assert.equal(venda.json.discount_cents, 500);
  assert.equal(venda.json.total_cents, 5000);
  assert.equal(venda.json.change_cents, 5000);

  const detalhe = await api('GET', `/api/sales/${venda.json.id}`);
  assert.equal(detalhe.json.items.length, 2, 'produto anterior não pode ser perdido');
  assert.equal(detalhe.json.customer?.name || detalhe.json.customer_name, 'Cliente Cadastro Rápido');
  const nomes = detalhe.json.items.map((i) => i.name).sort();
  assert.deepEqual(nomes, ['Rápido Item Existente', 'Rápido Item Novo']);

  // estoque do produto recém-cadastrado baixou de 5 para 4
  const estoqueNovo = (await api('GET', `/api/products/${novo.json.id}`)).json.stock_qty;
  assert.equal(estoqueNovo, 4);
});

test('cancelar o cadastro rápido não cria produto nem altera a venda', async () => {
  const codigo = `7893400${String(Date.now()).slice(-6)}`;
  const antes = getDb().prepare('SELECT COUNT(*) AS c FROM products').get().c;

  // "Cancelar" no modal: nada é enviado ao servidor
  const consulta = await api('GET', `/api/products?barcode=${codigo}`);
  assert.equal(consulta.json.length, 0);

  const depois = getDb().prepare('SELECT COUNT(*) AS c FROM products').get().c;
  assert.equal(depois, antes, 'cancelar não pode criar produto');
});
