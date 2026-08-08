#!/usr/bin/env node
/**
 * E2E UI smoke simplificado (Chrome headless) — Etapa 3.
 * Timeout global máximo: 5 minutos. Aborta sozinho se travar.
 * Estratégia enxuta: dump-dom em todas as rotas + 1 screenshot representativo.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const WEB = process.env.PDV_WEB_URL || 'http://localhost:5173';
const TIMEOUT_MS = Math.min(Number(process.env.E2E_UI_TIMEOUT_MS || 300_000), 300_000);
const PER_ROUTE_MS = Number(process.env.E2E_UI_ROUTE_MS || 35_000);
const ARTIFACT_DIR = process.env.E2E_UI_ARTIFACT_DIR || '/opt/cursor/artifacts/screenshots';

const ROUTES = [
  { path: '/fornecedores', expect: [/Fornecedores/i, /Novo fornecedor/i] },
  { path: '/compras', expect: [/Compras/i, /Nova compra|Compra/i] },
  { path: '/crediario', expect: [/Crediário|Crediario/i] },
  { path: '/devolucoes', expect: [/Devoluç/i] },
  { path: '/entregas', expect: [/Entregas/i] },
  { path: '/vendas', expect: [/Vendas|ONÇA/i] },
];

const results = [];
const started = Date.now();
const work = mkdtempSync(join(tmpdir(), 'onca-e2e-ui-'));

function record(id, ok, detail = '') {
  results.push({ id, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}${detail ? ` — ${detail}` : ''}`);
}

function remainingBudget() {
  return TIMEOUT_MS - (Date.now() - started);
}

function runTimedChrome(args, maxMs) {
  const profile = join(work, `p-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(profile, { recursive: true });
  const sec = Math.max(5, Math.ceil(maxMs / 1000));
  return spawnSync(
    'timeout',
    [
      `${sec}s`,
      'google-chrome',
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=10000',
      ...args,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: maxMs + 2500,
    }
  );
}

function finish(code) {
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const failed = results.filter((r) => !r.ok);
  const summary = {
    total: results.length,
    pass: results.length - failed.length,
    fail: failed.length,
    elapsed_ms: Date.now() - started,
    failed: failed.map((f) => ({ id: f.id, detail: f.detail })),
  };
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(join(ARTIFACT_DIR, 'etapa3-ui-e2e-summary.json'), JSON.stringify(summary, null, 2));
  console.log('---');
  console.log(`Elapsed: ${summary.elapsed_ms}ms | Total: ${summary.total} | PASS: ${summary.pass} | FAIL: ${summary.fail}`);
  if (failed.length) {
    for (const f of failed) console.log(` - ${f.id}: ${f.detail}`);
  } else {
    console.log('E2E UI ETAPA 3: OK (finalizado dentro do timeout)');
  }
  process.exit(code ?? (failed.length ? 1 : 0));
}

mkdirSync(ARTIFACT_DIR, { recursive: true });
console.log(`E2E UI Etapa 3 | WEB=${WEB}`);
console.log(`Timeout global: ${TIMEOUT_MS}ms | por rota: ${PER_ROUTE_MS}ms`);

for (const route of ROUTES) {
  const budget = remainingBudget();
  if (budget < 6_000) {
    record(`dom-${route.path}`, false, 'abortado: timeout global');
    console.error(`E2E UI ABORT: timeout global ${TIMEOUT_MS}ms — teste interrompido`);
    finish(1);
  }

  const url = `${WEB}${route.path}`;
  const routeMs = Math.min(PER_ROUTE_MS, Math.max(6_000, budget - 20_000));
  const result = runTimedChrome(['--dump-dom', url], routeMs);
  const html = result.stdout || '';
  const dumpFile = join(work, `${route.path.replace(/^\//, '')}.html`);
  writeFileSync(dumpFile, html);
  const ok =
    html.length > 500 &&
    /ONÇA/i.test(html) &&
    route.expect.every((re) => re.test(html));
  record(
    `dom-${route.path}`,
    ok,
    ok
      ? `bytes=${html.length}`
      : result.error?.message || (result.status === 124 ? 'timeout' : `status=${result.status} bytes=${html.length}`)
  );
}

// Screenshot representativo (não bloqueia se o budget estiver curto)
const shotBudget = Math.min(35_000, remainingBudget() - 2_000);
const shot = join(ARTIFACT_DIR, 'etapa3-ui-fornecedores.png');
if (shotBudget >= 8_000) {
  const shotRes = runTimedChrome(
    [`--screenshot=${shot}`, '--window-size=1280,800', `${WEB}/fornecedores`],
    shotBudget
  );
  const shotOk = existsSync(shot);
  record('shot-/fornecedores', shotOk, shotOk ? shot : `status=${shotRes.status}`);
} else {
  record('shot-/fornecedores', false, 'budget insuficiente — screenshot omitido');
}

if (Date.now() - started > TIMEOUT_MS) {
  console.error(`E2E UI ABORT: timeout global ${TIMEOUT_MS}ms excedido — teste interrompido`);
  finish(1);
}

finish(0);
