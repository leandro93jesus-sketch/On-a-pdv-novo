import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { assertNonNegativeCents } from '../utils/money.js';

const PAYMENT_METHODS = new Set(['dinheiro', 'pix', 'cartao']);

function nextSaleNumber(db) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM sales`).get();
  const seq = (row?.c || 0) + 1;
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
    notes: row.notes,
    created_at: row.created_at,
    cancelled_at: row.cancelled_at,
  };
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
      `SELECT id, method, amount_cents, created_at
       FROM sale_payments WHERE sale_id = ? ORDER BY id`
    )
    .all(id);

  return {
    ...mapSale(sale),
    items,
    payments,
    payment_method: payments[0]?.method || null,
  };
}

export function listSales({ limit = 50 } = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = db
    .prepare(
      `SELECT s.*,
         (SELECT method FROM sale_payments sp WHERE sp.sale_id = s.id ORDER BY sp.id LIMIT 1) AS payment_method
       FROM sales s
       ORDER BY s.id DESC
       LIMIT ?`
    )
    .all(safeLimit);

  return rows.map((r) => ({
    ...mapSale(r),
    payment_method: r.payment_method,
  }));
}

/**
 * Finaliza uma venda.
 * Payload:
 * {
 *   items: [{ product_id?, name?, quantity, unit_price_cents?, discount_cents?, is_misc? }],
 *   discount_cents?: number,
 *   payments?: [{ method, amount_cents }],
 *   payment_method?: string, // atalho etapa 1
 *   notes?: string
 * }
 */
export function createSale(payload = {}) {
  const db = getDb();
  const itemsInput = payload.items;
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new AppError('A venda precisa ter ao menos um item', {
      status: 400,
      code: 'EMPTY_CART',
    });
  }

  const saleDiscount = assertNonNegativeCents(payload.discount_cents ?? 0, 'discount_cents');
  const notes = typeof payload.notes === 'string' ? payload.notes.trim() : null;

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
        product: null,
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
      product,
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

  // Pagamentos: aceita array ou atalho payment_method (etapa 1)
  let payments = Array.isArray(payload.payments) ? payload.payments : null;
  if (!payments || payments.length === 0) {
    const method = String(payload.payment_method || 'dinheiro').trim().toLowerCase();
    if (!PAYMENT_METHODS.has(method)) {
      throw new AppError('Forma de pagamento inválida', {
        status: 400,
        code: 'INVALID_PAYMENT_METHOD',
      });
    }
    payments = [{ method, amount_cents: total }];
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
    const amount = assertNonNegativeCents(p.amount_cents ?? total, 'payment.amount_cents');
    paymentsSum += amount;
    return { method, amount_cents: amount };
  });

  if (paymentsSum < total) {
    throw new AppError('Valor pago insuficiente para cobrir o total da venda', {
      status: 400,
      code: 'PAYMENT_INSUFFICIENT',
    });
  }

  const insertSale = db.prepare(`
    INSERT INTO sales (sale_number, status, subtotal_cents, discount_cents, total_cents, notes)
    VALUES (@sale_number, 'completed', @subtotal_cents, @discount_cents, @total_cents, @notes)
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
    INSERT INTO sale_payments (sale_id, method, amount_cents)
    VALUES (?, ?, ?)
  `);
  const updateStock = db.prepare(`
    UPDATE products
    SET stock_qty = @stock_qty, updated_at = datetime('now')
    WHERE id = @id
  `);
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (
      product_id, movement_type, quantity_delta, stock_after, reference_type, reference_id, note
    ) VALUES (?, 'sale', ?, ?, 'sale', ?, ?)
  `);
  const lockProduct = db.prepare(
    `SELECT id, name, stock_qty, allow_negative_stock FROM products WHERE id = ?`
  );

  const saleId = db.transaction(() => {
    // Valida e baixa estoque
    for (const item of resolvedItems) {
      if (item.is_misc || !item.product_id) continue;
      const current = lockProduct.get(item.product_id);
      if (!current) {
        throw new AppError(`Produto ${item.product_id} não encontrado`, {
          status: 400,
          code: 'PRODUCT_NOT_FOUND',
        });
      }
      const nextQty = current.stock_qty - item.quantity;
      if (nextQty < 0 && !current.allow_negative_stock) {
        throw new AppError(
          `Estoque insuficiente para "${current.name}". Disponível: ${current.stock_qty}, solicitado: ${item.quantity}`,
          {
            status: 409,
            code: 'STOCK_INSUFFICIENT',
            details: {
              product_id: current.id,
              available: current.stock_qty,
              requested: item.quantity,
            },
          }
        );
      }
      item._stock_after = nextQty;
    }

    const sale_number = nextSaleNumber(db);
    const info = insertSale.run({
      sale_number,
      subtotal_cents: subtotal,
      discount_cents: saleDiscount,
      total_cents: total,
      notes,
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

      if (!item.is_misc && item.product_id) {
        updateStock.run({ id: item.product_id, stock_qty: item._stock_after });
        insertMovement.run(
          item.product_id,
          -item.quantity,
          item._stock_after,
          id,
          `Venda ${sale_number}`
        );
      }
    }

    for (const p of normalizedPayments) {
      insertPayment.run(id, p.method, p.amount_cents);
    }

    return id;
  })();

  return getSaleById(saleId);
}
