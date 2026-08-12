import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-backup-fix-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'onca-pdv.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { runMigrations } = await import('./db/migrate.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');

let server;
let baseUrl;
let token;

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

before(async () => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  runMigrations(db);
  ensureBootstrapAdmin();
  db.prepare(
    `INSERT INTO products (sku, barcode, name, category, price_cents, cost_cents, stock_qty, min_stock_qty, allow_negative_stock, active)
     VALUES ('P1', '111', 'Prod A', 'T', 100, 50, 3, 0, 0, 1)`
  ).run();
  db.prepare(
    `INSERT INTO customers (name, document, phone, whatsapp, address, address_number, neighborhood, city, state, zip_code, notes, active)
     VALUES ('Cliente A', null, null, null, null, null, null, null, null, null, null, 1)`
  ).run();

  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('active-db mostra caminho do banco em uso', async () => {
  const res = await api('GET', '/api/backups/active-db');
  assert.equal(res.status, 200);
  assert.equal(res.json.db_path, process.env.PDV_DB_PATH);
  assert.equal(res.json.counts.products, 1);
  assert.equal(res.json.counts.customers, 1);
});

test('upload registra backup e preview tem contagens', async () => {
  const created = await api('POST', '/api/backups', { notes: 'fonte' });
  assert.equal(created.status, 201);
  const src = created.json.filepath;
  const buf = readFileSync(src);
  const upload = await api('POST', '/api/backups/upload', {
    filename: 'copia-usuario.db',
    content_base64: buf.toString('base64'),
  });
  assert.equal(upload.status, 201);
  assert.equal(upload.json.registered, true);
  assert.equal(upload.json.detected_type, 'DB');
  assert.ok(upload.json.preview?.counts_in_backup);
  assert.equal(upload.json.preview.counts_in_backup.products, 1);

  const list = await api('GET', '/api/backups');
  assert.ok(list.json.some((b) => b.filepath === upload.json.filepath));
});

test('upload JSON na rota .db é rejeitado com erro claro', async () => {
  const res = await api('POST', '/api/backups/upload', {
    filename: 'antigo.json',
    content_base64: Buffer.from('{"products":[]}').toString('base64'),
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'WRONG_BACKUP_TYPE_JSON');
});

test('restore cria PRE-RESTAURACAO, verifica contagens e reabre mesmo DB', async () => {
  const b1 = await api('POST', '/api/backups', {});
  // altera banco atual
  getDb()
    .prepare(
      `INSERT INTO products (sku, barcode, name, category, price_cents, cost_cents, stock_qty, min_stock_qty, allow_negative_stock, active)
       VALUES ('P2', '222', 'Prod B', 'T', 200, 50, 1, 0, 0, 1)`
    )
    .run();
  assert.equal(
    getDb().prepare('SELECT COUNT(*) c FROM products').get().c,
    2
  );

  const preview = await api('POST', '/api/backups/restore/preview', {
    filepath: b1.json.filepath,
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.counts_in_backup.products, 1);
  assert.equal(preview.json.counts_current.products, 2);
  assert.equal(preview.json.destination_db, process.env.PDV_DB_PATH);

  const restored = await api('POST', '/api/backups/restore', {
    filepath: b1.json.filepath,
    confirm: true,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.json.ok, true);
  assert.equal(restored.json.verified, true);
  assert.ok(String(restored.json.safety_backup.filename).startsWith('PRE-RESTAURACAO-'));
  assert.ok(existsSync(restored.json.safety_backup.filepath));
  assert.equal(restored.json.counts_after.products, 1);
  assert.equal(restored.json.counts_after.customers, 1);
  assert.equal(restored.json.destination_db, process.env.PDV_DB_PATH);
  assert.equal(restored.json.active_db_after, process.env.PDV_DB_PATH);

  // re-login (sessões restauradas)
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
  const active = await api('GET', '/api/backups/active-db');
  assert.equal(active.json.counts.products, 1);
});

test('lista inclui arquivos .db da pasta mesmo sem history', async () => {
  const orphan = join(tmp, 'backups', 'orphan-manual.db');
  copyFileSync(process.env.PDV_DB_PATH, orphan);
  const list = await api('GET', '/api/backups');
  assert.ok(list.json.some((b) => b.filepath === orphan || b.filename === 'orphan-manual.db'));
});
