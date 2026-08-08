#!/usr/bin/env node
/**
 * E2E final Etapa 5 — fluxo de balcão + checagens desktop/versão.
 * Timeout global rígido ≤ 5 min. Não espera indefinidamente.
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const API = process.env.PDV_API_URL || 'http://localhost:3001';
const WEB = process.env.PDV_WEB_URL || 'http://localhost:5173';
const DB_PATH =
  process.env.PDV_DB_PATH ||
  resolve(dirname(fileURLToPath(import.meta.url)), '../server/data/onca-pdv.db');
const TIMEOUT_MS = Math.min(Number(process.env.E2E_TIMEOUT_MS || 300_000), 300_000);
const REQ_MS = Number(process.env.E2E_REQ_TIMEOUT_MS || 15_000);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
  console.log(`E2E Etapa 5 | timeout=${TIMEOUT_MS}ms`);

  const health = await req('GET', `${API}/api/health`);
  record(
    'health',
    'API health + versão',
    health.status === 200 && health.json?.version === '1.0.0',
    JSON.stringify({ version: health.json?.version, status: health.status })
  );

  const web = await req('GET', WEB);
  record('web', 'UI responde ONÇA', web.status === 200 && /ONÇA/i.test(web.text || ''));

  const uiPaths = [
    '/login',
    '/vendas',
    '/caixa',
    '/produtos',
    '/estoque',
    '/clientes',
    '/fornecedores',
    '/compras',
    '/crediario',
    '/devolucoes',
    '/entregas',
    '/relatorios',
    '/backup',
    '/configuracoes',
  ];
  for (const path of uiPaths) {
    const page = await req('GET', `${WEB}${path}`);
    record(`ui-${path}`, `UI ${path}`, page.status === 200);
  }

  const login = await req('POST', `${API}/api/auth/login`, {
    login: 'admin',
    password: 'admin123',
  });
  record('auth', 'Login bootstrap', login.status === 200 && !!login.json?.token);
  const token = login.json?.token;
  record(
    'must-change',
    'Flag troca de senha',
    !!login.json?.user?.must_change_password || login.json?.user?.must_change_password === 1,
    String(login.json?.user?.must_change_password)
  );

  // Caixa: fechar se aberto e reabrir
  const open = await req('GET', `${API}/api/cash/sessions/current`, null, token);
  if (open.json?.id) {
    await req(
      'POST',
      `${API}/api/cash/sessions/close`,
      { counted_amount_cents: open.json.opening_amount_cents || 0 },
      token
    );
  }
  const opened = await req(
    'POST',
    `${API}/api/cash/sessions/open`,
    { operator_name: 'E2E Etapa5', opening_amount_cents: 10000 },
    token
  );
  record('cash-open', 'Abrir caixa', opened.status === 201 || opened.status === 200, String(opened.status));

  const products = await req('GET', `${API}/api/products?q=L-&limit=5`, null, token);
  const product = (products.json || []).find((p) => p.stock_qty > 0 && p.active !== 0) || products.json?.[0];
  record('product-real', 'Produto real localizado', !!product, product ? `${product.sku} ${product.name}` : '');

  const customers = await req('GET', `${API}/api/customers?limit=5`, null, token);
  const customer = customers.json?.[0];
  record('customer', 'Cliente real', !!customer, customer?.name || '');

  const stockBefore = product
    ? (
        await req('GET', `${API}/api/products/${product.id}`, null, token)
      ).json?.stock_qty
    : null;

  const saleBody = {
    customer_id: customer?.id || null,
    discount_cents: 0,
    payment_method: 'dinheiro',
    payments: [],
    notes: 'E2E Etapa5 venda completa',
    items: [
      {
        product_id: product.id,
        quantity: 1,
      },
      {
        is_misc: true,
        name: 'Item Diversos E2E',
        quantity: 2,
        unit_price_cents: 150,
      },
    ],
  };
  // total será calculado no server; payments filled after preview? server usually computes
  // Check sales API - may need payment amounts matching total
  const saleProbe = await req('POST', `${API}/api/sales`, saleBody, token);
  let sale = saleProbe.json;
  if (saleProbe.status >= 400) {
    // retry with explicit payments if needed
    const retry = await req(
      'POST',
      `${API}/api/sales`,
      {
        ...saleBody,
        payments: [{ method: 'dinheiro', amount_cents: (product.price_cents || 0) + 300 }],
      },
      token
    );
    sale = retry.json;
    record('sale', 'Finalizar venda', retry.status === 201 || retry.status === 200, String(retry.status));
  } else {
    record('sale', 'Finalizar venda', saleProbe.status === 201 || saleProbe.status === 200, String(saleProbe.status));
  }

  const saleId = sale?.id || sale?.sale?.id;
  const fullSale = saleId
    ? await req('GET', `${API}/api/sales/${saleId}`, null, token)
    : { status: 0, json: null };
  const items = fullSale.json?.items || [];
  record(
    'misc',
    'Item Diversos na venda',
    items.some((i) => i.is_misc === 1 || i.is_misc === true),
    items.map((i) => i.name).join('; ')
  );

  if (product && stockBefore != null) {
    const after = await req('GET', `${API}/api/products/${product.id}`, null, token);
    record(
      'stock',
      'Baixa estoque produto normal',
      after.json?.stock_qty === stockBefore - 1,
      `${stockBefore} → ${after.json?.stock_qty}`
    );
  }

  const sessionId = opened.json?.id;
  const conf = sessionId
    ? await req('GET', `${API}/api/cash/sessions/${sessionId}`, null, token)
    : await req('GET', `${API}/api/cash/sessions/current`, null, token);
  record(
    'cash-register',
    'Caixa registra venda',
    conf.status === 200 &&
      ((conf.json?.session?.sales_total_cents || conf.json?.sales_total_cents || 0) > 0 ||
        (conf.json?.breakdown?.sales_total_cents || 0) > 0),
    String(conf.status)
  );

  if (saleId) {
    const pdf = await req('GET', `${API}/api/receipts/sales/${saleId}/pdf`, null, token);
    record(
      'pdf',
      'PDF comprovante',
      pdf.status === 200 && (pdf.text?.startsWith('%PDF') || pdf.text?.includes('PDF')),
      String(pdf.status)
    );
    const wa = await req(
      'POST',
      `${API}/api/receipts/sales/${saleId}/whatsapp`,
      { phone: customer?.whatsapp || customer?.phone || '11999990000' },
      token
    );
    record(
      'whatsapp',
      'WhatsApp link',
      wa.status === 200 && !!wa.json?.url && wa.json?.pdf_attached === false,
      wa.json?.url ? 'url ok' : String(wa.status)
    );
  }

  const hist = await req('GET', `${API}/api/sales?limit=5`, null, token);
  record('history', 'Histórico vendas', hist.status === 200 && Array.isArray(hist.json));

  const report = await req('GET', `${API}/api/reports/vendas_dia`, null, token);
  record('report', 'Relatório vendas', report.status === 200);

  // Crediário: se houver conta, pagamento parcial; senão cria venda crediário se API permitir
  const creditSummary = await req('GET', `${API}/api/credit/summary`, null, token);
  record('credit-summary', 'Crediário summary', creditSummary.status === 200);

  let creditOk = false;
  if ((creditSummary.json?.open_accounts || creditSummary.json?.total_balance_cents || 0) > 0) {
    const accounts = await req('GET', `${API}/api/credit/accounts?status=open`, null, token);
    const acc = accounts.json?.[0];
    if (acc) {
      const pay = await req(
        'POST',
        `${API}/api/credit/payments`,
        {
          credit_account_id: acc.id,
          amount_cents: Math.min(100, acc.balance_cents || 100),
          method: 'dinheiro',
        },
        token
      );
      creditOk = pay.status === 201 || pay.status === 200;
    }
  } else if (product && customer) {
    const creditSale = await req(
      'POST',
      `${API}/api/sales`,
      {
        customer_id: customer.id,
        payment_method: 'crediario',
        payments: [{ method: 'crediario', amount_cents: 500 }],
        credit: { installment_count: 2, entry_cents: 0 },
        items: [{ is_misc: true, name: 'Crediário E2E', quantity: 1, unit_price_cents: 500 }],
        notes: 'E2E Etapa5 crediário',
      },
      token
    );
    if (creditSale.status < 400 && creditSale.json?.id) {
      const accounts = await req('GET', `${API}/api/credit/accounts?status=open`, null, token);
      const acc = (accounts.json || []).find((a) => a.sale_id === creditSale.json.id) || accounts.json?.[0];
      if (acc) {
        const pay = await req(
          'POST',
          `${API}/api/credit/payments`,
          {
            credit_account_id: acc.id,
            amount_cents: 200,
            method: 'pix',
          },
          token
        );
        creditOk = pay.status === 201 || pay.status === 200;
      }
    } else {
      creditOk = false;
      record(
        'credit-sale',
        'Venda crediário (criação)',
        false,
        `${creditSale.status} ${creditSale.json?.error || ''}`
      );
    }
  }
  record('credit-flow', 'Fluxo crediário / pagamento parcial', creditOk, creditOk ? 'ok' : 'parcial/indisponível');

  const current = await req('GET', `${API}/api/cash/sessions/current`, null, token);
  const expected =
    current.json?.opening_amount_cents +
      current.json?.sales_dinheiro_cents +
      current.json?.cash_in_cents -
      current.json?.cash_out_cents || 0;
  const closed = await req(
    'POST',
    `${API}/api/cash/sessions/close`,
    { counted_amount_cents: Math.max(0, expected), close_notes: 'E2E Etapa5' },
    token
  );
  record('cash-close', 'Fechar caixa', closed.status === 200 || closed.status === 201, String(closed.status));

  const backup = await req('POST', `${API}/api/backups`, { notes: 'e2e etapa5' }, token);
  record(
    'backup',
    'Backup',
    (backup.status === 201 || backup.status === 200) && existsSync(backup.json?.filepath || ''),
    backup.json?.filename || ''
  );

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  const integrity = db.pragma('integrity_check')[0].integrity_check === 'ok';
  const fk = db.pragma('foreign_key_check').length === 0;
  const counts = {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    customers: db.prepare('SELECT COUNT(*) c FROM customers').get().c,
    sales_legacy: db
      .prepare(`SELECT COUNT(*) c FROM sales WHERE legacy_source='oncas_pdv_v2'`)
      .get().c,
  };
  record('sqlite-integrity', 'integrity_check', integrity);
  record('sqlite-fk', 'foreign_key_check', fk);
  record(
    'data-preserved',
    'Dados reais preservados (mínimos)',
    counts.products >= 488 && counts.customers >= 7 && counts.sales_legacy >= 87,
    JSON.stringify(counts)
  );
  db.close();

  finished = true;
  clearTimeout(watchdog);
  const failed = results.filter((r) => !r.ok);
  const outDir = resolve(root, 'docs/reports');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, 'ETAPA5-E2E.json'),
    JSON.stringify(
      { created_at: new Date().toISOString(), results, failed: failed.length },
      null,
      2
    )
  );
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) process.exit(1);
  console.log('E2E ETAPA 5: OK');
}

main().catch((e) => {
  finished = true;
  clearTimeout(watchdog);
  console.error(e);
  process.exit(1);
});
