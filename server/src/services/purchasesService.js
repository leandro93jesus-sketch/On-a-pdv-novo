import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { assertNonNegativeCents } from '../utils/money.js';
import { getSupplierById } from './suppliersService.js';
import { applyStockMovement } from './stockService.js';
import { writeAudit } from './auditService.js';
import { getCurrentOperator } from './settingsService.js';

function nextPurchaseNumber(db) {
  const seq = Number(db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM purchases').get().m) + 1;
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `CP-${stamp}-${String(seq).padStart(6, '0')}`;
}

function getPurchaseRow(id) {
  const row = getDb().prepare('SELECT * FROM purchases WHERE id = ?').get(Number(id));
  if (!row) throw new AppError('Compra não encontrada', { status: 404, code: 'PURCHASE_NOT_FOUND' });
  return row;
}

export function getPurchaseById(id) {
  const db = getDb();
  const purchase = getPurchaseRow(id);
  const items = db
    .prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id')
    .all(Number(id));
  const supplier = db.prepare('SELECT id, name, trade_name, document FROM suppliers WHERE id = ?').get(purchase.supplier_id);
  return { ...purchase, items, supplier };
}

export function listPurchases({ limit = 50, status, supplierId } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (supplierId) {
    where.push('p.supplier_id = ?');
    params.push(Number(supplierId));
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  params.push(safeLimit);
  return db
    .prepare(
      `SELECT p.*, s.name AS supplier_name
       FROM purchases p
       JOIN suppliers s ON s.id = p.supplier_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.id DESC LIMIT ?`
    )
    .all(...params);
}

function resolveItems(db, itemsInput) {
  if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
    throw new AppError('A compra precisa ter itens', { status: 400, code: 'EMPTY_ITEMS' });
  }
  const getProduct = db.prepare('SELECT id, name, active FROM products WHERE id = ?');
  const items = [];
  for (const [idx, raw] of itemsInput.entries()) {
    const product = getProduct.get(Number(raw.product_id));
    if (!product || !product.active) {
      throw new AppError(`Produto inválido no item ${idx + 1}`, { status: 400, code: 'PRODUCT_NOT_FOUND' });
    }
    const quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new AppError(`Quantidade inválida no item ${idx + 1}`, { status: 400, code: 'INVALID_QUANTITY' });
    }
    const unitCost = assertNonNegativeCents(raw.unit_cost_cents ?? 0, 'unit_cost_cents');
    const discount = assertNonNegativeCents(raw.discount_cents ?? 0, 'item.discount_cents');
    const lineTotal = unitCost * quantity - discount;
    if (lineTotal < 0) {
      throw new AppError(`Desconto inválido no item ${product.name}`, { status: 400, code: 'INVALID_DISCOUNT' });
    }
    items.push({
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_cost_cents: unitCost,
      discount_cents: discount,
      line_total_cents: lineTotal,
    });
  }
  return items;
}

/**
 * Cria e opcionalmente conclui compra.
 * status: draft | completed (default completed for API convenience when finalize=true)
 */
export function createPurchase(payload = {}) {
  const db = getDb();
  const supplier = getSupplierById(Number(payload.supplier_id));
  if (!supplier.active) throw new AppError('Fornecedor inativo', { status: 400, code: 'SUPPLIER_INACTIVE' });

  const items = resolveItems(db, payload.items);
  const subtotal = items.reduce((s, i) => s + i.line_total_cents, 0);
  const discount = assertNonNegativeCents(payload.discount_cents ?? 0, 'discount_cents');
  const freight = assertNonNegativeCents(payload.freight_cents ?? 0, 'freight_cents');
  const other = assertNonNegativeCents(payload.other_costs_cents ?? 0, 'other_costs_cents');
  if (discount > subtotal) throw new AppError('Desconto maior que o subtotal', { status: 400, code: 'INVALID_DISCOUNT' });
  const total = subtotal - discount + freight + other;
  const status = payload.status === 'draft' ? 'draft' : 'completed';
  const purchaseDate = payload.purchase_date ? String(payload.purchase_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const documentNumber = payload.document_number ? String(payload.document_number).trim() : null;
  const notes = payload.notes ? String(payload.notes).trim() : null;

  return db.transaction(() => {
    const purchase_number = nextPurchaseNumber(db);
    const info = db
      .prepare(
        `INSERT INTO purchases (
           purchase_number, supplier_id, status, document_number, purchase_date,
           subtotal_cents, discount_cents, freight_cents, other_costs_cents, total_cents, notes,
           completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        purchase_number,
        supplier.id,
        status,
        documentNumber,
        purchaseDate,
        subtotal,
        discount,
        freight,
        other,
        total,
        notes,
        status === 'completed' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null
      );
    const id = Number(info.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO purchase_items (
         purchase_id, product_id, product_name, quantity, unit_cost_cents, discount_cents, line_total_cents
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of items) {
      insertItem.run(id, item.product_id, item.product_name, item.quantity, item.unit_cost_cents, item.discount_cents, item.line_total_cents);
    }

    if (status === 'completed') {
      applyPurchaseStockAndCost(db, id, items);
    }

    writeAudit({
      action: status === 'completed' ? 'purchase.complete' : 'purchase.draft',
      entityType: 'purchase',
      entityId: id,
      details: { purchase_number, total_cents: total, supplier_id: supplier.id },
    });
    return getPurchaseById(id);
  })();
}

function applyPurchaseStockAndCost(db, purchaseId, items) {
  for (const item of items) {
    applyStockMovement(
      {
        productId: item.product_id,
        movementType: 'purchase',
        quantity: item.quantity,
        reason: `Compra #${purchaseId}`,
        referenceType: 'purchase',
        referenceId: purchaseId,
        note: `Custo unitário ${item.unit_cost_cents}`,
      },
      { db, skipAudit: true }
    );
    // Regra segura: atualiza custo para o custo da última compra
    db.prepare(
      `UPDATE products SET cost_cents = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(item.unit_cost_cents, item.product_id);
  }
}

export function completePurchase(id) {
  const db = getDb();
  return db.transaction(() => {
    const purchase = getPurchaseRow(id);
    if (purchase.status !== 'draft') {
      throw new AppError('Somente rascunhos podem ser concluídos', { status: 409, code: 'INVALID_STATUS' });
    }
    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(Number(id));
    applyPurchaseStockAndCost(db, Number(id), items);
    db.prepare(
      `UPDATE purchases SET status='completed', completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    ).run(Number(id));
    writeAudit({ action: 'purchase.complete', entityType: 'purchase', entityId: Number(id) });
    return getPurchaseById(id);
  })();
}

export function cancelPurchase(id, payload = {}) {
  const db = getDb();
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) throw new AppError('Motivo do cancelamento é obrigatório', { status: 400, code: 'CANCEL_REASON_REQUIRED' });
  const userName = String(payload.user_name || getCurrentOperator()).trim();

  return db.transaction(() => {
    const purchase = getPurchaseRow(id);
    if (purchase.status === 'cancelled') {
      throw new AppError('Compra já cancelada', { status: 409, code: 'ALREADY_CANCELLED' });
    }
    if (purchase.status === 'completed') {
      const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(Number(id));
      for (const item of items) {
        applyStockMovement(
          {
            productId: item.product_id,
            movementType: 'exit',
            quantity: item.quantity,
            reason: `Cancelamento compra ${purchase.purchase_number}: ${reason}`,
            userName,
            referenceType: 'purchase',
            referenceId: Number(id),
            note: reason,
          },
          { db, skipAudit: true }
        );
      }
    }
    db.prepare(
      `UPDATE purchases SET status='cancelled', cancelled_at=datetime('now'), cancelled_by=?, cancel_reason=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(userName, reason, Number(id));
    writeAudit({
      action: 'purchase.cancel',
      entityType: 'purchase',
      entityId: Number(id),
      details: { reason, userName },
      userName,
    });
    return getPurchaseById(id);
  })();
}
