import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-linux-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'linux.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { getDataDir, ensureDataDir, getConfigDir } = await import('./db/paths.js');
const require = createRequire(import.meta.url);
const cups = require('../../electron/cupsLinux.cjs');

let server;
let baseUrl;
let token;

async function api(method, path, body, auth = token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
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
  return { status: res.status, json };
}

before(async () => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  ensureBootstrapAdmin();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('paths Linux usam data dir gravável e configuracoes/', () => {
  const dir = ensureDataDir();
  assert.equal(dir, getDataDir());
  assert.ok(getConfigDir().endsWith('configuracoes'));
  assert.ok(!dir.includes('C:\\'));
});

test('safePrinterName rejeita injeção', () => {
  assert.equal(cups.safePrinterName('OK_Printer-1'), 'OK_Printer-1');
  assert.equal(cups.safePrinterName('bad;rm -rf /'), null);
  assert.equal(cups.safePrinterName('a b'), null);
  assert.equal(cups.safePrinterName(''), null);
});

test('cupsAvailable não trava sem CUPS', async () => {
  const res = await cups.cupsAvailable();
  assert.equal(typeof res.available, 'boolean');
  if (!res.available) {
    assert.ok(res.error);
    assert.ok(res.hint);
  }
});

test('diagnóstico support inclui bloco linux_print no Linux', async () => {
  const diag = await api('GET', '/api/support/diagnostics');
  assert.equal(diag.status, 200);
  assert.ok(diag.json.os);
  assert.equal(diag.json.os.platform, process.platform);
  if (process.platform === 'linux') {
    assert.ok(diag.json.linux_print);
    assert.equal(diag.json.linux_print.linux, true);
    assert.ok(diag.json.linux_print.cups);
  }
});
