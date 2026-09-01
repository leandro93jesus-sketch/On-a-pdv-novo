#!/usr/bin/env node
/**
 * E2E Etapa 4 — timeout global ≤ 5 min.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const API = process.env.PDV_API_URL || 'http://localhost:3001';
const WEB = process.env.PDV_WEB_URL || 'http://localhost:5173';
const DB_PATH =
  process.env.PDV_DB_PATH ||
  resolve(dirname(fileURLToPath(import.meta.url)), '../server/data/onca-pdv.db');
const TIMEOUT_MS = Math.min(Number(process.env.E2E_TIMEOUT_MS || 300_000), 300_000);
const REQ_MS = Number(process.env.E2E_REQ_TIMEOUT_MS || 15_000);

const results = [];
let finished = false;
const watchdog = setTimeout(() => {
  if (!finished) {
    console.error(`E2E ABORT: timeout ${TIMEOUT_MS}ms`);
    process.exit(1);
  }
}, TIMEOUT_MS);
watchdog.unref?.();

function record(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}. ${title}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, url, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log(`E2E Etapa 4 | timeout=${TIMEOUT_MS}ms`);
  const health = await req('GET', `${API}/api/health`);
  record('health', 'API health', health.status === 200);

  const web = await req('GET', WEB);
  record('web', 'UI responde', web.status === 200 && web.text.includes('ONÇA'));

  const login = await req('POST', `${API}/api/auth/login`, { login: 'admin', password: 'admin123' });
  record('auth', 'Login', login.status === 200 && !!login.json?.token);
  const token = login.json?.token;

  for (const path of ['/login', '/relatorios', '/backup', '/configuracoes', '/vendas']) {
    const page = await req('GET', `${WEB}${path}`);
    record(`ui-${path}`, `UI ${path}`, page.status === 200);
  }

  const backup = await req('POST', `${API}/api/backups`, { notes: 'e2e e4' }, token);
  record('backup', 'Backup criado', backup.status === 201 && existsSync(backup.json?.filepath || ''));

  const reports = await req('GET', `${API}/api/reports/vendas_dia`, null, token);
  record('report', 'Relatório', reports.status === 200);

  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../server/test/fixtures/legacy-json/money-formats.json');
  const prev = await req(
    'POST',
    `${API}/api/imports/preview`,
    { filename: 'money-formats.json', content_base64: readFileSync(fixture).toString('base64') },
    token
  );
  record('import-preview', 'Preview import', prev.status === 201);

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  const ok =
    db.pragma('integrity_check')[0].integrity_check === 'ok' &&
    db.pragma('foreign_key_check').length === 0;
  record('sqlite', 'Integridade', ok);
  db.close();

  finished = true;
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) process.exit(1);
  console.log('E2E ETAPA 4: OK');
}

main().catch((e) => {
  finished = true;
  clearTimeout(watchdog);
  console.error(e);
  process.exit(1);
});
