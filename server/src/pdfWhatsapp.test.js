import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'onca-pdf-wa-'));
process.env.NODE_ENV = 'test';
process.env.PDV_DATA_DIR = tmp;
process.env.PDV_DB_PATH = join(tmp, 'pdf-wa.db');
process.env.PDV_SEED = '0';

const { openDatabase, setDb, closeDb } = await import('./db/index.js');
const { createApp } = await import('./app.js');
const { openCashSession } = await import('./services/cashService.js');
const { ensureBootstrapAdmin } = await import('./services/authService.js');

let server;
let baseUrl;
let db;
let token;

async function api(method, path, body, auth = token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

function resetCash() {
  db.exec('DELETE FROM cash_movements; DELETE FROM cash_sessions;');
  return openCashSession({
    terminal_id: 'TERM-1',
    operator_name: 'Operador PDF',
    opening_amount_cents: 5000,
  });
}

before(async () => {
  db = openDatabase(process.env.PDV_DB_PATH);
  setDb(db);
  ensureBootstrapAdmin();
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
  const login = await api('POST', '/api/auth/login', { login: 'admin', password: 'admin123' }, null);
  token = login.json.token;
});

beforeEach(() => {
  db.exec(`
    DELETE FROM delivery_order_payments;
    DELETE FROM delivery_order_items;
    DELETE FROM delivery_order_history;
    DELETE FROM delivery_order_scans;
    DELETE FROM stock_reservations;
    DELETE FROM delivery_orders;
    DELETE FROM credit_payments;
    DELETE FROM credit_installments;
    DELETE FROM credit_accounts;
    DELETE FROM sale_payments;
    DELETE FROM sale_items;
    DELETE FROM sales;
    DELETE FROM stock_movements;
    DELETE FROM products;
    DELETE FROM customers;
    DELETE FROM audit_logs;
  `);
  resetCash();
});

after(() => {
  server?.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

async function seedProduct(stock = 20, price = 1000) {
  const { json } = await api('POST', '/api/products', {
    name: `Prod PDF ${Math.random().toString(36).slice(2, 6)}`,
    sku: `PDF${Math.random().toString(36).slice(2, 7)}`,
    price_cents: price,
    cost_cents: 400,
    stock_qty: stock,
    confirm_similar_name: true,
  });
  return json;
}

async function seedCustomer(phone = '11999998888') {
  const { json } = await api('POST', '/api/customers', {
    name: 'Cliente PDF',
    phone,
    whatsapp: phone,
  });
  return json;
}

test('PDF venda simples é gerado e salvo em comprovantes/YYYY/MM', async () => {
  const product = await seedProduct();
  const sale = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: product.id, quantity: 1 }],
  });
  assert.equal(sale.res.status, 201, JSON.stringify(sale.json));

  const meta = await api('POST', `/api/receipts/sales/${sale.json.id}/pdf`, {});
  assert.equal(meta.res.status, 200, JSON.stringify(meta.json));
  assert.ok(meta.json.filename.startsWith('ONCA-VENDA-'));
  assert.ok(meta.json.filename.endsWith('.pdf'));
  assert.ok(meta.json.relative_path.includes('comprovantes/'));
  assert.ok(existsSync(meta.json.absolute_path));
  const buf = readFileSync(meta.json.absolute_path);
  assert.ok(buf.slice(0, 4).toString() === '%PDF');

  const pdfRes = await fetch(`${baseUrl}/api/receipts/sales/${sale.json.id}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
});

test('WhatsApp gera PDF e NÃO anexa automaticamente; mensagem sem lista de produtos', async () => {
  const customer = await seedCustomer('11988887777');
  const product = await seedProduct(10, 2500);
  const sale = await api('POST', '/api/sales', {
    customer_id: customer.id,
    payment_method: 'dinheiro',
    items: [{ product_id: product.id, quantity: 2 }],
  });
  const wa = await api('POST', `/api/receipts/sales/${sale.json.id}/whatsapp`, {});
  assert.equal(wa.res.status, 200, JSON.stringify(wa.json));
  assert.equal(wa.json.pdf_attached, false);
  assert.ok(wa.json.pdf?.absolute_path);
  assert.ok(existsSync(wa.json.pdf.absolute_path));
  assert.ok(wa.json.url.includes('wa.me'));
  assert.ok(wa.json.message.toLowerCase().includes('comprovante'));
  assert.equal(wa.json.message.toLowerCase().includes(product.name.toLowerCase()), false);
  assert.ok(wa.json.note.toLowerCase().includes('pdf'));
});

test('cliente sem telefone ainda gera PDF e permite informar número no WhatsApp', async () => {
  const customer = await api('POST', '/api/customers', { name: 'Sem Telefone' });
  const product = await seedProduct();
  const sale = await api('POST', '/api/sales', {
    customer_id: customer.json.id,
    payment_method: 'pix',
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const wa = await api('POST', `/api/receipts/sales/${sale.json.id}/whatsapp`, {
    phone: '11977776666',
  });
  assert.equal(wa.res.status, 200);
  assert.ok(wa.json.phone?.endsWith('11977776666') || wa.json.phone?.includes('11977776666'));
  assert.ok(wa.json.pdf?.filename);
});

test('Cartão Crédito e Débito aparecem corretamente no PDF', async () => {
  const product = await seedProduct(10, 1000);
  const credit = await api('POST', '/api/sales', {
    payment_method: 'cartao',
    card_type: 'CREDIT',
    items: [{ product_id: product.id, quantity: 1 }],
  });
  assert.equal(credit.res.status, 201, JSON.stringify(credit.json));
  const debit = await api('POST', '/api/sales', {
    payment_method: 'cartao',
    card_type: 'DEBIT',
    items: [{ product_id: product.id, quantity: 1 }],
  });
  assert.equal(debit.res.status, 201, JSON.stringify(debit.json));

  const { ensureSaleReceiptPdfFile, paymentLabelForPdf } = await import('./services/pdfService.js');
  assert.equal(paymentLabelForPdf('cartao', 'CREDIT'), 'Cartão Crédito');
  assert.equal(paymentLabelForPdf('cartao', 'DEBIT'), 'Cartão Débito');

  const cFile = await ensureSaleReceiptPdfFile(credit.json.id, { force: true });
  const dFile = await ensureSaleReceiptPdfFile(debit.json.id, { force: true });
  assert.ok(existsSync(cFile.absolutePath));
  assert.ok(existsSync(dFile.absolutePath));
  assert.equal(credit.json.payments[0].card_type, 'CREDIT');
  assert.equal(debit.json.payments[0].card_type, 'DEBIT');
});

test('pagamento misto lista todas as formas sem alterar estoque indevido', async () => {
  const product = await seedProduct(10, 10000);
  const stockBefore = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty;
  const sale = await api('POST', '/api/sales', {
    payments: [
      { method: 'dinheiro', amount_cents: 2000 },
      { method: 'pix', amount_cents: 3000 },
      { method: 'cartao', amount_cents: 5000, card_type: 'CREDIT' },
    ],
    items: [{ product_id: product.id, quantity: 1 }],
  });
  assert.equal(sale.res.status, 201, JSON.stringify(sale.json));
  assert.equal(sale.json.payments.length, 3);
  const stockAfter = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty;
  assert.equal(stockAfter, stockBefore - 1);

  const meta = await api('POST', `/api/receipts/sales/${sale.json.id}/pdf`, { force: true });
  assert.equal(meta.res.status, 200);
  assert.ok(existsSync(meta.json.absolute_path));
});

test('regenerar PDF não altera caixa, estoque nem número da venda', async () => {
  const product = await seedProduct(5, 800);
  const sale = await api('POST', '/api/sales', {
    payment_method: 'pix',
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const first = await api('POST', `/api/receipts/sales/${sale.json.id}/pdf`, {});
  const stock1 = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty;
  const cash1 = db
    .prepare("SELECT sales_total_cents FROM cash_sessions WHERE status = 'open'")
    .get().sales_total_cents;
  const number1 = sale.json.sale_number;

  const second = await api('POST', `/api/receipts/sales/${sale.json.id}/pdf`, { force: true });
  assert.equal(second.res.status, 200);
  assert.equal(second.json.sale_number, number1);
  const stock2 = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty;
  const cash2 = db
    .prepare("SELECT sales_total_cents FROM cash_sessions WHERE status = 'open'")
    .get().sales_total_cents;
  assert.equal(stock2, stock1);
  assert.equal(cash2, cash1);
  assert.ok(existsSync(first.json.absolute_path));
  assert.ok(existsSync(second.json.absolute_path));
});

test('pedido de entrega pendente gera PDF de PEDIDO (não comprovante pago)', async () => {
  const customer = await seedCustomer();
  const product = await seedProduct(10, 1500);
  const order = await api('POST', '/api/delivery-orders', {
    customer_id: customer.id,
    customer_name: customer.name,
    phone: customer.phone,
    address: 'Rua Teste',
    address_number: '100',
    city: 'São Paulo',
    state: 'SP',
    payment_status: 'nao_pago',
    items: [{ product_id: product.id, quantity: 1 }],
  });
  assert.equal(order.res.status, 201, JSON.stringify(order.json));
  assert.notEqual(order.json.payment_status, 'pago');

  const stockAfterOrder = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty;
  const meta = await api('POST', `/api/receipts/delivery-orders/${order.json.id}/pdf`, {});
  assert.equal(meta.res.status, 200, JSON.stringify(meta.json));
  assert.equal(meta.json.pending, true);
  assert.ok(meta.json.filename.startsWith('ONCA-PEDIDO-'));
  const stockAfterPdf = db.prepare('SELECT stock_qty FROM products WHERE id=?').get(product.id).stock_qty;
  assert.equal(stockAfterPdf, stockAfterOrder);
});

test('histórico: reabrir venda antiga regenera PDF se arquivo sumiu', async () => {
  const product = await seedProduct();
  const sale = await api('POST', '/api/sales', {
    payment_method: 'dinheiro',
    items: [{ product_id: product.id, quantity: 1 }],
  });
  const meta = await api('POST', `/api/receipts/sales/${sale.json.id}/pdf`, {});
  assert.ok(existsSync(meta.json.absolute_path));
  rmSync(meta.json.absolute_path, { force: true });
  assert.equal(existsSync(meta.json.absolute_path), false);

  const regen = await api('POST', `/api/receipts/sales/${sale.json.id}/pdf`, {});
  assert.equal(regen.res.status, 200);
  assert.ok(existsSync(regen.json.absolute_path));
  assert.equal(regen.json.sale_number, sale.json.sale_number);
});
