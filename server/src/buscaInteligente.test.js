import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ETAPA 2 — Busca manual inteligente SEM atrapalhar o scanner.
 *
 * Duas regras convivem e são testadas juntas:
 *   scanner      -> ?barcode= : correspondência EXATA, nunca aproximada
 *   digitação    -> /busca-manual : várias palavras parciais, sem acento, ranqueada
 */
const tmp = mkdtempSync(join(tmpdir(), 'onca-busca-'));
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
const ids = {};

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

async function product(name, { barcode, category = 'Limpeza', price = 1000, sku } = {}) {
  seq += 1;
  const res = await api('POST', '/api/products', {
    name,
    barcode: barcode || `966${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`,
    sku: sku || `BM-${seq}-${Date.now()}`,
    category,
    price_cents: price,
    stock_qty: 40,
    confirm_similar_name: true,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return res.json;
}

/** Busca manual (digitação). */
async function manual(q) {
  const res = await api('GET', `/api/products/busca-manual?q=${encodeURIComponent(q)}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json;
}

/** Bipagem (scanner): exige match exato. */
async function scanner(code) {
  const res = await api('GET', `/api/products?barcode=${encodeURIComponent(code)}`);
  assert.equal(res.status, 200);
  return res.json.filter((p) => String(p.barcode || '').trim() === String(code).trim());
}

const COD_DESINF = '7891111000011';
const COD_SIMILAR = '7891111000019';

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

  ids.desinf5l = (await product('DESINFETANTE LAVANDA 5L', { barcode: COD_DESINF })).id;
  ids.desinf2l = (await product('DESINFETANTE LAVANDA 2L')).id;
  ids.desinfPinho = (await product('DESINFETANTE PINHO 5L')).id;
  ids.similar = (await product('Produto Codigo Parecido', { barcode: COD_SIMILAR })).id;
  ids.detergente = (await product('DETERGENTE NEUTRO 500ML')).id;
  ids.detergenteCoco = (await product('DETERGENTE COCO 500ML')).id;
  ids.sabao = (await product('SABÃO EM PÓ MAÇÃ VERDE 1KG')).id;
  ids.amaciante = (await product('AMACIANTE LAVANDA 2L', { category: 'Roupas' })).id;
  ids.agua = (await product('ÁGUA SANITÁRIA 1L', { sku: 'AGUA-SAN-1L' })).id;
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('scanner continua EXATO: mesmo código 20 vezes traz sempre o mesmo produto', async () => {
  for (let i = 0; i < 20; i += 1) {
    const hits = await scanner(COD_DESINF);
    assert.equal(hits.length, 1, `bipagem ${i + 1} deveria trazer 1 produto`);
    assert.equal(hits[0].id, ids.desinf5l, `bipagem ${i + 1} trouxe outro produto`);
  }
});

test('scanner com código semelhante nunca traz outro produto', async () => {
  const exato = await scanner(COD_DESINF);
  const similar = await scanner(COD_SIMILAR);
  assert.equal(exato[0].id, ids.desinf5l);
  assert.equal(similar[0].id, ids.similar);
  assert.notEqual(exato[0].id, similar[0].id);

  // prefixo não pode encontrar nada pelo caminho do scanner
  const prefixo = await api('GET', `/api/products?barcode=${COD_DESINF.slice(0, -1)}`);
  assert.equal(prefixo.json.length, 0);
});

test('busca manual encontra por palavras parciais: "desinf lav"', async () => {
  const r = await manual('desinf lav');
  const nomes = r.map((p) => p.name);
  assert.ok(nomes.includes('DESINFETANTE LAVANDA 5L'), JSON.stringify(nomes));
  assert.ok(nomes.includes('DESINFETANTE LAVANDA 2L'));
  assert.ok(!nomes.includes('DESINFETANTE PINHO 5L'), 'pinho não tem "lav"');
});

test('busca manual por termo único: lavanda, desinfetante, 5l, deterg', async () => {
  const lavanda = (await manual('lavanda')).map((p) => p.name);
  assert.ok(lavanda.includes('DESINFETANTE LAVANDA 5L'));
  assert.ok(lavanda.includes('AMACIANTE LAVANDA 2L'));

  const desinfetante = (await manual('desinfetante')).map((p) => p.name);
  assert.equal(desinfetante.filter((n) => n.startsWith('DESINFETANTE')).length, 3);

  const cincoLitros = (await manual('5l')).map((p) => p.name);
  assert.ok(cincoLitros.includes('DESINFETANTE LAVANDA 5L'));
  assert.ok(cincoLitros.includes('DESINFETANTE PINHO 5L'));

  const deterg = (await manual('deterg')).map((p) => p.name);
  assert.equal(deterg.length, 2);
  assert.ok(deterg.every((n) => n.startsWith('DETERGENTE')));
});

test('busca manual ignora acentos e maiúsculas nos dois sentidos', async () => {
  const semAcento = (await manual('sabao maca')).map((p) => p.name);
  assert.ok(semAcento.includes('SABÃO EM PÓ MAÇÃ VERDE 1KG'), JSON.stringify(semAcento));

  const comAcento = (await manual('SABÃO')).map((p) => p.name);
  assert.ok(comAcento.includes('SABÃO EM PÓ MAÇÃ VERDE 1KG'));

  const agua = (await manual('agua sanitaria')).map((p) => p.name);
  assert.ok(agua.includes('ÁGUA SANITÁRIA 1L'));
});

test('busca manual também acha por código interno, código de barras e categoria', async () => {
  const porSku = await manual('AGUA-SAN-1L');
  assert.equal(porSku[0].id, ids.agua, 'código interno exato deve vir primeiro');

  const porBarras = await manual(COD_DESINF);
  assert.equal(porBarras[0].id, ids.desinf5l, 'código de barras exato deve vir primeiro');

  const porCategoria = (await manual('roupas')).map((p) => p.id);
  assert.ok(porCategoria.includes(ids.amaciante), 'categoria deve ser pesquisável');
});

test('busca manual prioriza o resultado mais próximo', async () => {
  const r = await manual('desinfetante lavanda 5l');
  assert.equal(r[0].name, 'DESINFETANTE LAVANDA 5L', JSON.stringify(r.map((p) => p.name)));

  const r2 = await manual('lavanda 2l');
  const nomes2 = r2.map((p) => p.name);
  assert.ok(['DESINFETANTE LAVANDA 2L', 'AMACIANTE LAVANDA 2L'].includes(nomes2[0]), JSON.stringify(nomes2));
});

test('busca manual traz os dados que a lista mostra: nome, código, preço e estoque', async () => {
  const [primeiro] = await manual('desinfetante lavanda 5l');
  assert.equal(typeof primeiro.name, 'string');
  assert.ok('sku' in primeiro && 'barcode' in primeiro);
  assert.equal(typeof primeiro.price_cents, 'number');
  assert.equal(typeof primeiro.stock_qty, 'number');
});

test('busca manual sem resultado devolve lista vazia, sem erro', async () => {
  const r = await manual('produto que nao existe xyz');
  assert.deepEqual(r, []);
  const vazio = await api('GET', '/api/products/busca-manual?q=');
  assert.equal(vazio.status, 200);
  assert.deepEqual(vazio.json, []);
});

test('busca antiga por ?q= continua funcionando (regressão)', async () => {
  const r = await api('GET', '/api/products?q=DESINFETANTE');
  assert.equal(r.status, 200);
  assert.equal(r.json.filter((p) => p.name.startsWith('DESINFETANTE')).length, 3);
});

test('buscar não altera estoque nem cria venda', async () => {
  const { getDb } = await import('./db/index.js');
  const estoqueAntes = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(ids.desinf5l).stock_qty;
  const vendasAntes = getDb().prepare('SELECT COUNT(*) AS c FROM sales').get().c;

  for (const termo of ['desinf lav', 'lavanda', 'sabao', COD_DESINF]) await manual(termo);
  for (let i = 0; i < 5; i += 1) await scanner(COD_DESINF);

  const estoqueDepois = getDb().prepare('SELECT stock_qty FROM products WHERE id=?').get(ids.desinf5l).stock_qty;
  const vendasDepois = getDb().prepare('SELECT COUNT(*) AS c FROM sales').get().c;
  assert.equal(estoqueDepois, estoqueAntes);
  assert.equal(vendasDepois, vendasAntes);
});
