#!/usr/bin/env node
/**
 * Review Fase 2 — duplicados, mesclagem, estoque, histórico.
 * Timeout ≤ 3 min.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

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
    console.error('REVIEW FASE2 ABORT: timeout');
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
  record('mig-014', 'Migration 014 presente', existsSync(resolve(root, 'server/src/migrations/014_fase2_duplicates_stock.sql')));
  record('precheck', 'Precheck Fase2', existsSync(resolve(root, 'docs/reports/FASE2-PRECHECK.json')));

  const health = await req('GET', `${API}/api/health`);
  record('health', 'API health', health.status === 200);

  const login = await req('POST', `${API}/api/auth/login`, { login: 'admin', password: 'admin123' });
  record('login', 'Login', login.status === 200);
  const token = login.json?.token;

  const stamp = Date.now();
  const a = await req('POST', `${API}/api/products`, {
    name: `Review Detergente ${stamp}`,
    barcode: `7911${String(stamp).slice(-9)}`,
    price_cents: 100,
    stock_qty: 10,
  }, token);
  record('product-a', 'Criar produto A', a.status === 201, String(a.json?.id));

  const similar = await req('POST', `${API}/api/products`, {
    name: `REVIEW DETERGENTE ${stamp}`,
    barcode: `7912${String(stamp).slice(-9)}`,
    price_cents: 110,
  }, token);
  record('similar-block', 'Bloqueia nome semelhante', similar.status === 409 && similar.json?.code === 'SIMILAR_NAME');

  const b = await req('POST', `${API}/api/products`, {
    name: `REVIEW DETERGENTE ${stamp}`,
    barcode: `7912${String(stamp).slice(-9)}`,
    price_cents: 110,
    stock_qty: 4,
    confirm_similar_name: true,
  }, token);
  record('product-b', 'Criar produto B com confirmação', b.status === 201);

  const dups = await req('GET', `${API}/api/products/duplicates`, null, token);
  record('duplicates', 'Listar duplicados', dups.status === 200 && Array.isArray(dups.json?.candidates));

  const setBal = await req('POST', `${API}/api/stock/set-balance`, {
    product_id: a.json?.id,
    new_qty: 8,
    reason: 'Review inventário',
  }, token);
  record('set-balance', 'Definir saldo', setBal.status === 201 && setBal.json?.stock_after === 8 && setBal.json?.quantity_delta === -2);

  const hist = await req('GET', `${API}/api/products/${a.json?.id}/history`, null, token);
  record('history', 'Histórico do produto', hist.status === 200 && Array.isArray(hist.json?.movements));

  const mergePrev = await req(
    'GET',
    `${API}/api/products/merge/preview?primary_id=${a.json?.id}&secondary_id=${b.json?.id}`,
    null,
    token
  );
  record('merge-preview', 'Prévia mesclagem', mergePrev.status === 200);

  const merge = await req('POST', `${API}/api/products/merge`, {
    primary_id: a.json?.id,
    secondary_id: b.json?.id,
    stock_rule: 'sum',
    confirm: true,
  }, token);
  record('merge', 'Mesclar produtos', merge.status === 201, `stock=${merge.json?.stock_after}`);

  const db = new Database(DB);
  db.pragma('foreign_keys = ON');
  record('integrity', 'integrity_check', db.pragma('integrity_check')[0].integrity_check === 'ok');
  record('fk', 'foreign_key_check', db.pragma('foreign_key_check').length === 0);
  const legacy = db.prepare(`SELECT COUNT(*) c FROM sales WHERE legacy_source='oncas_pdv_v2'`).get().c;
  record('data', 'Vendas legacy preservadas', legacy >= 87, String(legacy));
  const mig = db.prepare(`SELECT 1 FROM schema_migrations WHERE name='014_fase2_duplicates_stock.sql'`).get();
  record('mig-applied', 'Migration 014 aplicada', !!mig);
  db.close();

  finished = true;
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) process.exit(1);
  console.log('REVIEW FASE 2: OK');
}

main().catch((e) => {
  finished = true;
  clearTimeout(watchdog);
  console.error(e);
  process.exit(1);
});
