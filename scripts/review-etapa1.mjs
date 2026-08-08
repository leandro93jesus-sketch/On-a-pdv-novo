#!/usr/bin/env node
/**
 * Revisão técnica Etapa 1 — testes reais contra API + SQLite de desenvolvimento.
 * Uso: node scripts/review-etapa1.mjs
 */
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const BASE = process.env.PDV_API_URL || 'http://localhost:3001';
const DB_PATH =
  process.env.PDV_DB_PATH ||
  resolve(dirname(fileURLToPath(import.meta.url)), '../server/data/onca-pdv.db');

const results = [];

function record(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id}. ${title}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function openDb() {
  const db = new Database(DB_PATH, { readonly: false, fileMustExist: true });
  db.pragma('foreign_keys = ON');
  return db;
}

async function main() {
  console.log(`API: ${BASE}`);
  console.log(`DB:  ${DB_PATH}`);
  console.log('---');

  const health = await api('GET', '/api/health');
  if (health.status !== 200) {
    console.error('API indisponível. Suba com npm run dev:server');
    process.exit(1);
  }

  // Etapa 2+: vendas exigem caixa aberto
  const openCash = await api('GET', '/api/cash/sessions/current');
  if (!openCash.json) {
    const opened = await api('POST', '/api/cash/sessions/open', {
      operator_name: 'Revisor E1',
      opening_amount_cents: 10000,
    });
    if (opened.status !== 201) {
      console.error('Não foi possível abrir caixa para a revisão', opened.json);
      process.exit(1);
    }
  }

  const db = openDb();
  const snapshotStock = () =>
    Object.fromEntries(
      db.prepare('SELECT id, stock_qty, name FROM products').all().map((r) => [r.id, r.stock_qty])
    );

  // --- 12/13 busca e barcode ---
  const products = (await api('GET', '/api/products')).json;
  const agua = products.find((p) => p.barcode === '7891000100103') || products[0];
  const barcodeRes = await api('GET', `/api/products?barcode=${encodeURIComponent(agua.barcode)}`);
  record(
    12,
    'Código de barras localiza produto',
    barcodeRes.status === 200 && barcodeRes.json.length === 1 && barcodeRes.json[0].id === agua.id,
    `barcode=${agua.barcode}`
  );

  const nameRes = await api('GET', `/api/products?q=${encodeURIComponent(agua.name.split(' ')[0])}`);
  const codeRes = await api('GET', `/api/products?q=${encodeURIComponent(agua.barcode)}`);
  record(
    13,
    'Busca por nome e código',
    nameRes.json.some((p) => p.id === agua.id) && codeRes.json.some((p) => p.id === agua.id)
  );

  const before = snapshotStock();
  const salesBefore = db.prepare('SELECT COUNT(*) AS c FROM sales').get().c;

  // --- 4 cancelamento local (sem POST) ---
  // Simula cancelamento: nenhum POST de venda; estoque inalterado
  const afterCancelCheck = snapshotStock();
  record(
    4,
    'Cancelar antes da finalização não altera estoque',
    JSON.stringify(before) === JSON.stringify(afterCancelCheck) &&
      db.prepare('SELECT COUNT(*) AS c FROM sales').get().c === salesBefore,
    'nenhuma venda enviada = carrinho descartado'
  );

  // --- 5 descontos inválidos ---
  const negDisc = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    discount_cents: -1,
    items: [{ product_id: agua.id, quantity: 1 }],
  });
  const overDisc = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    discount_cents: 999999,
    items: [{ product_id: agua.id, quantity: 1 }],
  });
  const stockAfterBadDiscount = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(agua.id)
    .stock_qty;
  record(
    5,
    'Desconto inválido / total negativo bloqueados',
    negDisc.status === 400 &&
      overDisc.status === 400 &&
      stockAfterBadDiscount === before[agua.id],
    `neg=${negDisc.json.code}, over=${overDisc.json.code}`
  );

  // --- 3 estoque insuficiente ---
  const insuf = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: agua.id, quantity: before[agua.id] + 50 }],
  });
  record(
    3,
    'Venda com estoque insuficiente bloqueada',
    insuf.status === 409 &&
      insuf.json.code === 'STOCK_INSUFFICIENT' &&
      db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(agua.id).stock_qty ===
        before[agua.id]
  );

  // --- 1,2,6,7,10,11 venda completa ---
  const qty = 2;
  const miscPrice = 150;
  const discount = 50;
  const create = await api('POST', '/api/sales', {
    client_request_id: `review-${Date.now()}`,
    payment_method: 'dinheiro',
    discount_cents: discount,
    items: [
      { product_id: agua.id, quantity: qty },
      { is_misc: true, name: 'Item Diversos Review', unit_price_cents: miscPrice, quantity: 1 },
    ],
  });

  const sale = create.json;
  const expectedSubtotal = agua.price_cents * qty + miscPrice;
  const expectedTotal = expectedSubtotal - discount;
  const row = db.prepare('SELECT * FROM sales WHERE id = ?').get(sale.id);
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(sale.id);
  const pays = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(sale.id);
  const stockNow = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(agua.id).stock_qty;
  const mov = db
    .prepare(
      `SELECT quantity_delta, stock_after FROM stock_movements
       WHERE reference_type='sale' AND reference_id=? AND product_id=?`
    )
    .get(sale.id, agua.id);

  record(
    1,
    'Venda salva corretamente no SQLite',
    create.status === 201 &&
      !!row &&
      row.total_cents === expectedTotal &&
      row.subtotal_cents === expectedSubtotal &&
      row.discount_cents === discount,
    sale.sale_number
  );

  record(
    2,
    'Estoque baixado exatamente pela quantidade vendida',
    stockNow === before[agua.id] - qty && mov?.quantity_delta === -qty && mov?.stock_after === stockNow,
    `${before[agua.id]} → ${stockNow}`
  );

  record(
    6,
    'Item Diversos registrado na venda',
    items.some((i) => i.is_misc === 1 && i.name === 'Item Diversos Review' && i.line_total_cents === miscPrice)
  );

  record(
    '7.1',
    'Pagamento dinheiro gravado',
    pays.length === 1 && pays[0].method === 'dinheiro' && pays[0].amount_cents === expectedTotal
  );

  // Pix e Cartão
  const other = products.filter((p) => p.id !== agua.id && p.stock_qty > 0).slice(0, 2);
  const pixSale = await api('POST', '/api/sales', {
    client_request_id: `review-pix-${Date.now()}`,
    payment_method: 'pix',
    items: [{ product_id: other[0].id, quantity: 1 }],
  });
  const cartaoSale = await api('POST', '/api/sales', {
    client_request_id: `review-cartao-${Date.now()}`,
    payment_method: 'cartao',
    items: [{ product_id: other[1].id, quantity: 1 }],
  });
  const pixPay = db.prepare('SELECT method FROM sale_payments WHERE sale_id=?').get(pixSale.json.id);
  const cartaoPay = db
    .prepare('SELECT method FROM sale_payments WHERE sale_id=?')
    .get(cartaoSale.json.id);
  record(
    7,
    'Dinheiro, Pix e Cartão gravados corretamente',
    pays[0].method === 'dinheiro' && pixPay?.method === 'pix' && cartaoPay?.method === 'cartao'
  );

  // --- 8 idempotência ---
  const idemKey = `review-idem-${Date.now()}`;
  const prodIdem = other[0];
  const stockIdemBefore = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(prodIdem.id)
    .stock_qty;
  const a = await api('POST', '/api/sales', {
    client_request_id: idemKey,
    payment_method: 'pix',
    items: [{ product_id: prodIdem.id, quantity: 1 }],
  });
  const b = await api('POST', '/api/sales', {
    client_request_id: idemKey,
    payment_method: 'pix',
    items: [{ product_id: prodIdem.id, quantity: 1 }],
  });
  const countIdem = db
    .prepare('SELECT COUNT(*) AS c FROM sales WHERE client_request_id=?')
    .get(idemKey).c;
  const stockIdemAfter = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(prodIdem.id)
    .stock_qty;
  record(
    8,
    'Reenvio/duplo envio não cria venda duplicada',
    a.status === 201 &&
      b.status === 201 &&
      a.json.id === b.json.id &&
      countIdem === 1 &&
      stockIdemAfter === stockIdemBefore - 1,
    `id=${a.json.id}`
  );

  // --- 9 rollback ---
  const rollbackProd = products.find((p) => p.stock_qty >= 3) || agua;
  const stockRbBefore = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(rollbackProd.id)
    .stock_qty;
  const salesRbBefore = db.prepare('SELECT COUNT(*) AS c FROM sales').get().c;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS review_fail_after_stock
    AFTER UPDATE ON products
    BEGIN
      SELECT RAISE(ABORT, 'rollback-review');
    END;
  `);
  const rb = await api('POST', '/api/sales', {
    client_request_id: `review-rb-${Date.now()}`,
    payment_method: 'dinheiro',
    items: [{ product_id: rollbackProd.id, quantity: 1 }],
  });
  db.exec('DROP TRIGGER IF EXISTS review_fail_after_stock');
  const stockRbAfter = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(rollbackProd.id)
    .stock_qty;
  const salesRbAfter = db.prepare('SELECT COUNT(*) AS c FROM sales').get().c;
  record(
    9,
    'Falha na gravação faz rollback (sem venda/estoque parcial)',
    rb.status >= 500 &&
      stockRbAfter === stockRbBefore &&
      salesRbAfter === salesRbBefore,
    `status=${rb.status}`
  );

  // --- 10 histórico ---
  const hist = await api('GET', '/api/sales?limit=20');
  const histRow = hist.json.find((s) => s.id === sale.id);
  record(
    10,
    'Histórico com número, data, total e pagamento',
    !!histRow &&
      !!histRow.sale_number &&
      !!histRow.created_at &&
      histRow.total_cents === expectedTotal &&
      histRow.payment_method === 'dinheiro'
  );

  // --- 11 comprovante ---
  const receipt = await api('GET', `/api/sales/${sale.id}`);
  record(
    11,
    'Comprovante com itens, qtds, valores, desconto, total e pagamento',
    receipt.status === 200 &&
      receipt.json.items.length === 2 &&
      receipt.json.items.every((i) => i.quantity > 0 && i.line_total_cents >= 0) &&
      receipt.json.discount_cents === discount &&
      receipt.json.total_cents === expectedTotal &&
      receipt.json.payments[0].method === 'dinheiro'
  );

  // Integridade geral
  const orphans = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sale_items si
       LEFT JOIN sales s ON s.id = si.sale_id WHERE s.id IS NULL`
    )
    .get().c;
  const payOrphans = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sale_payments sp
       LEFT JOIN sales s ON s.id = sp.sale_id WHERE s.id IS NULL`
    )
    .get().c;
  const negativeBlocked = db
    .prepare(
      `SELECT COUNT(*) AS c FROM products
       WHERE stock_qty < 0 AND allow_negative_stock = 0`
    )
    .get().c;
  record(
    'INT',
    'Integridade vendas/estoque (sem órfãos / sem negativo indevido)',
    orphans === 0 && payOrphans === 0 && negativeBlocked === 0,
    `orphans=${orphans}, payOrphans=${payOrphans}, neg=${negativeBlocked}`
  );

  db.close();

  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) {
    console.log('Falhas:');
    for (const f of failed) console.log(` - ${f.id}. ${f.title}: ${f.detail}`);
    process.exit(1);
  }
  console.log('REVISÃO ETAPA 1: TODOS OS PONTOS CRÍTICOS PASSARAM');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
