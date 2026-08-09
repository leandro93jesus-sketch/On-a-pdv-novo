#!/usr/bin/env node
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
    console.error('REVIEW FASE3 ABORT: timeout');
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
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  record('mig', 'Migration 015 presente', existsSync(resolve(root, 'server/src/migrations/015_fase3_sale_change.sql')));
  record('ui-mixed', 'Modal misto no frontend', existsSync(resolve(root, 'web/src/modules/vendas/MixedPaymentModal.tsx')));
  record('ui-hist', 'Modal histórico no frontend', existsSync(resolve(root, 'web/src/modules/vendas/SalesHistoryModal.tsx')));

  const health = await req('GET', `${API}/api/health`);
  record('health', 'API health', health.status === 200);
  const login = await req('POST', `${API}/api/auth/login`, { login: 'admin', password: 'admin123' });
  const token = login.json?.token;
  record('login', 'Login', login.status === 200);

  let cash = await req('GET', `${API}/api/cash/sessions/current`, null, token);
  if (!cash.json) {
    cash = await req('POST', `${API}/api/cash/sessions/open`, { operator_name: 'Review F3', opening_amount_cents: 0 }, token);
  }
  record('cash', 'Caixa aberto', cash.status === 200 || cash.status === 201);

  const stamp = Date.now();
  const p = await req('POST', `${API}/api/products`, {
    name: `Review F3 Prod ${stamp}`,
    barcode: `794${String(stamp).slice(-10)}`,
    price_cents: 1000,
    stock_qty: 20,
    confirm_similar_name: true,
  }, token);
  record('product', 'Produto review', p.status === 201);

  const mix = await req('POST', `${API}/api/sales`, {
    client_request_id: `review-f3-${stamp}`,
    payments: [
      { method: 'dinheiro', amount_cents: 400 },
      { method: 'pix', amount_cents: 300 },
      { method: 'cartao', amount_cents: 300 },
    ],
    amount_received_cents: 500,
    items: [{ product_id: p.json?.id, quantity: 1 }],
  }, token);
  record('mixed', 'Venda mista 3 formas', mix.status === 201 && mix.json?.payment_method === 'misto' && mix.json?.change_cents === 100);

  const over = await req('POST', `${API}/api/sales`, {
    client_request_id: `review-f3-over-${stamp}`,
    payments: [
      { method: 'pix', amount_cents: 600 },
      { method: 'cartao', amount_cents: 600 },
    ],
    items: [{ product_id: p.json?.id, quantity: 1 }],
  }, token);
  record('overpay', 'Bloqueia soma maior', over.status === 400 && over.json?.code === 'PAYMENT_OVERPAID');

  const hist = await req('GET', `${API}/api/sales?period=today&payment_method=misto`, null, token);
  record('history', 'Histórico filtrado misto', hist.status === 200 && Array.isArray(hist.json));

  const db = new Database(DB);
  db.pragma('foreign_keys = ON');
  record('integrity', 'integrity_check', db.pragma('integrity_check')[0].integrity_check === 'ok');
  record('fk', 'foreign_key_check', db.pragma('foreign_key_check').length === 0);
  record('legacy', 'Legacy sales', db.prepare(`SELECT COUNT(*) c FROM sales WHERE legacy_source='oncas_pdv_v2'`).get().c >= 87);
  db.close();

  finished = true;
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) process.exit(1);
  console.log('REVIEW FASE 3: OK');
}

main().catch((e) => {
  finished = true;
  clearTimeout(watchdog);
  console.error(e);
  process.exit(1);
});
