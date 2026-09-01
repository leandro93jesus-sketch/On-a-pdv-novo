import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'onca-pdv-f1-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DB_PATH = join(tmp, 'fase1.db');
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb, getDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');
const { saveLogoFromBase64, getLogoMeta, removeLogo, readLogoBuffer } = await import(
  './services/logoService.js'
);
const { updatePrinterSettings, getPrinterSettings } = await import(
  './services/printerSettingsService.js'
);
const { parseLegacyJsonBuffer, createPreviewRun, executeImport } = await import(
  './services/legacyImportService.js'
);

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
  return { status: res.status, json, text };
}

before(async () => {
  const db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  ensureBootstrapAdmin();
  const app = createApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
});

after(async () => {
  await new Promise((r) => server.close(r));
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  // keep DB between tests — isolation via unique barcodes
});

test('settings bundle inclui logo e printers', async () => {
  const res = await api('GET', '/api/settings', null, null);
  assert.equal(res.status, 200);
  assert.ok(res.json.printers);
  assert.ok('has_logo' in (res.json.logo || {}));
});

test('logo PNG salva, lê e remove de pasta persistente', () => {
  // 1x1 PNG
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const meta = saveLogoFromBase64({ filename: 'onca.png', content_base64: png, userName: 'test' });
  assert.equal(meta.has_logo, true);
  assert.ok(getLogoMeta().has_logo);
  assert.ok(readLogoBuffer()?.buffer?.length);
  assert.ok(existsSync(join(tmp, 'assets', 'brand', meta.filename)));
  removeLogo({ userName: 'test' });
  assert.equal(getLogoMeta().has_logo, false);
});

test('printer settings persistem formato e cópias', () => {
  updatePrinterSettings(
    {
      use_windows_default: false,
      receipt_printer: 'Recibo',
      reports_printer: 'Relatorios',
      default_printer: 'Geral',
      profile: { format: '80mm', copies: 2, auto_print: true, mode: 'auto' },
    },
    'admin'
  );
  const cfg = getPrinterSettings();
  assert.equal(cfg.use_windows_default, false);
  assert.equal(cfg.receipt_printer, 'Recibo');
  assert.equal(cfg.profile.format, '80mm');
  assert.equal(cfg.profile.copies, 2);
  assert.equal(cfg.profile.auto_print, true);
});

test('printer settings persistem método ESC/POS e corte', () => {
  updatePrinterSettings(
    {
      method: 'escpos',
      cut: true,
      tcp_host: '192.168.0.50',
      tcp_port: 9100,
      profile: { format: '58mm' },
    },
    'admin'
  );
  const cfg = getPrinterSettings();
  assert.equal(cfg.method, 'escpos');
  assert.equal(cfg.cut, true);
  assert.equal(cfg.tcp_host, '192.168.0.50');
  assert.equal(cfg.profile.format, '58mm');
});

test('preview JSON inclui sha256, prechecks e conflitos', () => {
  const sample = {
    version: 2,
    products: [{ id: 'p1', code: '7891234567890', name: 'Produto F1', price: 1.5, stock: 3 }],
    customers: [],
    sales: [],
    stockMovements: [],
  };
  const buf = Buffer.from(JSON.stringify(sample), 'utf8');
  const parsed = parseLegacyJsonBuffer(buf, { filename: 'f1.json' });
  const run = createPreviewRun(parsed, { createdBy: 'tester' });
  assert.ok(run.sha256);
  assert.equal(run.prechecks.integrity_check, 'ok');
  assert.ok(run.preview.counts);
  assert.ok(run.db_conflicts.totals);
});

test('API logo upload e printers', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await api('POST', '/api/settings/logo', {
    filename: 'loja.png',
    content_base64: png,
  });
  assert.equal(up.status, 201);
  assert.equal(up.json.has_logo, true);
  const img = await api('GET', '/api/settings/logo', null, null);
  assert.equal(img.status, 200);
  const pr = await api('PUT', '/api/settings/printers', {
    use_windows_default: true,
    profile: { format: 'A4', copies: 1, mode: 'manual' },
  });
  assert.equal(pr.status, 200);
  assert.equal(pr.json.use_windows_default, true);
});

test('import JSON rejeita confirm ausente e faz rollback em falha', () => {
  const sample = {
    products: [{ nome: 'X', preco: 10, estoque: 1, codigo: 'SKU-F1-RB' }],
    __force_fail: true,
  };
  // generic adapter path
  const buf = Buffer.from(JSON.stringify(sample), 'utf8');
  const parsed = parseLegacyJsonBuffer(buf, { filename: 'fail.json' });
  assert.throws(() => executeImport(parsed, { confirm: false }), /Confirmação/);
  const before = getDb().prepare('SELECT COUNT(*) c FROM products').get().c;
  assert.throws(() => executeImport(parsed, { confirm: true, createdBy: 't' }), /rollback/i);
  const after = getDb().prepare('SELECT COUNT(*) c FROM products').get().c;
  assert.equal(after, before);
});
