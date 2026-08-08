#!/usr/bin/env node
/**
 * Revisão Etapa 3 — API real + SQLite de desenvolvimento.
 * Cobre fornecedores, compras, crediário, devoluções, entregas + regressão.
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
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}. ${title}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`API: ${BASE}`);
  console.log(`DB:  ${DB_PATH}`);
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');

  let open = (await api('GET', '/api/cash/sessions/current')).json;
  if (!open) {
    const opened = await api('POST', '/api/cash/sessions/open', {
      operator_name: 'Revisor E3',
      opening_amount_cents: 15000,
    });
    record('cash-open', 'Abrir caixa', opened.status === 201, opened.json?.id);
    open = opened.json;
  } else {
    record('cash-open', 'Caixa já aberto', true, `id=${open.id}`);
  }

  const stamp = Date.now();
  const supplierDoc = `11${String(stamp).padStart(12, '0').slice(-12)}`;
  const supplier = await api('POST', '/api/suppliers', {
    name: `Fornecedor Review ${stamp}`,
    trade_name: 'FR Review',
    document: supplierDoc,
    phone: '11999990000',
    whatsapp: '11999990000',
    email: 'review@fornecedor.test',
    address: 'Rua Teste',
    address_number: '100',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip_code: '01001000',
    contact_name: 'Contato',
    notes: 'Etapa 3',
  });
  record(1, 'Cadastro de fornecedor', supplier.status === 201, supplier.json?.id || JSON.stringify(supplier.json));

  const supplierEdit = await api('PUT', `/api/suppliers/${supplier.json.id}`, {
    trade_name: 'FR Review Editado',
    city: 'Campinas',
  });
  record(
    2,
    'Edição de fornecedor',
    supplierEdit.status === 200 && supplierEdit.json.city === 'Campinas'
  );

  const prod = await api('POST', '/api/products', {
    name: `Produto Compra ${stamp}`,
    sku: `E3-${stamp}`,
    barcode: `${stamp}`.slice(0, 13),
    price_cents: 2000,
    cost_cents: 800,
    stock_qty: 5,
  });
  record('prod', 'Produto auxiliar', prod.status === 201, prod.json?.id);
  const stockBeforePurchase = db
    .prepare('SELECT stock_qty, cost_cents FROM products WHERE id=?')
    .get(prod.json.id);

  const purchase = await api('POST', '/api/purchases', {
    supplier_id: supplier.json.id,
    document_number: `NF-${stamp}`,
    purchase_date: new Date().toISOString().slice(0, 10),
    freight_cents: 100,
    other_costs_cents: 50,
    items: [{ product_id: prod.json.id, quantity: 10, unit_cost_cents: 900 }],
  });
  record(3, 'Compra concluída', purchase.status === 201 && purchase.json.status === 'completed');

  const afterPurchase = db
    .prepare('SELECT stock_qty, cost_cents FROM products WHERE id=?')
    .get(prod.json.id);
  record(
    4,
    'Atualização do estoque por compra',
    afterPurchase.stock_qty === stockBeforePurchase.stock_qty + 10 &&
      afterPurchase.cost_cents === 900,
    `${stockBeforePurchase.stock_qty}->${afterPurchase.stock_qty} cost=${afterPurchase.cost_cents}`
  );

  const cancelPurchase = await api('POST', `/api/purchases/${purchase.json.id}/cancel`, {
    reason: 'Cancelamento review etapa 3',
  });
  record(
    5,
    'Cancelamento de compra',
    cancelPurchase.status === 200 && cancelPurchase.json.status === 'cancelled'
  );
  const afterCancelPurchase = db
    .prepare('SELECT stock_qty FROM products WHERE id=?')
    .get(prod.json.id).stock_qty;
  record(
    6,
    'Estorno de estoque (compra)',
    afterCancelPurchase === stockBeforePurchase.stock_qty,
    `${afterPurchase.stock_qty}->${afterCancelPurchase}`
  );
  record(
    'purchase-kept',
    'Compra cancelada permanece',
    db.prepare('SELECT status FROM purchases WHERE id=?').get(purchase.json.id).status ===
      'cancelled'
  );

  const customer = await api('POST', '/api/customers', {
    name: `Cliente Crediário ${stamp}`,
    phone: '11988887777',
  });
  record('cust', 'Cliente auxiliar', customer.status === 201, customer.json?.id);

  // repor estoque via compra draft→complete para venda
  const restock = await api('POST', '/api/purchases', {
    supplier_id: supplier.json.id,
    items: [{ product_id: prod.json.id, quantity: 20, unit_cost_cents: 850 }],
  });
  record('restock', 'Reposição estoque para vendas', restock.status === 201);

  const creditSale = await api('POST', '/api/sales', {
    client_request_id: `e3-credit-${stamp}`,
    customer_id: customer.json.id,
    payment_method: 'crediario',
    credit: {
      entry_cents: 500,
      installment_count: 3,
      first_due_date: yesterday(),
    },
    items: [{ product_id: prod.json.id, quantity: 2 }],
  });
  record(7, 'Venda no crediário', creditSale.status === 201, creditSale.json?.id);

  const accounts = await api('GET', `/api/credit/accounts?customer_id=${customer.json.id}`);
  const account = accounts.json?.[0];
  record(
    8,
    'Criação de parcelas',
    !!account && account.installment_count === 3 && (account.installments?.length || 0) >= 3,
    `account=${account?.id}`
  );

  const detail = await api('GET', `/api/credit/accounts/${account.id}`);
  const partial = await api('POST', '/api/credit/payments', {
    credit_account_id: account.id,
    amount_cents: 400,
    method: 'pix',
  });
  record(
    9,
    'Pagamento parcial',
    partial.status === 201 &&
      ['parcialmente_pago', 'aberto', 'vencido'].includes(partial.json.status)
  );

  const quit = await api('POST', '/api/credit/payments', {
    credit_account_id: account.id,
    amount_cents: partial.json.balance_cents,
    method: 'dinheiro',
  });
  record(10, 'Quitação', quit.status === 201 && quit.json.status === 'quitado');

  // nova venda para parcela vencida
  const overdueSale = await api('POST', '/api/sales', {
    client_request_id: `e3-overdue-${stamp}`,
    customer_id: customer.json.id,
    payment_method: 'crediario',
    credit: { entry_cents: 0, installment_count: 1, first_due_date: yesterday() },
    items: [{ product_id: prod.json.id, quantity: 1 }],
  });
  const overdueAccounts = await api('GET', `/api/credit/accounts?customer_id=${customer.json.id}`);
  const overdueAcc = overdueAccounts.json.find((a) => a.sale_id === overdueSale.json.id);
  const overdueDetail = await api('GET', `/api/credit/accounts/${overdueAcc.id}`);
  const hasOverdue = (overdueDetail.json.installments || []).some((i) => i.status === 'vencido')
    || overdueDetail.json.status === 'vencido';
  record(11, 'Parcela vencida', hasOverdue, overdueDetail.json.status);

  const stockBeforeReturn = db
    .prepare('SELECT stock_qty FROM products WHERE id=?')
    .get(prod.json.id).stock_qty;
  const saleForReturn = await api('POST', '/api/sales', {
    client_request_id: `e3-ret-${stamp}`,
    customer_id: customer.json.id,
    payment_method: 'dinheiro',
    items: [{ product_id: prod.json.id, quantity: 3 }],
  });
  const saleFull = await api('GET', `/api/sales/${saleForReturn.json.id}`);
  const saleItemId = saleFull.json.items[0].id;

  const retPartial = await api('POST', '/api/returns', {
    sale_id: saleForReturn.json.id,
    reason: 'Devolução parcial review',
    items: [{ sale_item_id: saleItemId, quantity: 1 }],
  });
  record(12, 'Devolução parcial', retPartial.status === 201);

  const retTotal = await api('POST', '/api/returns', {
    sale_id: saleForReturn.json.id,
    reason: 'Devolução restante review',
    items: [{ sale_item_id: saleItemId, quantity: 2 }],
  });
  record(13, 'Devolução total (restante)', retTotal.status === 201);

  const retBlocked = await api('POST', '/api/returns', {
    sale_id: saleForReturn.json.id,
    reason: 'Deveria falhar',
    items: [{ sale_item_id: saleItemId, quantity: 1 }],
  });
  record(
    14,
    'Bloqueio devolução acima da qtd',
    retBlocked.status >= 400,
    String(retBlocked.status)
  );

  const stockAfterReturn = db
    .prepare('SELECT stock_qty FROM products WHERE id=?')
    .get(prod.json.id).stock_qty;
  record(
    15,
    'Retorno correto ao estoque',
    stockAfterReturn === stockBeforeReturn,
    `${stockBeforeReturn}->${stockAfterReturn} (venda 3 e devolução 3)`
  );

  const delivery = await api('POST', '/api/deliveries', {
    sale_id: saleForReturn.json.id,
    scheduled_date: tomorrow(),
    period: 'tarde',
    courier_name: 'Entregador Review',
    notes: 'Etapa 3',
  });
  record(16, 'Criação de entrega', delivery.status === 201, delivery.json?.id);

  const statusChange = await api('POST', `/api/deliveries/${delivery.json.id}/status`, {
    status: 'saiu_para_entrega',
    note: 'Saiu da loja',
  });
  record(
    17,
    'Alteração de status da entrega',
    statusChange.status === 200 && statusChange.json.status === 'saiu_para_entrega'
  );

  const deliveryDetail = await api('GET', `/api/deliveries/${delivery.json.id}`);
  record(
    18,
    'Histórico de entrega',
    (deliveryDetail.json.history || []).length >= 2,
    `hist=${deliveryDetail.json.history?.length}`
  );

  // 19 — reinício é validado externamente; aqui checamos health + persistência
  const health = await api('GET', '/api/health');
  record(19, 'Reinicialização / health persistente', health.status === 200 && health.json.status === 'ok');

  const orphans = db
    .prepare(
      `SELECT COUNT(*) AS c FROM purchase_items pi LEFT JOIN purchases p ON p.id=pi.purchase_id WHERE p.id IS NULL`
    )
    .get().c;
  const neg = db
    .prepare(`SELECT COUNT(*) AS c FROM products WHERE stock_qty < 0 AND allow_negative_stock=0`)
    .get().c;
  const fkOn = db.pragma('foreign_keys', { simple: true });
  record(20, 'Integridade do SQLite', orphans === 0 && neg === 0 && fkOn === 1, `orphans=${orphans} neg=${neg} fk=${fkOn}`);

  // 21 — regressão Etapa 1/2 smoke
  const saleCash = await api('POST', '/api/sales', {
    client_request_id: `e3-reg-${stamp}`,
    payment_method: 'pix',
    items: [{ product_id: prod.json.id, quantity: 1 }],
  });
  const products = await api('GET', '/api/products');
  const customers = await api('GET', '/api/customers');
  record(
    21,
    'Regressão Etapas 1 e 2',
    saleCash.status === 201 && Array.isArray(products.json) && Array.isArray(customers.json)
  );

  // sanity unused vars
  void detail;

  db.close();
  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Total: ${results.length} | PASS: ${results.length - failed.length} | FAIL: ${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(` - ${f.id}. ${f.title}: ${f.detail}`);
    process.exit(1);
  }
  console.log('REVISÃO ETAPA 3: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
