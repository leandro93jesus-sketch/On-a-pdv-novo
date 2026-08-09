import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { getCurrentOperator } from './settingsService.js';
import { writeAudit } from './auditService.js';

const MANUAL_TYPES = new Set(['entry', 'exit', 'adjust_in', 'adjust_out', 'purchase', 'return']);

function assertPositiveQty(quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new AppError('Quantidade deve ser um inteiro > 0', {
      status: 400,
      code: 'INVALID_QUANTITY',
    });
  }
  return qty;
}

export function listStock({ q, onlyAlerts = false } = {}) {
  const db = getDb();
  const where = ['p.active = 1'];
  const params = {};
  if (q && String(q).trim()) {
    where.push('(p.name LIKE @term OR p.sku LIKE @term OR p.barcode LIKE @term OR p.category LIKE @term)');
    params.term = `%${String(q).trim()}%`;
  }
  if (onlyAlerts) {
    where.push('p.stock_qty <= p.min_stock_qty');
  }

  const rows = db
    .prepare(
      `SELECT
         p.id, p.name, p.sku, p.barcode, p.category, p.unit,
         p.stock_qty, p.min_stock_qty, p.allow_negative_stock,
         (
           SELECT sm.created_at FROM stock_movements sm
           WHERE sm.product_id = p.id
           ORDER BY sm.id DESC LIMIT 1
         ) AS last_movement_at,
         (
           SELECT sm.movement_type FROM stock_movements sm
           WHERE sm.product_id = p.id
           ORDER BY sm.id DESC LIMIT 1
         ) AS last_movement_type
       FROM products p
       WHERE ${where.join(' AND ')}
       ORDER BY
         CASE
           WHEN p.stock_qty <= 0 THEN 0
           WHEN p.stock_qty <= p.min_stock_qty THEN 1
           ELSE 2
         END,
         p.name`
    )
    .all(params);

  return rows.map((r) => ({
    ...r,
    situation:
      r.stock_qty <= 0 ? 'zerado' : r.stock_qty <= r.min_stock_qty ? 'baixo' : 'ok',
  }));
}

export function listStockMovements({ productId, limit = 100 } = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const mapRow = (r) => ({
    ...r,
    stock_before:
      r.stock_before != null ? r.stock_before : r.stock_after - r.quantity_delta,
  });
  if (productId) {
    return db
      .prepare(
        `SELECT sm.*, p.name AS product_name, p.sku, p.barcode
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         WHERE sm.product_id = ?
         ORDER BY sm.id DESC
         LIMIT ?`
      )
      .all(Number(productId), safeLimit)
      .map(mapRow);
  }
  return db
    .prepare(
      `SELECT sm.*, p.name AS product_name, p.sku, p.barcode
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       ORDER BY sm.id DESC
       LIMIT ?`
    )
    .all(safeLimit)
    .map(mapRow);
}

/**
 * Aplica movimentação de estoque. Deve ser chamada dentro de transaction quando composta.
 * quantity é sempre positiva; o sinal vem do tipo.
 */
export function applyStockMovement(
  {
    productId,
    movementType,
    quantity,
    reason = null,
    userName = null,
    referenceType = null,
    referenceId = null,
    note = null,
    allowNegative = null,
  },
  { db = getDb(), skipAudit = false } = {}
) {
  if (!MANUAL_TYPES.has(movementType) && !['sale', 'sale_cancel'].includes(movementType)) {
    throw new AppError('Tipo de movimentação inválido', {
      status: 400,
      code: 'INVALID_STOCK_TYPE',
    });
  }

  const qty = assertPositiveQty(quantity);
  const product = db
    .prepare(
      `SELECT id, name, stock_qty, allow_negative_stock, active FROM products WHERE id = ?`
    )
    .get(productId);
  if (!product || !product.active) {
    throw new AppError('Produto não encontrado ou inativo', {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  }

  let delta;
  if (['entry', 'adjust_in', 'purchase', 'return', 'sale_cancel'].includes(movementType)) {
    delta = qty;
  } else {
    delta = -qty;
  }

  const nextQty = product.stock_qty + delta;
  const canNegative = allowNegative == null ? Boolean(product.allow_negative_stock) : allowNegative;
  if (nextQty < 0 && !canNegative) {
    throw new AppError(
      `Estoque insuficiente para "${product.name}". Disponível: ${product.stock_qty}`,
      {
        status: 409,
        code: 'STOCK_INSUFFICIENT',
        details: { product_id: product.id, available: product.stock_qty, requested: qty },
      }
    );
  }

  const stockBefore = product.stock_qty;

  db.prepare(
    `UPDATE products SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(nextQty, product.id);

  const info = db
    .prepare(
      `INSERT INTO stock_movements (
         product_id, movement_type, quantity_delta, stock_before, stock_after,
         reason, user_name, reference_type, reference_id, note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      product.id,
      movementType,
      delta,
      stockBefore,
      nextQty,
      reason,
      userName || getCurrentOperator(),
      referenceType,
      referenceId,
      note
    );

  if (!skipAudit) {
    writeAudit({
      action: `stock.${movementType}`,
      entityType: 'product',
      entityId: product.id,
      details: { movement_id: Number(info.lastInsertRowid), delta, stock_after: nextQty, reason },
      userName: userName || getCurrentOperator(),
    });
  }

  return {
    movement_id: Number(info.lastInsertRowid),
    product_id: product.id,
    movement_type: movementType,
    quantity_delta: delta,
    stock_before: stockBefore,
    stock_after: nextQty,
  };
}

export function createManualStockMovement(payload = {}) {
  const db = getDb();
  const type = String(payload.movement_type || '').trim();
  if (!MANUAL_TYPES.has(type)) {
    throw new AppError('Tipo de movimentação manual inválido', {
      status: 400,
      code: 'INVALID_STOCK_TYPE',
    });
  }
  if (!payload.reason || !String(payload.reason).trim()) {
    throw new AppError('Motivo é obrigatório', { status: 400, code: 'REASON_REQUIRED' });
  }

  return db.transaction(() =>
    applyStockMovement({
      productId: Number(payload.product_id),
      movementType: type,
      quantity: payload.quantity,
      reason: String(payload.reason).trim(),
      userName: payload.user_name,
      referenceType: payload.reference_type || 'manual',
      referenceId: payload.reference_id ?? null,
      note: payload.note || null,
    })
  )();
}

/**
 * DEFINIR SALDO: gera movimentação com delta = novo - atual. Nunca altera sem movement.
 */
export function setStockBalance(payload = {}) {
  const db = getDb();
  const productId = Number(payload.product_id);
  const newQty = Number(payload.new_qty ?? payload.target_qty);
  if (!Number.isInteger(productId)) {
    throw new AppError('Produto inválido', { status: 400, code: 'INVALID_PRODUCT' });
  }
  if (!Number.isInteger(newQty) || newQty < 0) {
    throw new AppError('Novo saldo deve ser inteiro >= 0', { status: 400, code: 'INVALID_BALANCE' });
  }
  if (!payload.reason || !String(payload.reason).trim()) {
    throw new AppError('Motivo é obrigatório', { status: 400, code: 'REASON_REQUIRED' });
  }

  return db.transaction(() => {
    const product = db
      .prepare(`SELECT id, name, stock_qty, active FROM products WHERE id = ?`)
      .get(productId);
    if (!product || !product.active) {
      throw new AppError('Produto não encontrado ou inativo', {
        status: 404,
        code: 'PRODUCT_NOT_FOUND',
      });
    }
    const before = product.stock_qty;
    const delta = newQty - before;
    if (delta === 0) {
      throw new AppError('Novo saldo é igual ao estoque atual', {
        status: 400,
        code: 'BALANCE_UNCHANGED',
      });
    }
    const result = applyStockMovement({
      productId,
      movementType: delta > 0 ? 'adjust_in' : 'adjust_out',
      quantity: Math.abs(delta),
      reason: String(payload.reason).trim(),
      userName: payload.user_name,
      referenceType: 'set_balance',
      referenceId: productId,
      note:
        payload.note ||
        `Definir saldo: ${before} → ${newQty} (Δ ${delta > 0 ? '+' : ''}${delta})`,
      allowNegative: false,
    });
    return {
      ...result,
      operation: 'set_balance',
      stock_before: before,
      stock_after: newQty,
      quantity_delta: delta,
      product_name: product.name,
    };
  })();
}

/** Histórico completo do produto: vendas, compras, devoluções, ajustes/entradas/saídas. */
export function getProductStockHistory(productId, { limit = 200 } = {}) {
  const db = getDb();
  const id = Number(productId);
  const product = db
    .prepare(
      `SELECT id, name, sku, barcode, category, stock_qty, price_cents, active
       FROM products WHERE id = ?`
    )
    .get(id);
  if (!product) {
    throw new AppError('Produto não encontrado', { status: 404, code: 'PRODUCT_NOT_FOUND' });
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);

  const movements = db
    .prepare(
      `SELECT
         id, movement_type, quantity_delta,
         COALESCE(stock_before, stock_after - quantity_delta) AS stock_before,
         stock_after, reason, note, user_name, reference_type, reference_id, created_at
       FROM stock_movements
       WHERE product_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(id, safeLimit);

  const sales = db
    .prepare(
      `SELECT s.id AS sale_id, s.sale_number, s.created_at, s.status,
              si.quantity, si.unit_price_cents, si.line_total_cents, si.is_misc
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id = ?
       ORDER BY s.id DESC
       LIMIT ?`
    )
    .all(id, safeLimit);

  let purchases = [];
  try {
    purchases = db
      .prepare(
        `SELECT p.id AS purchase_id, p.purchase_number, p.status, p.purchase_date,
                p.completed_at, p.created_at, pi.quantity, pi.unit_cost_cents, pi.line_total_cents
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
         WHERE pi.product_id = ?
         ORDER BY p.id DESC
         LIMIT ?`
      )
      .all(id, safeLimit);
  } catch {
    purchases = [];
  }

  let returns = [];
  try {
    returns = db
      .prepare(
        `SELECT r.id AS return_id, r.status, r.created_at,
                ri.quantity, ri.unit_price_cents
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         WHERE ri.product_id = ?
         ORDER BY r.id DESC
         LIMIT ?`
      )
      .all(id, safeLimit);
  } catch {
    returns = [];
  }

  return {
    product,
    movements,
    sales,
    purchases,
    returns,
    summary: {
      movements: movements.length,
      sales: sales.length,
      purchases: purchases.length,
      returns: returns.length,
    },
  };
}
