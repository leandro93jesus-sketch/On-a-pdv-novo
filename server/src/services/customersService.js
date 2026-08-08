import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './auditService.js';

function normalizeOptionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function mapCustomer(row) {
  if (!row) return null;
  return { ...row };
}

export function searchCustomers({ q, includeInactive = false } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (!includeInactive) where.push('active = 1');
  if (q && String(q).trim()) {
    where.push(
      `(name LIKE @term OR document LIKE @term OR phone LIKE @term OR whatsapp LIKE @term OR city LIKE @term)`
    );
    params.term = `%${String(q).trim()}%`;
  }
  return db
    .prepare(
      `SELECT * FROM customers
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY name
       LIMIT 200`
    )
    .all(params)
    .map(mapCustomer);
}

export function getCustomerById(id) {
  const row = getDb().prepare('SELECT * FROM customers WHERE id = ?').get(Number(id));
  if (!row) {
    throw new AppError('Cliente não encontrado', { status: 404, code: 'CUSTOMER_NOT_FOUND' });
  }
  return mapCustomer(row);
}

function validatePayload(payload, { partial = false } = {}) {
  const name = payload.name != null ? normalizeOptionalText(payload.name) : undefined;
  if (!partial && !name) {
    throw new AppError('Nome é obrigatório', { status: 400, code: 'NAME_REQUIRED' });
  }
  if (partial && payload.name !== undefined && !name) {
    throw new AppError('Nome é obrigatório', { status: 400, code: 'NAME_REQUIRED' });
  }

  const document = payload.document !== undefined ? normalizeOptionalText(payload.document) : undefined;
  if (document) {
    const digits = document.replace(/\D/g, '');
    if (digits.length !== 11 && digits.length !== 14) {
      throw new AppError('CPF/CNPJ inválido', { status: 400, code: 'INVALID_DOCUMENT' });
    }
  }

  return {
    name,
    document: document === undefined ? undefined : document ? document.replace(/\D/g, '') : null,
    phone: payload.phone !== undefined ? normalizeOptionalText(payload.phone) : undefined,
    whatsapp: payload.whatsapp !== undefined ? normalizeOptionalText(payload.whatsapp) : undefined,
    address: payload.address !== undefined ? normalizeOptionalText(payload.address) : undefined,
    address_number:
      payload.address_number !== undefined ? normalizeOptionalText(payload.address_number) : undefined,
    neighborhood:
      payload.neighborhood !== undefined ? normalizeOptionalText(payload.neighborhood) : undefined,
    city: payload.city !== undefined ? normalizeOptionalText(payload.city) : undefined,
    state: payload.state !== undefined ? normalizeOptionalText(payload.state)?.toUpperCase() : undefined,
    zip_code: payload.zip_code !== undefined ? normalizeOptionalText(payload.zip_code) : undefined,
    notes: payload.notes !== undefined ? normalizeOptionalText(payload.notes) : undefined,
    active:
      payload.active === undefined
        ? undefined
        : payload.active === 0 || payload.active === false
          ? 0
          : 1,
  };
}

export function createCustomer(payload = {}) {
  const db = getDb();
  const data = validatePayload(payload);
  return db.transaction(() => {
    if (data.document) {
      const exists = db.prepare('SELECT id FROM customers WHERE document = ?').get(data.document);
      if (exists) {
        throw new AppError('CPF/CNPJ já cadastrado', { status: 409, code: 'DUPLICATE_DOCUMENT' });
      }
    }
    const info = db
      .prepare(
        `INSERT INTO customers (
           name, document, phone, whatsapp, address, address_number,
           neighborhood, city, state, zip_code, notes, active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.name,
        data.document,
        data.phone,
        data.whatsapp,
        data.address,
        data.address_number,
        data.neighborhood,
        data.city,
        data.state,
        data.zip_code,
        data.notes,
        data.active ?? 1
      );
    const id = Number(info.lastInsertRowid);
    writeAudit({ action: 'customer.create', entityType: 'customer', entityId: id, details: { name: data.name } });
    return getCustomerById(id);
  })();
}

export function updateCustomer(id, payload = {}) {
  const db = getDb();
  const current = getCustomerById(id);
  const data = validatePayload(payload, { partial: true });
  const next = {
    name: data.name ?? current.name,
    document: data.document !== undefined ? data.document : current.document,
    phone: data.phone !== undefined ? data.phone : current.phone,
    whatsapp: data.whatsapp !== undefined ? data.whatsapp : current.whatsapp,
    address: data.address !== undefined ? data.address : current.address,
    address_number: data.address_number !== undefined ? data.address_number : current.address_number,
    neighborhood: data.neighborhood !== undefined ? data.neighborhood : current.neighborhood,
    city: data.city !== undefined ? data.city : current.city,
    state: data.state !== undefined ? data.state : current.state,
    zip_code: data.zip_code !== undefined ? data.zip_code : current.zip_code,
    notes: data.notes !== undefined ? data.notes : current.notes,
    active: data.active !== undefined ? data.active : current.active,
  };

  return db.transaction(() => {
    if (next.document) {
      const exists = db
        .prepare('SELECT id FROM customers WHERE document = ? AND id != ?')
        .get(next.document, Number(id));
      if (exists) {
        throw new AppError('CPF/CNPJ já cadastrado', { status: 409, code: 'DUPLICATE_DOCUMENT' });
      }
    }
    db.prepare(
      `UPDATE customers SET
         name=?, document=?, phone=?, whatsapp=?, address=?, address_number=?,
         neighborhood=?, city=?, state=?, zip_code=?, notes=?, active=?,
         updated_at=datetime('now')
       WHERE id=?`
    ).run(
      next.name,
      next.document,
      next.phone,
      next.whatsapp,
      next.address,
      next.address_number,
      next.neighborhood,
      next.city,
      next.state,
      next.zip_code,
      next.notes,
      next.active,
      Number(id)
    );
    writeAudit({ action: 'customer.update', entityType: 'customer', entityId: Number(id), details: next });
    return getCustomerById(id);
  })();
}

export function inactivateCustomer(id) {
  return updateCustomer(id, { active: 0 });
}

export function getCustomerPurchaseHistory(id, { limit = 50 } = {}) {
  getCustomerById(id);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return getDb()
    .prepare(
      `SELECT s.id, s.sale_number, s.status, s.total_cents, s.discount_cents,
              s.created_at, s.cancelled_at,
              (SELECT method FROM sale_payments sp WHERE sp.sale_id = s.id ORDER BY sp.id LIMIT 1) AS payment_method
       FROM sales s
       WHERE s.customer_id = ?
       ORDER BY s.id DESC
       LIMIT ?`
    )
    .all(Number(id), safeLimit);
}
