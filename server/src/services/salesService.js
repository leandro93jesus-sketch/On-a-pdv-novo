import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { assertNonNegativeCents } from '../utils/money.js';
import { applyStockMovement } from './stockService.js';
import { getCustomerById } from './customersService.js';
import {
  recordSaleAmendOnCash,
  recordSaleCancelOnCash,
  recordSaleOnCash,
  requireOpenCashSession,
} from './cashService.js';
import { createCreditAccountFromSale } from './creditService.js';
import { writeAudit } from './auditService.js';
import { getCurrentOperator } from './settingsService.js';
import { beginOperation, commitOperation, failOperation } from './recoveryService.js';
import { verifyAdminOperationPin } from './adminAuthService.js';

const PAYMENT_METHODS = new Set(['dinheiro', 'pix', 'cartao', 'crediario']);
const CARD_TYPES = new Set(['CREDIT', 'DEBIT']);

function normalizeCardType(raw, { required = false } = {}) {
  if (raw == null || String(raw).trim() === '') {
    if (required) {
      throw new AppError('Informe se o cartão é Crédito ou Débito', {
        status: 400,
        code: 'CARD_TYPE_REQUIRED',
      });
    }
    return null;
  }
  const value = String(raw).trim().toUpperCase();
  if (!CARD_TYPES.has(value)) {
    throw new AppError('Tipo de cartão inválido (use CREDIT ou DEBIT)', {
      status: 400,
      code: 'INVALID_CARD_TYPE',
    });
  }
  return value;
}

function nextSaleNumber(db) {
  const row = db.prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM sales`).get();
  const seq = Number(row?.max_id || 0) + 1;
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `VD-${y}${m}${d}-${String(seq).padStart(6, '0')}`;
}

function mapSale(row) {
  if (!row) return null;
  return {
    id: row.id,
    sale_number: row.sale_number,
    status: row.status,
    subtotal_cents: row.subtotal_cents,
    discount_cents: row.discount_cents,
    total_cents: row.total_cents,
    amount_received_cents: row.amount_received_cents ?? 0,
    change_cents: row.change_cents ?? 0,
    notes: row.notes,
    client_request_id: row.client_request_id ?? null,
    customer_id: row.customer_id ?? null,
    cash_session_id: row.cash_session_id ?? null,
    created_at: row.created_at,
    cancelled_at: row.cancelled_at,
    cancelled_by: row.cancelled_by ?? null,
    cancel_reason: row.cancel_reason ?? null,
    amended_at: row.amended_at ?? null,
    amended_by: row.amended_by ?? null,
    amend_reason: row.amend_reason ?? null,
    amend_authorized_by: row.amend_authorized_by ?? null,
    situation_label:
      row.status === 'cancelled'
        ? 'Cancelada'
        : row.amended_at
          ? 'Alterada'
          : 'Concluída',
  };
}

function resolvePaymentLabel(payments) {
  if (!payments?.length) return null;
  if (payments.length > 1) return 'misto';
  const p = payments[0];
  if (p.method === 'cartao') {
    if (p.card_type === 'CREDIT') return 'cartao_credito';
    if (p.card_type === 'DEBIT') return 'cartao_debito';
    return 'cartao';
  }
  return p.method || null;
}

function periodRange(period) {
  const now = new Date();
  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  if (period === 'today') {
    const s = startOfDay(now);
    return { from: iso(s), to: iso(s) };
  }
  if (period === 'yesterday') {
    const s = startOfDay(now);
    s.setDate(s.getDate() - 1);
    return { from: iso(s), to: iso(s) };
  }
  if (period === 'last7') {
    const e = startOfDay(now);
    const s = new Date(e);
    s.setDate(s.getDate() - 6);
    return { from: iso(s), to: iso(e) };
  }
  if (period === 'month') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1);
    const e = startOfDay(now);
    return { from: iso(s), to: iso(e) };
  }
  return null;
}

export function getSaleById(id) {
  const db = getDb();
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!sale) {
    throw new AppError('Venda não encontrada', { status: 404, code: 'SALE_NOT_FOUND' });
  }

  const items = db
    .prepare(
      `SELECT id, product_id, name, barcode, unit_price_cents, quantity,
              discount_cents, line_total_cents, is_misc
       FROM sale_items WHERE sale_id = ? ORDER BY id`
    )
    .all(id);

  const payments = db
    .prepare(
      `SELECT id, method, amount_cents, card_type, created_at
       FROM sale_payments WHERE sale_id = ? ORDER BY id`
    )
    .all(id);

  let customer = null;
  if (sale.customer_id) {
    customer = db
      .prepare('SELECT id, name, document, phone, whatsapp FROM customers WHERE id = ?')
      .get(sale.customer_id);
  }

  return {
    ...mapSale(sale),
    items,
    payments,
    customer,
    payment_method: resolvePaymentLabel(payments),
  };
}

function findSaleByClientRequestId(clientRequestId) {
  if (!clientRequestId) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM sales WHERE client_request_id = ?')
    .get(clientRequestId);
  return row ? getSaleById(row.id) : null;
}

export function listSales({
  limit = 50,
  offset = 0,
  q = null,
  from = null,
  to = null,
  period = null,
  payment_method = null,
  status = null,
  operator = null,
  sale_number = null,
  customer = null,
} = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 2000);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const where = [];
  const params = {};

  const range = period ? periodRange(period) : null;
  const fromDate = from || range?.from || null;
  const toDate = to || range?.to || null;

  if (fromDate) {
    where.push(`date(s.created_at) >= date(@from)`);
    params.from = String(fromDate).slice(0, 10);
  }
  if (toDate) {
    where.push(`date(s.created_at) <= date(@to)`);
    params.to = String(toDate).slice(0, 10);
  }
  if (status && String(status).trim()) {
    const st = String(status).trim().toLowerCase();
    if (st === 'alterada' || st === 'amended') {
      where.push(`s.status = 'completed' AND s.amended_at IS NOT NULL`);
    } else if (st === 'concluida' || st === 'completed') {
      where.push(`s.status = 'completed' AND s.amended_at IS NULL`);
    } else {
      where.push(`s.status = @status`);
      params.status = st === 'cancelada' ? 'cancelled' : st;
    }
  }
  if (sale_number && String(sale_number).trim()) {
    where.push(`s.sale_number LIKE @sale_number`);
    params.sale_number = `%${String(sale_number).trim()}%`;
  }
  if (customer && String(customer).trim()) {
    where.push(`LOWER(IFNULL(c.name,'')) LIKE @customer`);
    params.customer = `%${String(customer).trim().toLowerCase()}%`;
  }
  if (operator && String(operator).trim()) {
    where.push(`LOWER(IFNULL(cs.operator_name,'')) LIKE @operator`);
    params.operator = `%${String(operator).trim().toLowerCase()}%`;
  }
  if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    where.push(`(
      s.sale_number LIKE @term
      OR IFNULL(c.name,'') LIKE @term
      OR IFNULL(c.phone,'') LIKE @term
      OR IFNULL(c.whatsapp,'') LIKE @term
      OR EXISTS (
        SELECT 1 FROM sale_items si
        WHERE si.sale_id = s.id AND si.name LIKE @term
      )
      OR CAST(s.total_cents AS TEXT) LIKE @term
    )`);
    params.term = term;
  }
  if (payment_method && String(payment_method).trim()) {
    const pm = String(payment_method).trim().toLowerCase();
    if (pm === 'misto') {
      where.push(`(SELECT COUNT(*) FROM sale_payments sp WHERE sp.sale_id = s.id) > 1`);
    } else if (pm === 'cartao_credito') {
      where.push(
        `EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method='cartao' AND sp.card_type='CREDIT')`
      );
    } else if (pm === 'cartao_debito') {
      where.push(
        `EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method='cartao' AND sp.card_type='DEBIT')`
      );
    } else {
      where.push(`EXISTS (
        SELECT 1 FROM sale_payments sp
        WHERE sp.sale_id = s.id AND sp.method = @payment_method
      )`);
      params.payment_method = pm;
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN cash_sessions cs ON cs.id = s.cash_session_id
       ${whereSql}`
    )
    .get(params);
  const total = Number(totalRow?.cnt || 0);

  params.limit = safeLimit;
  params.offset = safeOffset;
  const rows = db
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM sale_payments spc WHERE spc.sale_id = s.id) AS payments_count,
         (SELECT method FROM sale_payments sp WHERE sp.sale_id = s.id ORDER BY sp.id LIMIT 1) AS first_payment_method,
         (SELECT card_type FROM sale_payments sp WHERE sp.sale_id = s.id ORDER BY sp.id LIMIT 1) AS first_card_type,
         (SELECT COALESCE(SUM(si.quantity),0) FROM sale_items si WHERE si.sale_id = s.id) AS items_count,
         c.name AS customer_name,
         c.phone AS customer_phone,
         cs.operator_name AS operator_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN cash_sessions cs ON cs.id = s.cash_session_id
       ${whereSql}
       ORDER BY s.id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all(params);

  const items = rows.map((r) => ({
    ...mapSale(r),
    payment_method:
      Number(r.payments_count) > 1
        ? 'misto'
        : resolvePaymentLabel([
            { method: r.first_payment_method, card_type: r.first_card_type },
          ]),
    customer_name: r.customer_name ?? null,
    customer_phone: r.customer_phone ?? null,
    operator_name: r.operator_name ?? null,
    items_count: Number(r.items_count || 0),
  }));

  return { items, total, limit: safeLimit, offset: safeOffset };
}

export function createSale(payload = {}) {
  const db = getDb();
  const clientRequestId =
    typeof payload.client_request_id === 'string' && payload.client_request_id.trim()
      ? payload.client_request_id.trim().slice(0, 100)
      : null;

  if (clientRequestId) {
    const existing = findSaleByClientRequestId(clientRequestId);
    if (existing) return existing;
  }

  const itemsInput = payload.items;
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new AppError('A venda precisa ter ao menos um item', {
      status: 400,
      code: 'EMPTY_CART',
    });
  }

  const saleDiscount = assertNonNegativeCents(payload.discount_cents ?? 0, 'discount_cents');
  const notes = typeof payload.notes === 'string' ? payload.notes.trim() : null;

  let customerId = null;
  if (payload.customer_id != null && payload.customer_id !== '') {
    const customer = getCustomerById(Number(payload.customer_id));
    if (!customer.active) {
      throw new AppError('Cliente inativo', { status: 400, code: 'CUSTOMER_INACTIVE' });
    }
    customerId = customer.id;
  }

  const getProduct = db.prepare(
    `SELECT id, name, barcode, price_cents, stock_qty, allow_negative_stock, active
     FROM products WHERE id = ?`
  );

  const resolvedItems = [];

  for (const [index, raw] of itemsInput.entries()) {
    const isMisc = Boolean(raw.is_misc) || raw.product_id == null;
    const quantity = Number(raw.quantity);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError(`Quantidade inválida no item ${index + 1}`, {
        status: 400,
        code: 'INVALID_QUANTITY',
      });
    }

    const itemDiscount = assertNonNegativeCents(raw.discount_cents ?? 0, 'item.discount_cents');

    if (isMisc) {
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Item Diversos';
      const unitPrice = assertNonNegativeCents(raw.unit_price_cents, 'unit_price_cents');
      const lineTotal = unitPrice * quantity - itemDiscount;
      if (lineTotal < 0) {
        throw new AppError(`Desconto maior que o valor do item "${name}"`, {
          status: 400,
          code: 'INVALID_DISCOUNT',
        });
      }
      resolvedItems.push({
        product_id: null,
        name,
        barcode: null,
        unit_price_cents: unitPrice,
        quantity,
        discount_cents: itemDiscount,
        line_total_cents: lineTotal,
        is_misc: 1,
      });
      continue;
    }

    const productId = Number(raw.product_id);
    const product = getProduct.get(productId);
    if (!product || !product.active) {
      throw new AppError(`Produto ${raw.product_id} não encontrado ou inativo`, {
        status: 400,
        code: 'PRODUCT_NOT_FOUND',
      });
    }

    const unitPrice =
      raw.unit_price_cents != null
        ? assertNonNegativeCents(raw.unit_price_cents, 'unit_price_cents')
        : product.price_cents;

    const lineTotal = unitPrice * quantity - itemDiscount;
    if (lineTotal < 0) {
      throw new AppError(`Desconto maior que o valor do item "${product.name}"`, {
        status: 400,
        code: 'INVALID_DISCOUNT',
      });
    }

    resolvedItems.push({
      product_id: product.id,
      name: product.name,
      barcode: product.barcode,
      unit_price_cents: unitPrice,
      quantity,
      discount_cents: itemDiscount,
      line_total_cents: lineTotal,
      is_misc: 0,
    });
  }

  const subtotal = resolvedItems.reduce((sum, i) => sum + i.line_total_cents, 0);
  if (saleDiscount > subtotal) {
    throw new AppError('Desconto da venda não pode ser maior que o subtotal', {
      status: 400,
      code: 'INVALID_DISCOUNT',
    });
  }
  const total = subtotal - saleDiscount;
  if (total < 0) {
    throw new AppError('Total da venda não pode ser negativo', {
      status: 400,
      code: 'INVALID_TOTAL',
    });
  }

  let payments = Array.isArray(payload.payments) ? payload.payments : null;
  if (!payments || payments.length === 0) {
    const method = String(payload.payment_method || 'dinheiro').trim().toLowerCase();
    if (!PAYMENT_METHODS.has(method)) {
      throw new AppError('Forma de pagamento inválida', {
        status: 400,
        code: 'INVALID_PAYMENT_METHOD',
      });
    }
    payments = [
      {
        method,
        amount_cents: total,
        card_type: payload.card_type,
      },
    ];
  }

  let paymentsSum = 0;
  const normalizedPayments = payments.map((p, idx) => {
    const method = String(p.method || '').trim().toLowerCase();
    if (!PAYMENT_METHODS.has(method)) {
      throw new AppError(`Forma de pagamento inválida no pagamento ${idx + 1}`, {
        status: 400,
        code: 'INVALID_PAYMENT_METHOD',
      });
    }
    const amount = assertNonNegativeCents(p.amount_cents ?? 0, 'payment.amount_cents');
    if (amount <= 0) {
      throw new AppError(`Valor inválido no pagamento ${idx + 1}`, {
        status: 400,
        code: 'INVALID_PAYMENT_AMOUNT',
      });
    }
    const card_type =
      method === 'cartao'
        ? normalizeCardType(p.card_type, { required: true })
        : null;
    if (method !== 'cartao' && p.card_type != null && String(p.card_type).trim() !== '') {
      throw new AppError('Tipo de cartão só se aplica à forma Cartão', {
        status: 400,
        code: 'CARD_TYPE_NOT_ALLOWED',
      });
    }
    paymentsSum += amount;
    return { method, amount_cents: amount, card_type };
  });

  if (paymentsSum !== total) {
    throw new AppError(
      paymentsSum < total
        ? 'A soma dos pagamentos é menor que o total da venda'
        : 'A soma dos pagamentos é maior que o total da venda',
      {
        status: 400,
        code: paymentsSum < total ? 'PAYMENT_INSUFFICIENT' : 'PAYMENT_OVERPAID',
        details: { total_cents: total, payments_sum_cents: paymentsSum },
      }
    );
  }

  const dinheiroPart = normalizedPayments
    .filter((p) => p.method === 'dinheiro')
    .reduce((s, p) => s + p.amount_cents, 0);
  let amountReceived = assertNonNegativeCents(
    payload.amount_received_cents ?? dinheiroPart,
    'amount_received_cents'
  );
  let changeCents = assertNonNegativeCents(payload.change_cents ?? 0, 'change_cents');
  if (dinheiroPart > 0) {
    if (amountReceived < dinheiroPart) {
      throw new AppError('Valor recebido em dinheiro menor que a parte em dinheiro', {
        status: 400,
        code: 'CASH_RECEIVED_INSUFFICIENT',
      });
    }
    changeCents = amountReceived - dinheiroPart;
  } else {
    amountReceived = 0;
    changeCents = 0;
  }

  const hasCredit = normalizedPayments.some((p) => p.method === 'crediario');
  if (hasCredit && !customerId) {
    throw new AppError('Venda no crediário exige cliente', {
      status: 400,
      code: 'CUSTOMER_REQUIRED_FOR_CREDIT',
    });
  }
  const creditOpts = payload.credit || {};
  const creditEntry = assertNonNegativeCents(creditOpts.entry_cents ?? 0, 'credit.entry_cents');
  const creditInstallments = Number(creditOpts.installment_count ?? 1);

  const stockDemand = new Map();
  for (const item of resolvedItems) {
    if (item.is_misc || !item.product_id) continue;
    stockDemand.set(item.product_id, (stockDemand.get(item.product_id) || 0) + item.quantity);
  }

  const insertSale = db.prepare(`
    INSERT INTO sales (
      sale_number, status, subtotal_cents, discount_cents, total_cents,
      amount_received_cents, change_cents, notes,
      client_request_id, customer_id, cash_session_id
    ) VALUES (
      @sale_number, 'completed', @subtotal_cents, @discount_cents, @total_cents,
      @amount_received_cents, @change_cents, @notes,
      @client_request_id, @customer_id, @cash_session_id
    )
  `);
  const insertItem = db.prepare(`
    INSERT INTO sale_items (
      sale_id, product_id, name, barcode, unit_price_cents, quantity,
      discount_cents, line_total_cents, is_misc
    ) VALUES (
      @sale_id, @product_id, @name, @barcode, @unit_price_cents, @quantity,
      @discount_cents, @line_total_cents, @is_misc
    )
  `);
  const insertPayment = db.prepare(`
    INSERT INTO sale_payments (sale_id, method, amount_cents, card_type)
    VALUES (?, ?, ?, ?)
  `);

  const opKey = clientRequestId || `sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const begun = beginOperation(opKey, 'sale.create', {
    total,
    items: resolvedItems.length,
  });
  if (begun.duplicate && begun.status === 'committed') {
    const existing = findSaleByClientRequestId(clientRequestId);
    if (existing) return existing;
  }

  let saleId;
  try {
    saleId = db.transaction(() => {
      if (clientRequestId) {
        const again = db
          .prepare('SELECT id FROM sales WHERE client_request_id = ?')
          .get(clientRequestId);
        if (again) return Number(again.id);
      }

      const cashSession = requireOpenCashSession(payload.terminal_id);

      const sale_number = nextSaleNumber(db);
      const info = insertSale.run({
        sale_number,
        subtotal_cents: subtotal,
        discount_cents: saleDiscount,
        total_cents: total,
        amount_received_cents: amountReceived,
        change_cents: changeCents,
        notes,
        client_request_id: clientRequestId,
        customer_id: customerId,
        cash_session_id: cashSession.id,
      });
      const id = Number(info.lastInsertRowid);

      for (const item of resolvedItems) {
        insertItem.run({
          sale_id: id,
          product_id: item.product_id,
          name: item.name,
          barcode: item.barcode,
          unit_price_cents: item.unit_price_cents,
          quantity: item.quantity,
          discount_cents: item.discount_cents,
          line_total_cents: item.line_total_cents,
          is_misc: item.is_misc,
        });
      }

      for (const [productId, qty] of stockDemand.entries()) {
        applyStockMovement(
          {
            productId,
            movementType: 'sale',
            quantity: qty,
            reason: `Venda ${sale_number}`,
            referenceType: 'sale',
            referenceId: id,
            note: `Venda ${sale_number}`,
            allowNegative: true,
          },
          { db, skipAudit: true }
        );
      }

      for (const p of normalizedPayments) {
        insertPayment.run(id, p.method, p.amount_cents, p.card_type);
      }

      recordSaleOnCash(db, {
        sessionId: cashSession.id,
        saleId: id,
        totalCents: total,
        payments: normalizedPayments,
      });

      if (hasCredit) {
        const creditAmount = normalizedPayments
          .filter((p) => p.method === 'crediario')
          .reduce((s, p) => s + p.amount_cents, 0);
        createCreditAccountFromSale(db, {
          saleId: id,
          customerId,
          totalCents: creditAmount,
          entryCents: Math.min(creditEntry, creditAmount),
          installmentCount: creditInstallments,
          firstDueDate: creditOpts.first_due_date || null,
          notes: creditOpts.notes || null,
        });
      }

      writeAudit({
        action: 'sale.create',
        entityType: 'sale',
        entityId: id,
        details: {
          sale_number,
          total_cents: total,
          customer_id: customerId,
          cash_session_id: cashSession.id,
          has_credit: hasCredit,
        },
      });

      return id;
    })();
    commitOperation(opKey);
  } catch (err) {
    failOperation(opKey, err?.message || String(err));
    if (clientRequestId && String(err?.message || '').includes('UNIQUE')) {
      const existing = findSaleByClientRequestId(clientRequestId);
      if (existing) return existing;
    }
    if (err?.code && String(err.code).startsWith('SQLITE_')) {
      throw new AppError('Falha ao gravar a venda; nenhuma alteração foi mantida', {
        status: 500,
        code: 'TRANSACTION_FAILED',
        details: { sqlite: err.code, message: err.message },
      });
    }
    throw err;
  }

  return getSaleById(saleId);
}

export function cancelSale(id, payload = {}) {
  const db = getDb();
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) {
    throw new AppError('Motivo do cancelamento é obrigatório', {
      status: 400,
      code: 'CANCEL_REASON_REQUIRED',
    });
  }
  verifyAdminOperationPin(payload.admin_password ?? payload.admin_pin);
  const userName = String(payload.user_name || getCurrentOperator()).trim() || getCurrentOperator();
  const authorizedBy = String(payload.authorized_by || 'Administrador').trim() || 'Administrador';

  return db.transaction(() => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id));
    if (!sale) {
      throw new AppError('Venda não encontrada', { status: 404, code: 'SALE_NOT_FOUND' });
    }
    if (sale.status === 'cancelled') {
      // Idempotente: retorna a venda já cancelada sem re-estornar estoque/caixa
      return getSaleById(id);
    }

    const items = db
      .prepare(
        `SELECT product_id, quantity, is_misc, name FROM sale_items WHERE sale_id = ?`
      )
      .all(Number(id));
    const payments = db
      .prepare(`SELECT method, amount_cents FROM sale_payments WHERE sale_id = ?`)
      .all(Number(id));

    for (const item of items) {
      if (item.is_misc || !item.product_id) continue;
      applyStockMovement(
        {
          productId: item.product_id,
          movementType: 'sale_cancel',
          quantity: item.quantity,
          reason: `Cancelamento ${sale.sale_number}: ${reason}`,
          userName,
          referenceType: 'sale',
          referenceId: Number(id),
          note: reason,
          allowNegative: true,
        },
        { db, skipAudit: true }
      );
    }

    if (sale.cash_session_id) {
      recordSaleCancelOnCash(db, {
        sessionId: sale.cash_session_id,
        saleId: Number(id),
        totalCents: sale.total_cents,
        payments,
        reason,
        userName,
      });
    }

    const credit = db.prepare('SELECT id FROM credit_accounts WHERE sale_id = ?').get(Number(id));
    if (credit) {
      db.prepare(
        `UPDATE credit_accounts SET status='cancelado', balance_cents=0, updated_at=datetime('now') WHERE id=?`
      ).run(credit.id);
      db.prepare(
        `UPDATE credit_installments SET status='cancelado' WHERE credit_account_id=?`
      ).run(credit.id);
    }

    db.prepare(
      `UPDATE sales SET
         status = 'cancelled',
         cancelled_at = datetime('now'),
         cancelled_by = ?,
         cancel_reason = ?
       WHERE id = ?`
    ).run(`${userName} (auth: ${authorizedBy})`, reason, Number(id));

    writeAudit({
      action: 'sale.cancel',
      entityType: 'sale',
      entityId: Number(id),
      details: {
        reason,
        userName,
        operator: userName,
        authorized: true,
        authorized_by: authorizedBy,
        sale_number: sale.sale_number,
        total_before_cents: sale.total_cents,
        total_after_cents: 0,
        items_before: items,
        note: 'Administrador autorizou cancelamento',
      },
      userName,
    });

    return getSaleById(id);
  })();
}

/**
 * Altera venda concluída com autorização administrativa.
 * Corrige estoque e caixa somente pela DIFERENÇA.
 */
export function amendSale(id, payload = {}) {
  const db = getDb();
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) {
    throw new AppError('Motivo da alteração é obrigatório', {
      status: 400,
      code: 'AMEND_REASON_REQUIRED',
    });
  }
  verifyAdminOperationPin(payload.admin_password ?? payload.admin_pin);
  const userName = String(payload.user_name || getCurrentOperator()).trim() || getCurrentOperator();
  const authorizedBy = String(payload.authorized_by || 'Administrador').trim() || 'Administrador';

  const itemsInput = payload.items;
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new AppError('A venda precisa ter ao menos um item', {
      status: 400,
      code: 'EMPTY_CART',
    });
  }

  const saleDiscount = assertNonNegativeCents(payload.discount_cents ?? 0, 'discount_cents');

  let customerId = null;
  if (payload.customer_id != null && payload.customer_id !== '') {
    const customer = getCustomerById(Number(payload.customer_id));
    if (!customer.active) {
      throw new AppError('Cliente inativo', { status: 400, code: 'CUSTOMER_INACTIVE' });
    }
    customerId = customer.id;
  } else if (payload.customer_id === null) {
    customerId = null;
  }

  const getProduct = db.prepare(
    `SELECT id, name, barcode, price_cents, stock_qty, allow_negative_stock, active
     FROM products WHERE id = ?`
  );

  const resolvedItems = [];
  for (const [index, raw] of itemsInput.entries()) {
    const isMisc = Boolean(raw.is_misc) || raw.product_id == null;
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError(`Quantidade inválida no item ${index + 1}`, {
        status: 400,
        code: 'INVALID_QUANTITY',
      });
    }
    const itemDiscount = assertNonNegativeCents(raw.discount_cents ?? 0, 'item.discount_cents');
    if (isMisc) {
      const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Item Diversos';
      const unitPrice = assertNonNegativeCents(raw.unit_price_cents, 'unit_price_cents');
      const lineTotal = unitPrice * quantity - itemDiscount;
      if (lineTotal < 0) {
        throw new AppError('Subtotal do item inválido', { status: 400, code: 'INVALID_LINE' });
      }
      resolvedItems.push({
        product_id: null,
        name,
        barcode: null,
        unit_price_cents: unitPrice,
        quantity,
        discount_cents: itemDiscount,
        line_total_cents: lineTotal,
        is_misc: 1,
      });
      continue;
    }
    const product = getProduct.get(Number(raw.product_id));
    if (!product || !product.active) {
      throw new AppError(`Produto inválido no item ${index + 1}`, {
        status: 400,
        code: 'INVALID_PRODUCT',
      });
    }
    const unitPrice =
      raw.unit_price_cents != null
        ? assertNonNegativeCents(raw.unit_price_cents, 'unit_price_cents')
        : Number(product.price_cents);
    const lineTotal = unitPrice * quantity - itemDiscount;
    if (lineTotal < 0) {
      throw new AppError('Subtotal do item inválido', { status: 400, code: 'INVALID_LINE' });
    }
    resolvedItems.push({
      product_id: product.id,
      name: String(raw.name || product.name),
      barcode: product.barcode,
      unit_price_cents: unitPrice,
      quantity,
      discount_cents: itemDiscount,
      line_total_cents: lineTotal,
      is_misc: 0,
    });
  }

  const subtotal = resolvedItems.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0);
  if (saleDiscount > subtotal) {
    throw new AppError('Desconto maior que o subtotal', { status: 400, code: 'DISCOUNT_OVER' });
  }
  const total = subtotal - saleDiscount;

  return db.transaction(() => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id));
    if (!sale) {
      throw new AppError('Venda não encontrada', { status: 404, code: 'SALE_NOT_FOUND' });
    }
    if (sale.status === 'cancelled') {
      throw new AppError('Venda cancelada não pode ser alterada', {
        status: 409,
        code: 'SALE_CANCELLED',
      });
    }

    const prevItems = db
      .prepare(
        `SELECT product_id, quantity, is_misc, name, unit_price_cents, line_total_cents
         FROM sale_items WHERE sale_id = ?`
      )
      .all(Number(id));

    const prevQty = new Map();
    for (const it of prevItems) {
      if (it.is_misc || !it.product_id) continue;
      prevQty.set(it.product_id, (prevQty.get(it.product_id) || 0) + Number(it.quantity));
    }
    const nextQty = new Map();
    for (const it of resolvedItems) {
      if (it.is_misc || !it.product_id) continue;
      nextQty.set(it.product_id, (nextQty.get(it.product_id) || 0) + Number(it.quantity));
    }

    const allIds = new Set([...prevQty.keys(), ...nextQty.keys()]);
    for (const productId of allIds) {
      const before = prevQty.get(productId) || 0;
      const after = nextQty.get(productId) || 0;
      const diff = after - before;
      if (diff > 0) {
        applyStockMovement(
          {
            productId,
            movementType: 'sale',
            quantity: diff,
            reason: `Alteração venda ${sale.sale_number}`,
            userName,
            referenceType: 'sale',
            referenceId: Number(id),
            note: reason,
            allowNegative: true,
          },
          { db, skipAudit: true }
        );
      } else if (diff < 0) {
        applyStockMovement(
          {
            productId,
            movementType: 'sale_cancel',
            quantity: -diff,
            reason: `Alteração venda ${sale.sale_number}`,
            userName,
            referenceType: 'sale',
            referenceId: Number(id),
            note: reason,
            allowNegative: true,
          },
          { db, skipAudit: true }
        );
      }
    }

    const totalBefore = Number(sale.total_cents);
    const delta = total - totalBefore;
    if (sale.cash_session_id && delta !== 0) {
      recordSaleAmendOnCash(db, {
        sessionId: sale.cash_session_id,
        saleId: Number(id),
        deltaCents: delta,
        reason: `Alteração ${sale.sale_number}: ${reason}`,
        userName,
      });
    }

    db.prepare(`DELETE FROM sale_items WHERE sale_id = ?`).run(Number(id));
    const insertItem = db.prepare(
      `INSERT INTO sale_items (
         sale_id, product_id, name, barcode, unit_price_cents, quantity,
         discount_cents, line_total_cents, is_misc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of resolvedItems) {
      insertItem.run(
        Number(id),
        item.product_id,
        item.name,
        item.barcode,
        item.unit_price_cents,
        item.quantity,
        item.discount_cents,
        item.line_total_cents,
        item.is_misc
      );
    }

    const nextCustomerId =
      payload.customer_id !== undefined ? customerId : sale.customer_id ?? null;

    db.prepare(
      `UPDATE sales SET
         customer_id = ?,
         subtotal_cents = ?,
         discount_cents = ?,
         total_cents = ?,
         amended_at = datetime('now'),
         amended_by = ?,
         amend_reason = ?,
         amend_authorized_by = ?
       WHERE id = ?`
    ).run(
      nextCustomerId,
      subtotal,
      saleDiscount,
      total,
      userName,
      reason,
      authorizedBy,
      Number(id)
    );

    writeAudit({
      action: 'sale.amend',
      entityType: 'sale',
      entityId: Number(id),
      details: {
        sale_number: sale.sale_number,
        reason,
        operator: userName,
        authorized_by: authorizedBy,
        total_before_cents: totalBefore,
        total_after_cents: total,
        delta_cents: delta,
        items_before: prevItems,
        items_after: resolvedItems,
        note: 'Administrador autorizou alteração',
      },
      userName,
    });

    return getSaleById(id);
  })();
}
