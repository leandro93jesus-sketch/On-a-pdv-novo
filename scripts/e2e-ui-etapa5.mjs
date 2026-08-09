#!/usr/bin/env node
/**
 * E2E UI Etapa 5 — Chrome headless com autenticação (localStorage same-origin).
 * Timeout global ≤ 5 min. Não espera indefinidamente.
 */
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const API = process.env.PDV_API_URL || 'http://localhost:3001';
const WEB = process.env.PDV_WEB_URL || 'http://localhost:5173';
const TIMEOUT_MS = Math.min(Number(process.env.E2E_UI_TIMEOUT_MS || 300_000), 300_000);
const PER_ROUTE_MS = Number(process.env.E2E_UI_ROUTE_MS || 18_000);
const ARTIFACT_DIR = process.env.E2E_UI_ARTIFACT_DIR || '/opt/cursor/artifacts/screenshots';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bootstrapPath = join(root, 'web', 'public', 'e2e-bootstrap.html');

const ROUTES = [
  { path: '/login', expect: [/ONÇA PDV/i, /Entrar|Usuário/i], auth: false },
  { path: '/vendas', expect: [/Vendas|Carrinho|Item Diversos/i], auth: true },
  { path: '/caixa', expect: [/Caixa|Abrir caixa|Totalizador/i], auth: true },
  { path: '/produtos', expect: [/Produtos/i], auth: true },
  { path: '/estoque', expect: [/Estoque/i], auth: true },
  { path: '/clientes', expect: [/Clientes/i], auth: true },
  { path: '/fornecedores', expect: [/Fornecedores/i], auth: true },
  { path: '/compras', expect: [/Compras/i], auth: true },
  { path: '/crediario', expect: [/Crediário|Crediario|Contas/i], auth: true },
  { path: '/devolucoes', expect: [/Devoluç/i], auth: true },
  { path: '/entregas', expect: [/Entregas/i], auth: true },
  { path: '/relatorios', expect: [/Relatório/i], auth: true },
  { path: '/backup', expect: [/Backup/i], auth: true },
  { path: '/configuracoes', expect: [/Configuraç|Usuários|Versão/i], auth: true },
];

const results = [];
const started = Date.now();
const work = mkdtempSync(join(tmpdir(), 'onca-e2e-ui5-'));
let sessionPayload = null;

function record(id, ok, detail = '') {
  results.push({ id, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}${detail ? ` — ${detail}` : ''}`);
}

function remaining() {
  return TIMEOUT_MS - (Date.now() - started);
}

async function apiLogin() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'admin123' }),
  });
  const json = await res.json();
  if (!res.ok || !json.token) throw new Error(`login falhou: ${res.status}`);
  // AuthGate usa must_change_password do localStorage — zera só no cliente do smoke UI
  const session = {
    token: json.token,
    user: { ...json.user, must_change_password: 0 },
  };
  sessionPayload = encodeURIComponent(JSON.stringify(session));
  return session;
}

function ensureBootstrap() {
  mkdirSync(dirname(bootstrapPath), { recursive: true });
  writeFileSync(
    bootstrapPath,
    `<!doctype html><meta charset="utf-8" /><title>E2E bootstrap</title>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var raw = q.get('s');
  var next = q.get('next') || '/vendas';
  if (!raw) { document.body.textContent = 'missing session'; return; }
  try {
    localStorage.setItem('onca_auth', decodeURIComponent(raw));
    location.replace(next);
  } catch (e) {
    document.body.textContent = String(e);
  }
})();
</script>`
  );
}

function runChrome(args, maxMs) {
  const profile = join(work, `p-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(profile, { recursive: true });
  const sec = Math.max(8, Math.ceil(maxMs / 1000));
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
      '--virtual-time-budget=5000',
      '--run-all-compositor-stages-before-draw',
      '--disable-background-networking',
      ...args,
    ],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: maxMs + 3000 }
  );
}

function finish(code) {
  try {
    if (existsSync(bootstrapPath)) unlinkSync(bootstrapPath);
  } catch {
    /* ignore */
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const failed = results.filter((r) => !r.ok);
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(
    join(ARTIFACT_DIR, 'etapa5-ui-e2e-summary.json'),
    JSON.stringify(
      {
        total: results.length,
        pass: results.length - failed.length,
        fail: failed.length,
        elapsed_ms: Date.now() - started,
        failed: failed.map((f) => ({ id: f.id, detail: f.detail })),
      },
      null,
      2
    )
  );
  console.log('---');
  console.log(
    `Elapsed: ${Date.now() - started}ms | Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`
  );
  process.exit(code ?? (failed.length ? 1 : 0));
}

const watchdog = setTimeout(() => {
  console.error(`E2E UI ABORT: timeout ${TIMEOUT_MS}ms`);
  finish(1);
}, TIMEOUT_MS);
watchdog.unref?.();

try {
  ensureBootstrap();
  await apiLogin();
  record('auth-api', true, 'token ok');

  for (const route of ROUTES) {
    if (remaining() < 8_000) {
      record(`dom-${route.path}`, false, 'budget global esgotado');
      break;
    }
    const routeMs = Math.min(PER_ROUTE_MS, Math.max(8_000, remaining() - 15_000));
    const url = route.auth
      ? `${WEB}/e2e-bootstrap.html?s=${sessionPayload}&next=${encodeURIComponent(route.path)}`
      : `${WEB}${route.path}`;
    const result = runChrome(['--dump-dom', url], routeMs);
    const html = result.stdout || '';
    const ok =
      html.length > 400 &&
      /ONÇA/i.test(html) &&
      route.expect.some((re) => re.test(html)) &&
      !(route.auth && /Trocar senha|Acesso ao sistema/i.test(html) && !route.expect.some((re) => re.test(html)));
    record(
      `dom-${route.path}`,
      ok,
      ok
        ? `bytes=${html.length}`
        : result.status === 124
          ? 'timeout'
          : `status=${result.status} bytes=${html.length}`
    );
  }

  const shotBudget = Math.min(40_000, remaining() - 2_000);
  const shot = join(ARTIFACT_DIR, 'etapa5-ui-vendas.png');
  if (shotBudget >= 10_000 && sessionPayload) {
    const shotRes = runChrome(
      [
        `--screenshot=${shot}`,
        '--window-size=1360,860',
        `${WEB}/e2e-bootstrap.html?s=${sessionPayload}&next=${encodeURIComponent('/vendas')}`,
      ],
      shotBudget
    );
    record('shot-/vendas', existsSync(shot), existsSync(shot) ? shot : `status=${shotRes.status}`);
  } else {
    record('shot-/vendas', false, 'budget insuficiente');
  }
} catch (e) {
  record('setup', false, e instanceof Error ? e.message : String(e));
} finally {
  clearTimeout(watchdog);
  finish();
}
