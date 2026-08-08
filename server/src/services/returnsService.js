import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { applyStockMovement } from './stockService.js';
import { writeAudit } from './auditService.js';
import { getCurrentOperator } from './settingsService.js';

function nextReturnNumber(db) {
  const seq = Number(db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM returns').get().m) + 1;
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `DV-${stamp}-${String(seq).padStart(6, '0')}`;
}

function alreadyReturnedQty(db, saleItemId) {
  return Number(
    db
      .prepare(
        `SELECT COALESCE(SUM(ri.quantity),0) AS q
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         WHERE ri.sale_item_id = ? AND r.status = 'completed'`
      )
      .get(saleItemId).q
  );
}

export function getReturnById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM returns WHERE id = ?').get(Number(id));
  if (!row) throw new AppError('Devolução não encontrada', { status: 404, code: 'RETURN_NOT_FOUND' });
  const items = db.prepare('SELECT * FROM return_items WHERE return_id = ? ORDER BY id').all(Number(id));
  const sale = db.prepare('SELECT id, sale_number, status, total_cents, created_at FROM sales WHERE id = ?').get(row.sale_id);
  return { ...row, items, sale };
}

export function listReturns({ limit = 50, saleId } = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  if (saleId) {
    return db
      .prepare(
        `SELECT r.*, s.sale_number FROM returns r
         JOIN sales s ON s.id = r.sale_id
         WHERE r.sale_id = ? ORDER BY r.id DESC LIMIT ?`
      )
      .all(Number(saleId), safeLimit);
  }
  return db
    .prepare(
      `SELECT r.*, s.sale_number FROM returns r
       JOIN sales s ON s.id = r.sale_id
       ORDER BY r.id DESC LIMIT ?`
    )
    .all(safeLimit);
}

export function createReturn(payload = {}) {
  const db = getDb();
  const saleId = Number(payload.sale_id);
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) throw new AppError('Motivo é obrigatório', { status: 400, code: 'REASON_REQUIRED' });
  const userName = String(payload.user_name || getCurrentOperator()).trim();
  const itemsInput = payload.items;
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new AppError('Informe os itens da devolução', { status: 400, code: 'EMPTY_ITEMS' });
  }

  return db.transaction(() => {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    if (!sale) throw new AppError('Venda não encontrada', { status: 404, code: 'SALE_NOT_FOUND' });
    if (sale.status === 'cancelled') {
      throw new AppError('Não é possível devolver venda cancelada', { status: 409, code: 'SALE_CANCELLED' });
    }

    const resolved = [];
    let total = 0;
    for (const [idx, raw] of itemsInput.entries()) {
      const saleItem = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(Number(raw.sale_item_id), saleId);
      if (!saleItem) {
        throw new AppError(`Item da venda inválido (${idx + 1})`, { status: 400, code: 'INVALID_SALE_ITEM' });
      }
      const qty = Number(raw.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new AppError(`Quantidade inválida no item ${idx + 1}`, { status: 400, code: 'INVALID_QUANTITY' });
      }
      const returned = alreadyReturnedQty(db, saleItem.id);
      const available = saleItem.quantity - returned;
      if (qty > available) {
        throw new AppError(
          `Quantidade devolvida acima do permitido para "${saleItem.name}". Disponível: ${available}`,
          { status: 409, code: 'RETURN_QTY_EXCEEDED', details: { available, requested: qty } }
        );
      }
      const lineTotal = Math.round((saleItem.line_total_cents / saleItem.quantity) * qty);
      resolved.push({
        sale_item_id: saleItem.id,
        product_id: saleItem.product_id,
        product_name: saleItem.name,
        quantity: qty,
        unit_price_cents: saleItem.unit_price_cents,
        line_total_cents: lineTotal,
        is_misc: saleItem.is_misc,
      });
      total += lineTotal;
    }

    const return_number = nextReturnNumber(db);
    const info = db
      .prepare(
        `INSERT INTO returns (return_number, sale_id, status, reason, user_name, total_cents)
         VALUES (?, ?, 'completed', ?, ?, ?)`
      )
      .run(return_number, saleId, reason, userName, total);
    const id = Number(info.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO return_items (
         return_id, sale_item_id, product_id, product_name, quantity,
         unit_price_cents, line_total_cents, is_misc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const item of resolved) {
      insertItem.run(
        id,
        item.sale_item_id,
        item.product_id,
        item.product_name,
        item.quantity,
        item.unit_price_cents,
        item.line_total_cents,
        item.is_misc
      );
      if (!item.is_misc && item.product_id) {
        applyStockMovement(
          {
            productId: item.product_id,
            movementType: 'return',
            quantity: item.quantity,
            reason: `Devolução ${return_number}: ${reason}`,
            userName,
            referenceType: 'return',
            referenceId: id,
            note: reason,
          },
          { db, skipAudit: true }
        );
      }
    }

    writeAudit({
      action: 'return.create',
      entityType: 'return',
      entityId: id,
      details: { sale_id: saleId, return_number, total_cents: total, reason },
      userName,
    });
    return getReturnById(id);
  })();
}
