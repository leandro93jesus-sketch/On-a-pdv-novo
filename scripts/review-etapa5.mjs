#!/usr/bin/env node
/**
 * Review Etapa 5 — versão, paths, auth bootstrap, integridade, artefatos desktop.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.PDV_API_URL || 'http://localhost:3001';
const DB =
  process.env.PDV_DB_PATH || resolve(root, 'server/data/onca-pdv.db');
const REQ_MS = 15_000;
const TIMEOUT_MS = Math.min(Number(process.env.E2E_TIMEOUT_MS || 180_000), 180_000);

const results = [];
let finished = false;
const watchdog = setTimeout(() => {
  if (!finished) {
    console.error(`REVIEW ABORT: timeout ${TIMEOUT_MS}ms`);
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
  const versionJs = readFileSync(resolve(root, 'server/src/version.js'), 'utf8');
  record('version-file', 'APP_VERSION 1.0.0', versionJs.includes("APP_VERSION = '1.0.0'"));

  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  record('pkg-version', 'package.json 1.0.0', pkg.version === '1.0.0');

  record('electron-main', 'electron/main.cjs', existsSync(resolve(root, 'electron/main.cjs')));
  record('electron-builder', 'electron-builder.yml', existsSync(resolve(root, 'electron-builder.yml')));
  record('release-readme', 'release/README.md', existsSync(resolve(root, 'release/README.md')));
  record('desktop-docs', 'docs/DESKTOP-WINDOWS.md', existsSync(resolve(root, 'docs/DESKTOP-WINDOWS.md')));
  record(
    'win7-doc',
    'Windows 7 não declarado como suportado',
    readFileSync(resolve(root, 'docs/DESKTOP-WINDOWS.md'), 'utf8').includes('não suportado')
  );

  const health = await req('GET', `${API}/api/health`);
  record(
    'health',
    'Health versão',
    health.status === 200 && health.json?.version === '1.0.0',
    JSON.stringify(health.json || {})
  );

  const login = await req('POST', `${API}/api/auth/login`, { login: 'admin', password: 'admin123' });
  record('login', 'Login', login.status === 200);
  record(
    'force-password',
    'must_change_password ativo no bootstrap',
    Number(login.json?.user?.must_change_password) === 1
  );

  const db = new Database(DB);
  db.pragma('foreign_keys = ON');
  record('integrity', 'integrity_check', db.pragma('integrity_check')[0].integrity_check === 'ok');
  record('fk', 'foreign_key_check', db.pragma('foreign_key_check').length === 0);
  const products = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  const customers = db.prepare('SELECT COUNT(*) c FROM customers').get().c;
  const legacySales = db
    .prepare(`SELECT COUNT(*) c FROM sales WHERE legacy_source='oncas_pdv_v2'`)
    .get().c;
  record(
    'real-data',
    'Dados migrados preservados',
    products >= 488 && customers >= 7 && legacySales >= 87,
    JSON.stringify({ products, customers, legacySales })
  );
  const admin = db.prepare(`SELECT password_hash, password_salt FROM users WHERE login='admin'`).get();
  record(
    'no-plaintext-password',
    'Senha não é texto puro',
    !!admin?.password_hash && admin.password_hash !== 'admin123'
  );
  db.close();

  finished = true;
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) process.exit(1);
  console.log('REVIEW ETAPA 5: OK');
}

main().catch((e) => {
  finished = true;
  clearTimeout(watchdog);
  console.error(e);
  process.exit(1);
});
