import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { assertNonNegativeCents } from '../utils/money.js';
import { applyStockMovement } from './stockService.js';
import { writeAudit } from './auditService.js';
import { getCurrentOperator } from './settingsService.js';
import { findSimilarNameConflicts } from './duplicateProductsService.js';

const PRODUCT_FIELDS = `
  p.id, p.sku, p.barcode, p.name, p.category, p.unit,
  p.price_cents, p.cost_cents, p.stock_qty, p.min_stock_qty,
  p.allow_negative_stock, p.supplier_id, p.notes, p.active,
  p.created_at, p.updated_at,
  s.name AS supplier_name
`;

function normalizeOptionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function mapProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    category: row.category,
    unit: row.unit,
    price_cents: row.price_cents,
    cost_cents: row.cost_cents,
    stock_qty: row.stock_qty,
    min_stock_qty: row.min_stock_qty,
    allow_negative_stock: row.allow_negative_stock,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name ?? null,
    notes: row.notes,
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    situation:
      row.stock_qty <= 0 ? 'zerado' : row.stock_qty <= row.min_stock_qty ? 'baixo' : 'ok',
  };
}

function assertUniqueCodes(db, { sku, barcode, excludeId = null }) {
  if (sku) {
    const row = db
      .prepare(
        `SELECT id FROM products WHERE sku = ? AND (? IS NULL OR id != ?)`
      )
      .get(sku, excludeId, excludeId);
    if (row) {
      throw new AppError('Código interno já cadastrado', {
        status: 409,
        code: 'DUPLICATE_SKU',
      });
    }
  }
  if (barcode) {
    const row = db
      .prepare(
        `SELECT id FROM products WHERE barcode = ? AND (? IS NULL OR id != ?)`
      )
      .get(barcode, excludeId, excludeId);
    if (row) {
      throw new AppError('Código de barras já cadastrado', {
        status: 409,
        code: 'DUPLICATE_BARCODE',
      });
    }
  }
}

export function searchProducts({
  q,
  barcode,
  includeInactive = false,
  category = null,
} = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  if (!includeInactive) where.push('p.active = 1');

  if (barcode) {
    where.push('p.barcode = @barcode');
    params.barcode = String(barcode).trim();
  } else if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    where.push('(p.name LIKE @term OR p.sku LIKE @term OR p.barcode LIKE @term OR p.category LIKE @term)');
    params.term = term;
  }

  if (category && String(category).trim()) {
    where.push('p.category = @category');
    params.category = String(category).trim();
  }

  const rows = db
    .prepare(
      `SELECT ${PRODUCT_FIELDS}
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.name
       LIMIT 300`
    )
    .all(params);

  return rows.map(mapProduct);
}

export function getProductById(id) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT ${PRODUCT_FIELDS}
       FROM products p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.id = ?`
    )
    .get(id);
  if (!row) {
    throw new AppError('Produto não encontrado', { status: 404, code: 'PRODUCT_NOT_FOUND' });
  }
  return mapProduct(row);
}

export function getProductByBarcode(barcode) {
  const code = String(barcode || '').trim();
  if (!code) {
    throw new AppError('Código de barras é obrigatório', { status: 400, code: 'BARCODE_REQUIRED' });
  }
  const rows = searchProducts({ barcode: code, includeInactive: false });
  if (!rows.length) {
    throw new AppError('Produto não encontrado para o código informado', {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  }
  return rows[0];
}

export function createProduct(payload = {}) {
  const db = getDb();
  const name = normalizeOptionalText(payload.name);
  if (!name) {
    throw new AppError('Nome é obrigatório', { status: 400, code: 'NAME_REQUIRED' });
  }

  const sku = normalizeOptionalText(payload.sku);
  const barcode = normalizeOptionalText(payload.barcode);
  const category = normalizeOptionalText(payload.category) || 'Geral';
  const unit = normalizeOptionalText(payload.unit) || 'UN';
  const price_cents = assertNonNegativeCents(payload.price_cents ?? 0, 'price_cents');
  const cost_cents = assertNonNegativeCents(payload.cost_cents ?? 0, 'cost_cents');
  const min_stock_qty = Number(payload.min_stock_qty ?? 0);
  if (!Number.isInteger(min_stock_qty) || min_stock_qty < 0) {
    throw new AppError('Estoque mínimo inválido', { status: 400, code: 'INVALID_MIN_STOCK' });
  }
  const initialStock = Number(payload.stock_qty ?? 0);
  if (!Number.isInteger(initialStock) || initialStock < 0) {
    throw new AppError('Estoque inicial inválido', { status: 400, code: 'INVALID_STOCK' });
  }
  const supplier_id =
    payload.supplier_id == null || payload.supplier_id === ''
      ? null
      : Number(payload.supplier_id);
  if (supplier_id != null) {
    const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplier_id);
    if (!sup) {
      throw new AppError('Fornecedor não encontrado', { status: 400, code: 'SUPPLIER_NOT_FOUND' });
    }
  }
  const notes = normalizeOptionalText(payload.notes);
  const allow_negative_stock = payload.allow_negative_stock ? 1 : 0;
  const active = payload.active === 0 || payload.active === false ? 0 : 1;
  const confirmSimilar =
    payload.confirm_similar_name === true ||
    payload.confirm_similar_name === 1 ||
    payload.confirm_similar_name === '1';

  const similar = findSimilarNameConflicts(name);
  if (similar.length && !confirmSimilar) {
    throw new AppError(
      'Existe produto com nome semelhante. Confirme para continuar.',
      {
        status: 409,
        code: 'SIMILAR_NAME',
        details: { similar },
      }
    );
  }

  return db.transaction(() => {
    assertUniqueCodes(db, { sku, barcode });
    const info = db
      .prepare(
        `INSERT INTO products (
           sku, barcode, name, category, unit, price_cents, cost_cents,
           stock_qty, min_stock_qty, allow_negative_stock, supplier_id, notes, active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
      )
      .run(
        sku,
        barcode,
        name,
        category,
        unit,
        price_cents,
        cost_cents,
        min_stock_qty,
        allow_negative_stock,
        supplier_id,
        notes,
        active
      );
    const id = Number(info.lastInsertRowid);

    if (initialStock > 0) {
      applyStockMovement(
        {
          productId: id,
          movementType: 'entry',
          quantity: initialStock,
          reason: 'Estoque inicial no cadastro',
          referenceType: 'product',
          referenceId: id,
        },
        { db, skipAudit: true }
      );
    }

    writeAudit({
      action: 'product.create',
      entityType: 'product',
      entityId: id,
      details: { name, sku, barcode, initialStock },
      userName: getCurrentOperator(),
    });

    return getProductById(id);
  })();
}

export function updateProduct(id, payload = {}) {
  const db = getDb();
  const current = getProductById(id);

  const name = payload.name != null ? normalizeOptionalText(payload.name) : current.name;
  if (!name) {
    throw new AppError('Nome é obrigatório', { status: 400, code: 'NAME_REQUIRED' });
  }

  const sku = payload.sku !== undefined ? normalizeOptionalText(payload.sku) : current.sku;
  const barcode =
    payload.barcode !== undefined ? normalizeOptionalText(payload.barcode) : current.barcode;
  const category =
    payload.category != null ? normalizeOptionalText(payload.category) || 'Geral' : current.category;
  const unit = payload.unit != null ? normalizeOptionalText(payload.unit) || 'UN' : current.unit;
  const price_cents =
    payload.price_cents != null
      ? assertNonNegativeCents(payload.price_cents, 'price_cents')
      : current.price_cents;
  const cost_cents =
    payload.cost_cents != null
      ? assertNonNegativeCents(payload.cost_cents, 'cost_cents')
      : current.cost_cents;
  const min_stock_qty =
    payload.min_stock_qty != null ? Number(payload.min_stock_qty) : current.min_stock_qty;
  if (!Number.isInteger(min_stock_qty) || min_stock_qty < 0) {
    throw new AppError('Estoque mínimo inválido', { status: 400, code: 'INVALID_MIN_STOCK' });
  }
  const supplier_id =
    payload.supplier_id === undefined
      ? current.supplier_id
      : payload.supplier_id == null || payload.supplier_id === ''
        ? null
        : Number(payload.supplier_id);
  const notes = payload.notes !== undefined ? normalizeOptionalText(payload.notes) : current.notes;
  const allow_negative_stock =
    payload.allow_negative_stock == null
      ? current.allow_negative_stock
      : payload.allow_negative_stock
        ? 1
        : 0;
  const active =
    payload.active == null ? current.active : payload.active === 0 || payload.active === false ? 0 : 1;
  const confirmSimilar =
    payload.confirm_similar_name === true ||
    payload.confirm_similar_name === 1 ||
    payload.confirm_similar_name === '1';

  if (name !== current.name) {
    const similar = findSimilarNameConflicts(name, { excludeId: Number(id) });
    if (similar.length && !confirmSimilar) {
      throw new AppError(
        'Existe produto com nome semelhante. Confirme para continuar.',
        {
          status: 409,
          code: 'SIMILAR_NAME',
          details: { similar },
        }
      );
    }
  }

  return db.transaction(() => {
    assertUniqueCodes(db, { sku, barcode, excludeId: Number(id) });
    db.prepare(
      `UPDATE products SET
         sku = ?, barcode = ?, name = ?, category = ?, unit = ?,
         price_cents = ?, cost_cents = ?, min_stock_qty = ?,
         allow_negative_stock = ?, supplier_id = ?, notes = ?, active = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      sku,
      barcode,
      name,
      category,
      unit,
      price_cents,
      cost_cents,
      min_stock_qty,
      allow_negative_stock,
      supplier_id,
      notes,
      active,
      Number(id)
    );

    if (price_cents !== current.price_cents) {
      db.prepare(
        `INSERT INTO product_price_history (product_id, old_price_cents, new_price_cents, user_name)
         VALUES (?, ?, ?, ?)`
      ).run(Number(id), current.price_cents, price_cents, getCurrentOperator());
      writeAudit({
        action: 'product.price_change',
        entityType: 'product',
        entityId: Number(id),
        details: {
          old_price_cents: current.price_cents,
          new_price_cents: price_cents,
        },
      });
    }

    writeAudit({
      action: 'product.update',
      entityType: 'product',
      entityId: Number(id),
      details: { name, sku, barcode, active },
    });

    return getProductById(id);
  })();
}

export function listProductPriceHistory(productId, { limit = 50 } = {}) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM product_price_history WHERE product_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(Number(productId), Math.min(Math.max(Number(limit) || 50, 1), 200));
}

export function deleteOrInactivateProduct(id) {
  const db = getDb();
  const product = getProductById(id);
  const saleCount = db
    .prepare('SELECT COUNT(*) AS c FROM sale_items WHERE product_id = ?')
    .get(Number(id)).c;
  const movCount = db
    .prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE product_id = ?')
    .get(Number(id)).c;

  if (saleCount > 0 || movCount > 0) {
    db.prepare(
      `UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?`
    ).run(Number(id));
    writeAudit({
      action: 'product.inactivate',
      entityType: 'product',
      entityId: Number(id),
      details: { reason: 'possui histórico', saleCount, movCount },
    });
    return { ...getProductById(id), inactivated: true, deleted: false };
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(Number(id));
  writeAudit({
    action: 'product.delete',
    entityType: 'product',
    entityId: Number(id),
    details: { name: product.name },
  });
  return { id: Number(id), deleted: true, inactivated: false };
}
