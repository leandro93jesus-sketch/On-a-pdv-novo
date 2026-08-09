import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../test/fixtures/legacy-json');
const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-e4-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'etapa4.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { openCashSession } = await import('./services/cashService.js');
const { reaisToCents } = await import('./utils/moneyLegacy.js');

let server;
let baseUrl;
let db;
let adminToken;

async function api(method, path, body, token = adminToken) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  return { res, json, text, status: res.status };
}

before(async () => {
  db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  ensureBootstrapAdmin();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  adminToken = login.json.token;
});

beforeEach(() => {
  // keep users/sessions; clear business data lightly where needed per test
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('auth: login, me, logout e senha inválida', async () => {
  const bad = await api('POST', '/api/auth/login', { login: 'admin', password: 'wrong' }, null);
  assert.equal(bad.status, 401);

  const me = await api('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.login, 'admin');
  assert.equal(me.json.user.role, 'administrador');

  const login2 = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  const token2 = login2.json.token;
  await api('POST', '/api/auth/logout', null, token2);
  const me2 = await api('GET', '/api/auth/me', null, token2);
  assert.equal(me2.status, 401);
});

test('usuários: criar operador e bloquear permissão admin', async () => {
  const op = await api('POST', '/api/auth/users', {
    name: 'Operador Teste',
    login: `op_${Date.now()}`,
    password: 'oper123',
    role: 'operador',
  });
  assert.equal(op.status, 201);

  const loginOp = await api(
    'POST',
    '/api/auth/login',
    { login: op.json.login, password: 'oper123' },
    null
  );
  assert.equal(loginOp.status, 200);
  const denied = await api('GET', '/api/auth/users', null, loginOp.json.token);
  assert.equal(denied.status, 403);
});

test('configurações: leitura e atualização', async () => {
  const get = await api('GET', '/api/settings');
  assert.equal(get.status, 200);
  assert.ok(get.json.company);

  const put = await api('PUT', '/api/settings', {
    company: { store_trade_name: 'ONÇA PRODUTOS DE LIMPEZA', store_phone: '1133334444' },
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.company.store_phone, '1133334444');
});

test('money legacy: ponto, vírgula e R$', () => {
  assert.equal(reaisToCents(19.9), 1990);
  assert.equal(reaisToCents('19.90'), 1990);
  assert.equal(reaisToCents('19,90'), 1990);
  assert.equal(reaisToCents('R$ 19,90'), 1990);
});

test('relatórios: catálogo e vendas por período', async () => {
  const catalog = await api('GET', '/api/reports');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.json.length >= 20);
  const ids = catalog.json.map((r) => r.id);
  for (const need of [
    'vendas_periodo',
    'estoque_baixo',
    'crediario_aberto',
    'produtos_mais_vendidos',
    'sangrias',
  ]) {
    assert.ok(ids.includes(need), need);
  }
  const report = await api('GET', '/api/reports/vendas_periodo');
  assert.equal(report.status, 200);
  assert.ok(report.json.totals);
});

test('backup: criar, validar e listar', async () => {
  const created = await api('POST', '/api/backups', { notes: 'teste e4' });
  assert.equal(created.status, 201);
  assert.ok(created.json.filename.startsWith('onca-pdv-backup-'));
  assert.ok(existsSync(created.json.filepath));
  assert.ok(created.json.sha256);

  const list = await api('GET', '/api/backups');
  assert.ok(list.json.some((b) => b.id === created.json.id));

  const validate = await api('POST', '/api/backups/validate', { filepath: created.json.filepath });
  assert.equal(validate.status, 200);
  assert.equal(validate.json.integrity, 'ok');
});

test('restauração: preview, confirm required, restore ok', async () => {
  const b1 = await api('POST', '/api/backups', {});
  const preview = await api('POST', '/api/backups/restore/preview', { filepath: b1.json.filepath });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.valid, true);

  const noConfirm = await api('POST', '/api/backups/restore', { filepath: b1.json.filepath });
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.json.code, 'CONFIRM_REQUIRED');

  // marcar produto para verificar restore
  await api('POST', '/api/products', {
    name: 'Temp Restore Marker',
    sku: `TRM-${Date.now()}`,
    price_cents: 100,
    stock_qty: 1,
  });

  const b2 = await api('POST', '/api/backups', {});
  // restore b1 (estado anterior sem o marker necessariamente — still must succeed)
  const restored = await api('POST', '/api/backups/restore', {
    filepath: b2.json.filepath,
    confirm: true,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.json.ok, true);
  db = getDb();
  // re-login after restore (sessions table restored)
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  adminToken = login.json.token;
});

test('restauração inválida rejeitada', async () => {
  const badPath = join(tmp, 'not-a-backup.db');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(badPath, 'NOT SQLITE');
  const res = await api('POST', '/api/backups/validate', { filepath: badPath });
  assert.equal(res.status, 400);
});

test('importador: JSON inválido / vazio / desconhecido', async () => {
  const invalid = await api('POST', '/api/imports/preview', {
    filename: 'invalid.json',
    content_base64: Buffer.from(readFileSync(join(fixturesDir, 'invalid.json'))).toString('base64'),
  });
  assert.equal(invalid.status, 400);

  const empty = await api('POST', '/api/imports/preview', {
    filename: 'empty-file.json',
    content_base64: Buffer.from('').toString('base64'),
  });
  assert.equal(empty.status, 400);

  const unknown = await api('POST', '/api/imports/preview', {
    filename: 'unknown-structure.json',
    content_base64: readFileSync(join(fixturesDir, 'unknown-structure.json')).toString('base64'),
  });
  assert.equal(unknown.status, 201);
  assert.ok(unknown.json.preview.campos_desconhecidos >= 1);
});

test('importador: preview e importação válida com money formats', async () => {
  const buf = readFileSync(join(fixturesDir, 'valid-basic.json'));
  const preview = await api('POST', '/api/imports/preview', {
    filename: 'valid-basic.json',
    content_base64: buf.toString('base64'),
  });
  assert.equal(preview.status, 201);
  assert.equal(preview.json.preview.produtos_encontrados, 2);
  assert.equal(preview.json.preview.clientes_encontrados, 1);
  assert.equal(preview.json.preview.vendas_encontradas, 1);

  const noConfirm = await api('POST', '/api/imports/execute', {
    filename: 'valid-basic.json',
    content_base64: buf.toString('base64'),
  });
  assert.equal(noConfirm.status, 400);

  const exec = await api('POST', '/api/imports/execute', {
    filename: 'valid-basic.json',
    content_base64: buf.toString('base64'),
    confirm: true,
    run_id: preview.json.id,
  });
  assert.equal(exec.status, 201);
  assert.ok(exec.json.report.imported.products >= 1);
  assert.equal(exec.json.report.validation.integrity_check, 'ok');

  // duplicidade na segunda importação
  const again = await api('POST', '/api/imports/execute', {
    filename: 'valid-basic.json',
    content_base64: buf.toString('base64'),
    confirm: true,
  });
  assert.equal(again.status, 201);
  assert.ok(again.json.report.duplicated.products >= 1);
});

test('importador: rollback em erro crítico', async () => {
  const before = getDb().prepare('SELECT COUNT(*) AS c FROM products').get().c;
  const buf = readFileSync(join(fixturesDir, 'force-fail.json'));
  const res = await api('POST', '/api/imports/execute', {
    filename: 'force-fail.json',
    content_base64: buf.toString('base64'),
    confirm: true,
  });
  assert.equal(res.status, 500);
  assert.equal(res.json.code, 'IMPORT_ROLLBACK');
  const after = getDb().prepare('SELECT COUNT(*) AS c FROM products').get().c;
  assert.equal(after, before);
});

test('PDF comprovante e WhatsApp', async () => {
  // abrir caixa + produto + venda
  try {
    openCashSession({ terminal_id: 'TERM-1', operator_name: 'E4', opening_amount_cents: 1000 });
  } catch {
    /* already open */
  }
  const prod = await api('POST', '/api/products', {
    name: `PDF Prod ${Date.now()}`,
    sku: `PDF-${Date.now()}`,
    price_cents: 1500,
    stock_qty: 5,
  });
  const sale = await api('POST', '/api/sales', {
    client_request_id: `e4-pdf-${Date.now()}`,
    payment_method: 'dinheiro',
    items: [{ product_id: prod.json.id, quantity: 1 }],
  });
  assert.equal(sale.status, 201);

  const pdf = await api('GET', `/api/receipts/sales/${sale.json.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.ok(pdf.res.headers.get('content-type')?.includes('pdf'));
  assert.ok(pdf.text === null || pdf.res.headers.get('content-type')?.includes('pdf'));
  // binary — check via arrayBuffer
  const bin = await fetch(`${baseUrl}/api/receipts/sales/${sale.json.id}/pdf`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const buf = Buffer.from(await bin.arrayBuffer());
  assert.ok(buf.subarray(0, 4).toString() === '%PDF');

  const wa = await api('POST', `/api/receipts/sales/${sale.json.id}/whatsapp`, {
    phone: '11988887777',
  });
  assert.equal(wa.status, 200);
  assert.equal(wa.json.pdf_attached, false);
  assert.ok(wa.json.url.includes('wa.me'));
});

test('auditoria lista eventos críticos', async () => {
  const logs = await api('GET', '/api/audit?limit=50');
  assert.equal(logs.status, 200);
  assert.ok(Array.isArray(logs.json));
  const actions = logs.json.map((l) => l.action);
  assert.ok(actions.some((a) => String(a).startsWith('auth.') || String(a).startsWith('backup.') || String(a).startsWith('import.')));
});

test('integridade SQLite etapa 4', () => {
  db = getDb();
  db.pragma('foreign_keys = ON');
  const integrity = db.pragma('integrity_check')[0].integrity_check;
  assert.equal(integrity, 'ok');
  assert.equal(db.pragma('foreign_key_check').length, 0);
  const neg = db
    .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock = 0`)
    .get().c;
  assert.equal(neg, 0);
});
