import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ALTERAÇÃO 2 — Leitor de código de barras.
 * O defeito relatado era "às vezes entra outro produto". Aqui a busca por
 * bipagem é validada com correspondência EXATA, em rajada e com códigos
 * parecidos/concorrentes, além do acúmulo de quantidade no carrinho.
 */
const tmp = mkdtempSync(join(tmpdir(), 'onca-scanner-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { runMigrations } = await import('./db/migrate.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { getProductByBarcode } = await import('./services/productsService.js');

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

async function product(name, barcode, price = 1000) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode,
    sku: `SC-${seq}-${Date.now()}`,
    price_cents: price,
    stock_qty: 500,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

/** Reproduz o acúmulo por ID feito pela tela de vendas ao bipar. */
function addToCart(cart, product) {
  const line = cart.get(product.id);
  if (line) line.quantity += 1;
  else cart.set(product.id, { name: product.name, quantity: 1 });
  return cart;
}

/** Bipagem: busca por barcode e exige correspondência exata. */
async function scan(code) {
  const res = await api('GET', `/api/products?barcode=${encodeURIComponent(code)}`);
  assert.equal(res.status, 200);
  const exact = res.json.filter((p) => String(p.barcode || '').trim() === String(code).trim());
  return exact[0] || null;
}

const CODE_A = '7891234567890';
const CODE_B = '7891234567899';
const CODE_PREFIX = '789123456789';
let prodA;
let prodB;

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

  prodA = await product('Scanner Produto A', CODE_A, 1000);
  prodB = await product('Scanner Produto B', CODE_B, 2000);
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('mesmo código 20 vezes = quantidade 20 do mesmo produto', async () => {
  const cart = new Map();
  for (let i = 0; i < 20; i += 1) {
    const hit = await scan(CODE_A);
    assert.ok(hit, `bipagem ${i + 1} não encontrou o produto`);
    assert.equal(hit.id, prodA.id, `bipagem ${i + 1} trouxe outro produto: ${hit.name}`);
    addToCart(cart, hit);
  }
  assert.equal(cart.size, 1, 'não pode criar outra linha para o mesmo produto');
  assert.equal(cart.get(prodA.id).quantity, 20);
});

test('alternar A/B/A/B mantém cada leitura no produto certo', async () => {
  const cart = new Map();
  const sequence = [];
  for (let i = 0; i < 20; i += 1) sequence.push(i % 2 === 0 ? CODE_A : CODE_B);

  for (const [i, code] of sequence.entries()) {
    const hit = await scan(code);
    const expected = code === CODE_A ? prodA.id : prodB.id;
    assert.equal(hit.id, expected, `leitura ${i + 1} (${code}) caiu no produto errado`);
    addToCart(cart, hit);
  }
  assert.equal(cart.size, 2);
  assert.equal(cart.get(prodA.id).quantity, 10);
  assert.equal(cart.get(prodB.id).quantity, 10);
});

test('100 leituras rápidas e simultâneas não trocam de produto (race condition)', async () => {
  const codes = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? CODE_A : CODE_B));
  // Dispara tudo em paralelo: é o cenário de rajada do leitor que causava troca.
  const results = await Promise.all(codes.map((code) => scan(code).then((hit) => ({ code, hit }))));

  const cart = new Map();
  for (const [i, { code, hit }] of results.entries()) {
    assert.ok(hit, `leitura paralela ${i + 1} não encontrou nada`);
    assert.equal(hit.barcode, code, `leitura paralela ${i + 1} respondeu outro código`);
    assert.equal(hit.id, code === CODE_A ? prodA.id : prodB.id);
    addToCart(cart, hit);
  }
  assert.equal(cart.size, 2);
  assert.equal(cart.get(prodA.id).quantity, 50);
  assert.equal(cart.get(prodB.id).quantity, 50);
});

test('código parecido/prefixo não faz match aproximado', async () => {
  const prefix = await scan(CODE_PREFIX);
  assert.equal(prefix, null, 'prefixo não pode encontrar produto');

  const viaApi = await api('GET', `/api/products?barcode=${CODE_PREFIX}`);
  assert.equal(viaApi.json.length, 0, 'consulta por prefixo deve vir vazia');

  // busca livre por termo ainda encontra (comportamento de pesquisa manual)
  const busca = await api('GET', `/api/products?q=${CODE_PREFIX}`);
  assert.ok(busca.json.length >= 2, 'pesquisa manual por termo continua funcionando');

  const exatoA = await scan(CODE_A);
  const exatoB = await scan(CODE_B);
  assert.equal(exatoA.id, prodA.id);
  assert.equal(exatoB.id, prodB.id);
  assert.notEqual(exatoA.id, exatoB.id);
});

test('código inexistente não retorna produto nem lança erro na busca', async () => {
  const inexistente = `7899${String(Date.now()).slice(-9)}`;
  const hit = await scan(inexistente);
  assert.equal(hit, null);

  const viaApi = await api('GET', `/api/products?barcode=${inexistente}`);
  assert.equal(viaApi.status, 200);
  assert.equal(viaApi.json.length, 0);

  // o serviço usado pelo desktop lança NOT_FOUND explícito (tratado pela tela)
  assert.throws(() => getProductByBarcode(inexistente), /não encontrado|not found/i);
});

test('código recém-cadastrado é encontrado na bipagem seguinte', async () => {
  const novoCodigo = `7891111${String(Date.now()).slice(-6)}`;
  const antes = await scan(novoCodigo);
  assert.equal(antes, null);

  const novo = await product('Scanner Recem Cadastrado', novoCodigo, 1500);
  const depois = await scan(novoCodigo);
  assert.ok(depois, 'produto recém-cadastrado deve ser encontrado');
  assert.equal(depois.id, novo.id);
  assert.equal(depois.barcode, novoCodigo);

  const cart = new Map();
  addToCart(cart, depois);
  addToCart(cart, await scan(novoCodigo));
  assert.equal(cart.get(novo.id).quantity, 2);
});

test('bipagem não altera estoque nem cria venda', async () => {
  const before = (await api('GET', `/api/products/${prodA.id}`)).json.stock_qty;
  const salesBefore = (await api('GET', '/api/sales?limit=100')).json.length;

  for (let i = 0; i < 10; i += 1) await scan(CODE_A);

  const after = (await api('GET', `/api/products/${prodA.id}`)).json.stock_qty;
  const salesAfter = (await api('GET', '/api/sales?limit=100')).json.length;
  assert.equal(after, before, 'bipar não pode movimentar estoque');
  assert.equal(salesAfter, salesBefore, 'bipar não pode criar venda');
});
