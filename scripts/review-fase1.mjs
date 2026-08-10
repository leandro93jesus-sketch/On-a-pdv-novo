#!/usr/bin/env node
/**
 * Review Fase 1 — JSON import UX, printers settings, logo.
 * Timeout ≤ 3 min.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.PDV_API_URL || 'http://localhost:3001';
const DB = process.env.PDV_DB_PATH || resolve(root, 'server/data/onca-pdv.db');
const TIMEOUT_MS = Math.min(Number(process.env.E2E_TIMEOUT_MS || 180_000), 180_000);
const REQ_MS = 15_000;

const results = [];
let finished = false;
const watchdog = setTimeout(() => {
  if (!finished) {
    console.error('REVIEW FASE1 ABORT: timeout');
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
  record('mig-013', 'Migration 013 presente', existsSync(resolve(root, 'server/src/migrations/013_fase1_printers_logo.sql')));
  record('electron-ipc', 'IPC impressoras no Electron', readFileSync(resolve(root, 'electron/main.cjs'), 'utf8').includes('printers:list'));
  record('precheck', 'Precheck Fase1', existsSync(resolve(root, 'docs/reports/FASE1-PRECHECK.json')));

  const health = await req('GET', `${API}/api/health`);
  record('health', 'API health', health.status === 200);

  const login = await req('POST', `${API}/api/auth/login`, { login: 'admin', password: 'admin123' });
  record('login', 'Login', login.status === 200);
  const token = login.json?.token;

  const settings = await req('GET', `${API}/api/settings`);
  record('settings-logo', 'Bundle com logo', !!settings.json?.logo);
  record('settings-printers', 'Bundle com printers', !!settings.json?.printers);

  const printers = await req('PUT', `${API}/api/settings/printers`, {
    use_windows_default: true,
    profile: { format: 'A4', copies: 1, mode: 'manual', auto_print: false },
  }, token);
  record('printers-save', 'Salvar impressoras', printers.status === 200);

  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const logo = await req('POST', `${API}/api/settings/logo`, { filename: 'review.png', content_base64: png }, token);
  record('logo-upload', 'Upload logo', logo.status === 201 && logo.json?.has_logo);
  const logoGet = await req('GET', `${API}/api/settings/logo`);
  record('logo-get', 'GET logo', logoGet.status === 200);

  const fixture = resolve(root, 'server/test/fixtures/legacy-json/money-formats.json');
  const preview = await req(
    'POST',
    `${API}/api/imports/preview`,
    { filename: 'money-formats.json', content_base64: readFileSync(fixture).toString('base64') },
    token
  );
  record(
    'json-preview',
    'Preview JSON com SHA/prechecks',
    preview.status === 201 &&
      !!preview.json?.sha256 &&
      preview.json?.prechecks?.integrity_check === 'ok'
  );

  const db = new Database(DB);
  db.pragma('foreign_keys = ON');
  record('integrity', 'integrity_check', db.pragma('integrity_check')[0].integrity_check === 'ok');
  record('fk', 'foreign_key_check', db.pragma('foreign_key_check').length === 0);
  const legacy = db.prepare(`SELECT COUNT(*) c FROM sales WHERE legacy_source='oncas_pdv_v2'`).get().c;
  record('data', 'Vendas legacy preservadas', legacy >= 87, String(legacy));
  db.close();

  // cleanup logo de review no banco real? remove via API
  await req('DELETE', `${API}/api/settings/logo`, null, token);

  finished = true;
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) process.exit(1);
  console.log('REVIEW FASE 1: OK');
}

main().catch((e) => {
  finished = true;
  clearTimeout(watchdog);
  console.error(e);
  process.exit(1);
});
