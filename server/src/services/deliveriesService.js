import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './auditService.js';
import { getCurrentOperator } from './settingsService.js';

const STATUSES = new Set([
  'pendente',
  'separando',
  'saiu_para_entrega',
  'entregue',
  'nao_entregue',
  'cancelada',
]);

function normalizeOptionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function getDeliveryById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(Number(id));
  if (!row) throw new AppError('Entrega não encontrada', { status: 404, code: 'DELIVERY_NOT_FOUND' });
  const history = db
    .prepare('SELECT * FROM delivery_history WHERE delivery_id = ? ORDER BY id')
    .all(Number(id));
  const sale = db.prepare('SELECT id, sale_number, total_cents, created_at FROM sales WHERE id = ?').get(row.sale_id);
  return { ...row, history, sale };
}

export function listDeliveries({
  status,
  customerId,
  courier,
  dateFrom,
  dateTo,
  limit = 100,
} = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (status) {
    where.push('d.status = ?');
    params.push(status);
  }
  if (customerId) {
    where.push('d.customer_id = ?');
    params.push(Number(customerId));
  }
  if (courier) {
    where.push('d.courier_name LIKE ?');
    params.push(`%${String(courier).trim()}%`);
  }
  if (dateFrom) {
    where.push('d.scheduled_date >= ?');
    params.push(String(dateFrom).slice(0, 10));
  }
  if (dateTo) {
    where.push('d.scheduled_date <= ?');
    params.push(String(dateTo).slice(0, 10));
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);
  params.push(safeLimit);
  return db
    .prepare(
      `SELECT d.*, s.sale_number
       FROM deliveries d
       JOIN sales s ON s.id = d.sale_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY d.id DESC LIMIT ?`
    )
    .all(...params);
}

export function createDelivery(payload = {}) {
  const db = getDb();
  const saleId = Number(payload.sale_id);
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
  if (!sale) throw new AppError('Venda não encontrada', { status: 404, code: 'SALE_NOT_FOUND' });

  let customer = null;
  if (payload.customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(payload.customer_id));
  } else if (sale.customer_id) {
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(sale.customer_id);
  }

  const data = {
    sale_id: saleId,
    customer_id: customer?.id ?? null,
    customer_name: normalizeOptionalText(payload.customer_name) || customer?.name || null,
    phone: normalizeOptionalText(payload.phone) || customer?.phone || null,
    whatsapp: normalizeOptionalText(payload.whatsapp) || customer?.whatsapp || null,
    address: normalizeOptionalText(payload.address) || customer?.address || null,
    address_number: normalizeOptionalText(payload.address_number) || customer?.address_number || null,
    neighborhood: normalizeOptionalText(payload.neighborhood) || customer?.neighborhood || null,
    city: normalizeOptionalText(payload.city) || customer?.city || null,
    state: normalizeOptionalText(payload.state) || customer?.state || null,
    zip_code: normalizeOptionalText(payload.zip_code) || customer?.zip_code || null,
    scheduled_date: payload.scheduled_date ? String(payload.scheduled_date).slice(0, 10) : null,
    period: normalizeOptionalText(payload.period),
    notes: normalizeOptionalText(payload.notes),
    courier_name: normalizeOptionalText(payload.courier_name),
    status: STATUSES.has(payload.status) ? payload.status : 'pendente',
  };

  return db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO deliveries (
           sale_id, customer_id, customer_name, phone, whatsapp, address, address_number,
           neighborhood, city, state, zip_code, scheduled_date, period, notes, courier_name, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.sale_id,
        data.customer_id,
        data.customer_name,
        data.phone,
        data.whatsapp,
        data.address,
        data.address_number,
        data.neighborhood,
        data.city,
        data.state,
        data.zip_code,
        data.scheduled_date,
        data.period,
        data.notes,
        data.courier_name,
        data.status
      );
    const id = Number(info.lastInsertRowid);
    db.prepare(
      `INSERT INTO delivery_history (delivery_id, from_status, to_status, note, user_name)
       VALUES (?, NULL, ?, 'Criação da entrega', ?)`
    ).run(id, data.status, getCurrentOperator());
    writeAudit({ action: 'delivery.create', entityType: 'delivery', entityId: id, details: data });
    return getDeliveryById(id);
  })();
}

export function updateDeliveryStatus(id, payload = {}) {
  const db = getDb();
  const toStatus = String(payload.status || '').trim();
  if (!STATUSES.has(toStatus)) {
    throw new AppError('Status inválido', { status: 400, code: 'INVALID_STATUS' });
  }
  const note = normalizeOptionalText(payload.note);
  const userName = String(payload.user_name || getCurrentOperator()).trim();

  return db.transaction(() => {
    const current = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(Number(id));
    if (!current) throw new AppError('Entrega não encontrada', { status: 404, code: 'DELIVERY_NOT_FOUND' });
    if (current.status === toStatus) return getDeliveryById(id);

    db.prepare(
      `UPDATE deliveries SET status = ?, updated_at = datetime('now'),
         courier_name = COALESCE(?, courier_name)
       WHERE id = ?`
    ).run(toStatus, normalizeOptionalText(payload.courier_name), Number(id));

    db.prepare(
      `INSERT INTO delivery_history (delivery_id, from_status, to_status, note, user_name)
       VALUES (?, ?, ?, ?, ?)`
    ).run(Number(id), current.status, toStatus, note, userName);

    writeAudit({
      action: 'delivery.status',
      entityType: 'delivery',
      entityId: Number(id),
      details: { from: current.status, to: toStatus, note },
      userName,
    });
    return getDeliveryById(id);
  })();
}

export function updateDelivery(id, payload = {}) {
  const db = getDb();
  const current = getDeliveryById(id);
  const fields = {
    customer_name: payload.customer_name !== undefined ? normalizeOptionalText(payload.customer_name) : current.customer_name,
    phone: payload.phone !== undefined ? normalizeOptionalText(payload.phone) : current.phone,
    whatsapp: payload.whatsapp !== undefined ? normalizeOptionalText(payload.whatsapp) : current.whatsapp,
    address: payload.address !== undefined ? normalizeOptionalText(payload.address) : current.address,
    address_number: payload.address_number !== undefined ? normalizeOptionalText(payload.address_number) : current.address_number,
    neighborhood: payload.neighborhood !== undefined ? normalizeOptionalText(payload.neighborhood) : current.neighborhood,
    city: payload.city !== undefined ? normalizeOptionalText(payload.city) : current.city,
    state: payload.state !== undefined ? normalizeOptionalText(payload.state) : current.state,
    zip_code: payload.zip_code !== undefined ? normalizeOptionalText(payload.zip_code) : current.zip_code,
    scheduled_date: payload.scheduled_date !== undefined ? (payload.scheduled_date ? String(payload.scheduled_date).slice(0, 10) : null) : current.scheduled_date,
    period: payload.period !== undefined ? normalizeOptionalText(payload.period) : current.period,
    notes: payload.notes !== undefined ? normalizeOptionalText(payload.notes) : current.notes,
    courier_name: payload.courier_name !== undefined ? normalizeOptionalText(payload.courier_name) : current.courier_name,
  };
  db.prepare(
    `UPDATE deliveries SET
       customer_name=?, phone=?, whatsapp=?, address=?, address_number=?, neighborhood=?,
       city=?, state=?, zip_code=?, scheduled_date=?, period=?, notes=?, courier_name=?,
       updated_at=datetime('now')
     WHERE id=?`
  ).run(
    fields.customer_name,
    fields.phone,
    fields.whatsapp,
    fields.address,
    fields.address_number,
    fields.neighborhood,
    fields.city,
    fields.state,
    fields.zip_code,
    fields.scheduled_date,
    fields.period,
    fields.notes,
    fields.courier_name,
    Number(id)
  );
  writeAudit({ action: 'delivery.update', entityType: 'delivery', entityId: Number(id), details: fields });
  return getDeliveryById(id);
}
