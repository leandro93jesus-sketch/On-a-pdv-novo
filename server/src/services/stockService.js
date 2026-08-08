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
      .all(Number(productId), safeLimit);
  }
  return db
    .prepare(
      `SELECT sm.*, p.name AS product_name, p.sku, p.barcode
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       ORDER BY sm.id DESC
       LIMIT ?`
    )
    .all(safeLimit);
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

  db.prepare(
    `UPDATE products SET stock_qty = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(nextQty, product.id);

  const info = db
    .prepare(
      `INSERT INTO stock_movements (
         product_id, movement_type, quantity_delta, stock_after,
         reason, user_name, reference_type, reference_id, note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      product.id,
      movementType,
      delta,
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
