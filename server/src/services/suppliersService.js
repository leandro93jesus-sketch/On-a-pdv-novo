import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './auditService.js';

function normalizeOptionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function mapSupplier(row) {
  return row ? { ...row } : null;
}

export function searchSuppliers({ q, includeInactive = false } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (!includeInactive) where.push('active = 1');
  if (q && String(q).trim()) {
    where.push(
      `(name LIKE @term OR trade_name LIKE @term OR document LIKE @term OR phone LIKE @term OR city LIKE @term OR contact_name LIKE @term)`
    );
    params.term = `%${String(q).trim()}%`;
  }
  return db
    .prepare(
      `SELECT * FROM suppliers
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY name LIMIT 300`
    )
    .all(params)
    .map(mapSupplier);
}

export function getSupplierById(id) {
  const row = getDb().prepare('SELECT * FROM suppliers WHERE id = ?').get(Number(id));
  if (!row) throw new AppError('Fornecedor não encontrado', { status: 404, code: 'SUPPLIER_NOT_FOUND' });
  return mapSupplier(row);
}

function validate(payload, { partial = false } = {}) {
  const name = payload.name != null ? normalizeOptionalText(payload.name) : undefined;
  if (!partial && !name) throw new AppError('Nome/razão social é obrigatório', { status: 400, code: 'NAME_REQUIRED' });
  if (partial && payload.name !== undefined && !name) {
    throw new AppError('Nome/razão social é obrigatório', { status: 400, code: 'NAME_REQUIRED' });
  }
  let document = payload.document !== undefined ? normalizeOptionalText(payload.document) : undefined;
  if (document) {
    document = document.replace(/\D/g, '');
    if (document.length !== 11 && document.length !== 14) {
      throw new AppError('CPF/CNPJ inválido', { status: 400, code: 'INVALID_DOCUMENT' });
    }
  }
  return {
    name,
    trade_name: payload.trade_name !== undefined ? normalizeOptionalText(payload.trade_name) : undefined,
    document: document === undefined ? undefined : document,
    phone: payload.phone !== undefined ? normalizeOptionalText(payload.phone) : undefined,
    whatsapp: payload.whatsapp !== undefined ? normalizeOptionalText(payload.whatsapp) : undefined,
    email: payload.email !== undefined ? normalizeOptionalText(payload.email) : undefined,
    address: payload.address !== undefined ? normalizeOptionalText(payload.address) : undefined,
    address_number: payload.address_number !== undefined ? normalizeOptionalText(payload.address_number) : undefined,
    neighborhood: payload.neighborhood !== undefined ? normalizeOptionalText(payload.neighborhood) : undefined,
    city: payload.city !== undefined ? normalizeOptionalText(payload.city) : undefined,
    state: payload.state !== undefined ? normalizeOptionalText(payload.state)?.toUpperCase() : undefined,
    zip_code: payload.zip_code !== undefined ? normalizeOptionalText(payload.zip_code) : undefined,
    contact_name: payload.contact_name !== undefined ? normalizeOptionalText(payload.contact_name) : undefined,
    notes: payload.notes !== undefined ? normalizeOptionalText(payload.notes) : undefined,
    active:
      payload.active === undefined ? undefined : payload.active === 0 || payload.active === false ? 0 : 1,
  };
}

export function createSupplier(payload = {}) {
  const db = getDb();
  const data = validate(payload);
  return db.transaction(() => {
    if (data.document) {
      const exists = db.prepare('SELECT id FROM suppliers WHERE document = ?').get(data.document);
      if (exists) throw new AppError('CPF/CNPJ já cadastrado', { status: 409, code: 'DUPLICATE_DOCUMENT' });
    }
    const info = db
      .prepare(
        `INSERT INTO suppliers (
           name, trade_name, document, phone, whatsapp, email, address, address_number,
           neighborhood, city, state, zip_code, contact_name, notes, active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.name,
        data.trade_name,
        data.document,
        data.phone,
        data.whatsapp,
        data.email,
        data.address,
        data.address_number,
        data.neighborhood,
        data.city,
        data.state,
        data.zip_code,
        data.contact_name,
        data.notes,
        data.active ?? 1
      );
    const id = Number(info.lastInsertRowid);
    writeAudit({ action: 'supplier.create', entityType: 'supplier', entityId: id, details: { name: data.name } });
    return getSupplierById(id);
  })();
}

export function updateSupplier(id, payload = {}) {
  const db = getDb();
  const current = getSupplierById(id);
  const data = validate(payload, { partial: true });
  const next = {
    name: data.name ?? current.name,
    trade_name: data.trade_name !== undefined ? data.trade_name : current.trade_name,
    document: data.document !== undefined ? data.document : current.document,
    phone: data.phone !== undefined ? data.phone : current.phone,
    whatsapp: data.whatsapp !== undefined ? data.whatsapp : current.whatsapp,
    email: data.email !== undefined ? data.email : current.email,
    address: data.address !== undefined ? data.address : current.address,
    address_number: data.address_number !== undefined ? data.address_number : current.address_number,
    neighborhood: data.neighborhood !== undefined ? data.neighborhood : current.neighborhood,
    city: data.city !== undefined ? data.city : current.city,
    state: data.state !== undefined ? data.state : current.state,
    zip_code: data.zip_code !== undefined ? data.zip_code : current.zip_code,
    contact_name: data.contact_name !== undefined ? data.contact_name : current.contact_name,
    notes: data.notes !== undefined ? data.notes : current.notes,
    active: data.active !== undefined ? data.active : current.active,
  };
  return db.transaction(() => {
    if (next.document) {
      const exists = db
        .prepare('SELECT id FROM suppliers WHERE document = ? AND id != ?')
        .get(next.document, Number(id));
      if (exists) throw new AppError('CPF/CNPJ já cadastrado', { status: 409, code: 'DUPLICATE_DOCUMENT' });
    }
    db.prepare(
      `UPDATE suppliers SET
         name=?, trade_name=?, document=?, phone=?, whatsapp=?, email=?, address=?, address_number=?,
         neighborhood=?, city=?, state=?, zip_code=?, contact_name=?, notes=?, active=?,
         updated_at=datetime('now')
       WHERE id=?`
    ).run(
      next.name,
      next.trade_name,
      next.document,
      next.phone,
      next.whatsapp,
      next.email,
      next.address,
      next.address_number,
      next.neighborhood,
      next.city,
      next.state,
      next.zip_code,
      next.contact_name,
      next.notes,
      next.active,
      Number(id)
    );
    writeAudit({ action: 'supplier.update', entityType: 'supplier', entityId: Number(id), details: next });
    return getSupplierById(id);
  })();
}

export function inactivateSupplier(id) {
  const db = getDb();
  getSupplierById(id);
  const purchaseCount = db.prepare('SELECT COUNT(*) AS c FROM purchases WHERE supplier_id = ?').get(Number(id)).c;
  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products WHERE supplier_id = ?').get(Number(id)).c;
  if (purchaseCount > 0 || productCount > 0) {
    return updateSupplier(id, { active: 0 });
  }
  return updateSupplier(id, { active: 0 });
}

export function getSupplierPurchaseHistory(id, { limit = 50 } = {}) {
  getSupplierById(id);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return getDb()
    .prepare(
      `SELECT id, purchase_number, status, document_number, purchase_date, total_cents, created_at
       FROM purchases WHERE supplier_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(Number(id), safeLimit);
}
