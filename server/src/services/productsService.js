import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';

const PRODUCT_FIELDS = `
  id, sku, barcode, name, category, price_cents, cost_cents,
  stock_qty, allow_negative_stock, active, created_at, updated_at
`;

export function searchProducts({ q, barcode, includeInactive = false } = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  if (!includeInactive) {
    where.push('active = 1');
  }

  if (barcode) {
    where.push('barcode = @barcode');
    params.barcode = String(barcode).trim();
  } else if (q && String(q).trim()) {
    const term = `%${String(q).trim()}%`;
    where.push('(name LIKE @term OR sku LIKE @term OR barcode LIKE @term OR category LIKE @term)');
    params.term = term;
  }

  const sql = `
    SELECT ${PRODUCT_FIELDS}
    FROM products
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY name
    LIMIT 200
  `;

  return db.prepare(sql).all(params);
}

export function getProductById(id) {
  const db = getDb();
  const product = db
    .prepare(`SELECT ${PRODUCT_FIELDS} FROM products WHERE id = ?`)
    .get(id);
  if (!product) {
    throw new AppError('Produto não encontrado', { status: 404, code: 'PRODUCT_NOT_FOUND' });
  }
  return product;
}

export function getProductByBarcode(barcode) {
  const db = getDb();
  const code = String(barcode || '').trim();
  if (!code) {
    throw new AppError('Código de barras é obrigatório', { status: 400, code: 'BARCODE_REQUIRED' });
  }
  const product = db
    .prepare(`SELECT ${PRODUCT_FIELDS} FROM products WHERE barcode = ? AND active = 1`)
    .get(code);
  if (!product) {
    throw new AppError('Produto não encontrado para o código informado', {
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  }
  return product;
}
