#!/usr/bin/env node
/**
 * Revisão Etapa 4 — auth, settings, reports, backup, import, PDF, WhatsApp, audit.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const BASE = process.env.PDV_API_URL || 'http://localhost:3001';
const DB_PATH =
  process.env.PDV_DB_PATH ||
  resolve(dirname(fileURLToPath(import.meta.url)), '../server/data/onca-pdv.db');

const results = [];
function record(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}. ${title}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  console.log(`API: ${BASE}`);
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' });
  record(1, 'Login admin', login.status === 200 && !!login.json?.token);
  const token = login.json?.token;

  const me = await api('GET', '/api/auth/me', null, token);
  record(2, 'Sessão /me', me.status === 200 && me.json?.user?.role === 'administrador');

  const settings = await api('PUT', '/api/settings', {
    company: { store_trade_name: 'ONÇA PRODUTOS DE LIMPEZA' },
  }, token);
  record(3, 'Configurações', settings.status === 200);

  const reports = await api('GET', '/api/reports', null, token);
  record(4, 'Catálogo de relatórios', reports.status === 200 && reports.json?.length >= 20);

  const run = await api('GET', '/api/reports/estoque_atual', null, token);
  record(5, 'Relatório estoque atual', run.status === 200 && !!run.json?.totals);

  const backup = await api('POST', '/api/backups', { notes: 'review e4' }, token);
  record(6, 'Criar backup', backup.status === 201 && existsSync(backup.json?.filepath || ''));

  const preview = await api('POST', '/api/backups/restore/preview', { filepath: backup.json.filepath }, token);
  record(7, 'Preview restauração', preview.status === 200 && preview.json?.valid);

  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../server/test/fixtures/legacy-json/valid-basic.json');
  const b64 = readFileSync(fixture).toString('base64');
  const impPrev = await api('POST', '/api/imports/preview', { filename: 'valid-basic.json', content_base64: b64 }, token);
  record(8, 'Preview importação JSON', impPrev.status === 201 && impPrev.json?.preview?.produtos_encontrados >= 1);

  // Não executa import destrutivo no DB de dev se já houver dados — apenas confirma preview
  record(9, 'Importador preparado (sem mapeamento real)', !!impPrev.json?.analysis);

  const audit = await api('GET', '/api/audit?limit=20', null, token);
  record(10, 'Auditoria', audit.status === 200 && Array.isArray(audit.json));

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  const integrity = db.pragma('integrity_check')[0].integrity_check;
  const neg = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock = 0`).get().c;
  record(11, 'Integridade SQLite', integrity === 'ok' && neg === 0 && db.pragma('foreign_key_check').length === 0);
  db.close();

  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) process.exit(1);
  console.log('REVISÃO ETAPA 4: OK');
  console.log('IMPORTADOR PREPARADO — AGUARDANDO BACKUP JSON REAL PARA MAPEAMENTO FINAL.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
