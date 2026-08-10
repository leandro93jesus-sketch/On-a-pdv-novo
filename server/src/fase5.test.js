import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-f5-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'fase5.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { exportDatasetCsv } = await import('./services/exportService.js');
const { buildDiagnosticReport } = await import('./services/supportService.js');

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
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

before(async () => {
  setDb(openDatabase(process.env.PDV_DB_PATH));
  ensureBootstrapAdmin();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  token = (await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null)).json.token;
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

test('exporta produtos CSV', () => {
  const file = exportDatasetCsv('products');
  assert.ok(file.filename.endsWith('.csv'));
  assert.ok(file.content.includes('name') || file.content.includes('id'));
});

test('diagnóstico sem senhas', async () => {
  const report = await buildDiagnosticReport();
  assert.ok(report.app_version);
  assert.ok(report.db_path);
  assert.equal(report.integrity_check, 'ok');
  const blob = JSON.stringify(report);
  assert.ok(!/password_hash/i.test(blob));
  assert.ok(!/password_salt/i.test(blob));
  assert.ok(report.os?.platform);
});

test('API export e support', async () => {
  const exp = await api('POST', '/api/export/customers');
  assert.equal(exp.status, 200);
  assert.ok(exp.json.content.includes(','));
  const diag = await api('GET', '/api/support/diagnostics');
  assert.equal(diag.status, 200);
  assert.ok(diag.json.db_path);
});
