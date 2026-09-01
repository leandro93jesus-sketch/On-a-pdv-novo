import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { getCustomerById } from './customersService.js';

const OPEN_STATUSES = new Set(['aberto', 'enviado', 'aprovado']);
const CLOSED_STATUSES = new Set(['convertido', 'cancelado', 'expirado']);

function nextQuoteNumber(db) {
  const row = db.prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM quotes`).get();
  const seq = Number(row?.max_id || 0) + 1;
  return `ORC-${String(seq).padStart(6, '0')}`;
}

function mapItem(row) {
  return {
    id: row.id,
    quote_id: row.quote_id,
    product_id: row.product_id ?? null,
    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    name: row.name,
    quantity: Number(row.quantity),
    unit_price_cents: row.unit_price_cents,
    line_total_cents: row.line_total_cents,
    is_misc: row.is_misc ? 1 : 0,
    sort_order: row.sort_order ?? 0,
  };
}

function mapQuote(row, items = []) {
  if (!row) return null;
  return {
    id: row.id,
    quote_number: row.quote_number,
    status: row.status,
    status_label: statusLabel(row.status),
    customer_id: row.customer_id ?? null,
    customer_name: row.customer_name ?? null,
    customer_phone: row.customer_phone ?? null,
    customer_document: row.customer_document ?? null,
    customer_address: row.customer_address ?? null,
    notes: row.notes ?? null,
    valid_until: row.valid_until ?? null,
    subtotal_cents: row.subtotal_cents,
    discount_cents: row.discount_cents,
    total_cents: row.total_cents,
    converted_sale_id: row.converted_sale_id ?? null,
    converted_at: row.converted_at ?? null,
    created_by: row.created_by ?? null,
    cancelled_at: row.cancelled_at ?? null,
    cancel_reason: row.cancel_reason ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    items,
  };
}

export function statusLabel(status) {
  const map = {
    aberto: 'Aberto',
    enviado: 'Enviado',
    aprovado: 'Aprovado',
    convertido: 'Convertido em venda',
    cancelado: 'Cancelado',
    expirado: 'Expirado',
  };
  return map[status] || status;
}

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new AppError('Informe ao menos um item no orçamento', {
      status: 400,
      code: 'QUOTE_EMPTY',
    });
  }
  const db = getDb();
  const items = [];
  let sort = 0;
  for (const raw of rawItems) {
    const qty = Number(raw.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new AppError('Quantidade inválida no orçamento', {
        status: 400,
        code: 'QUOTE_QTY_INVALID',
      });
    }
    const isMisc = Boolean(raw.is_misc);
    let product_id = raw.product_id != null ? Number(raw.product_id) : null;
    let name = String(raw.name || '').trim();
    let unit_price_cents =
      raw.unit_price_cents != null ? Math.round(Number(raw.unit_price_cents)) : null;
    let sku = raw.sku != null ? String(raw.sku) : null;
    let barcode = raw.barcode != null ? String(raw.barcode) : null;

    if (!isMisc && product_id) {
      const prod = db
        .prepare(
          `SELECT id, name, sku, barcode, price_cents, active FROM products WHERE id = ?`
        )
        .get(product_id);
      if (!prod || !prod.active) {
        throw new AppError(`Produto ${product_id} não encontrado ou inativo`, {
          status: 404,
          code: 'PRODUCT_NOT_FOUND',
        });
      }
      name = name || prod.name;
      sku = sku ?? prod.sku;
      barcode = barcode ?? prod.barcode;
      if (unit_price_cents == null) unit_price_cents = prod.price_cents;
    }

    if (!name) {
      throw new AppError('Nome do item obrigatório', { status: 400, code: 'QUOTE_ITEM_NAME' });
    }
    if (unit_price_cents == null || unit_price_cents < 0) {
      throw new AppError('Preço unitário inválido', { status: 400, code: 'QUOTE_PRICE' });
    }

    const line_total_cents = Math.round(qty * unit_price_cents);
    items.push({
      product_id: isMisc ? null : product_id,
      sku,
      barcode,
      name,
      quantity: qty,
      unit_price_cents,
      line_total_cents,
      is_misc: isMisc ? 1 : 0,
      sort_order: sort++,
    });
  }
  return items;
}

function totalsFromItems(items, discount_cents) {
  const subtotal_cents = items.reduce((s, i) => s + i.line_total_cents, 0);
  const discount = Math.max(0, Math.round(Number(discount_cents) || 0));
  if (discount > subtotal_cents) {
    throw new AppError('Desconto não pode ser maior que o subtotal', {
      status: 400,
      code: 'QUOTE_DISCOUNT',
    });
  }
  return {
    subtotal_cents,
    discount_cents: discount,
    total_cents: subtotal_cents - discount,
  };
}

function fillCustomerFields(payload) {
  let customer_id = payload.customer_id != null ? Number(payload.customer_id) : null;
  let customer_name = payload.customer_name != null ? String(payload.customer_name).trim() : '';
  let customer_phone = payload.customer_phone != null ? String(payload.customer_phone).trim() : '';
  let customer_document =
    payload.customer_document != null ? String(payload.customer_document).trim() : '';
  let customer_address =
    payload.customer_address != null ? String(payload.customer_address).trim() : '';

  if (customer_id) {
    const c = getCustomerById(customer_id);
    if (!c) {
      throw new AppError('Cliente não encontrado', { status: 404, code: 'CUSTOMER_NOT_FOUND' });
    }
    customer_name = customer_name || c.name || '';
    customer_phone = customer_phone || c.whatsapp || c.phone || '';
    customer_document = customer_document || c.document || '';
    if (!customer_address) {
      customer_address = [c.address, c.address_number, c.neighborhood, c.city, c.state, c.zip_code]
        .filter(Boolean)
        .join(', ');
    }
  }

  return {
    customer_id,
    customer_name: customer_name || null,
    customer_phone: customer_phone || null,
    customer_document: customer_document || null,
    customer_address: customer_address || null,
  };
}

function insertItems(db, quoteId, items) {
  const stmt = db.prepare(
    `INSERT INTO quote_items (
       quote_id, product_id, sku, barcode, name, quantity,
       unit_price_cents, line_total_cents, is_misc, sort_order
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const it of items) {
    stmt.run(
      quoteId,
      it.product_id,
      it.sku,
      it.barcode,
      it.name,
      it.quantity,
      it.unit_price_cents,
      it.line_total_cents,
      it.is_misc,
      it.sort_order
    );
  }
}

function loadItems(db, quoteId) {
  return db
    .prepare(`SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order, id`)
    .all(quoteId)
    .map(mapItem);
}

export function getQuoteById(id) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM quotes WHERE id = ?`).get(Number(id));
  if (!row) return null;
  return mapQuote(row, loadItems(db, row.id));
}

export function listQuotes(filters = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  if (filters.status) {
    where.push(`q.status = @status`);
    params.status = String(filters.status);
  }
  if (filters.quote_number) {
    where.push(`q.quote_number LIKE @quote_number`);
    params.quote_number = `%${String(filters.quote_number).trim()}%`;
  }
  if (filters.customer) {
    where.push(`(q.customer_name LIKE @customer OR q.customer_phone LIKE @customer)`);
    params.customer = `%${String(filters.customer).trim()}%`;
  }
  if (filters.phone) {
    where.push(`q.customer_phone LIKE @phone`);
    params.phone = `%${String(filters.phone).trim()}%`;
  }
  if (filters.from) {
    where.push(`date(q.created_at) >= date(@from)`);
    params.from = String(filters.from).slice(0, 10);
  }
  if (filters.to) {
    where.push(`date(q.created_at) <= date(@to)`);
    params.to = String(filters.to).slice(0, 10);
  }
  if (filters.term) {
    where.push(
      `(q.quote_number LIKE @term OR q.customer_name LIKE @term OR q.customer_phone LIKE @term OR q.notes LIKE @term)`
    );
    params.term = `%${String(filters.term).trim()}%`;
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 2000);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM quotes q ${whereSql}`)
    .get(params).c;

  const rows = db
    .prepare(
      `SELECT q.* FROM quotes q ${whereSql}
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT ${limit} OFFSET ${offset}`
    )
    .all(params);

  return {
    items: rows.map((r) => mapQuote(r, [])),
    total,
    limit,
    offset,
  };
}

/**
 * Cria orçamento. NÃO altera estoque, caixa, vendas ou pagamento.
 */
export function createQuote(payload = {}) {
  const db = getDb();
  const items = normalizeItems(payload.items);
  const totals = totalsFromItems(items, payload.discount_cents);
  const customer = fillCustomerFields(payload);
  const notes = payload.notes != null ? String(payload.notes).trim() || null : null;
  const valid_until = payload.valid_until
    ? String(payload.valid_until).slice(0, 10)
    : null;
  const created_by = payload.created_by ? String(payload.created_by) : null;
  const status = payload.status && OPEN_STATUSES.has(payload.status) ? payload.status : 'aberto';

  const tx = db.transaction(() => {
    const quote_number = nextQuoteNumber(db);
    const info = db
      .prepare(
        `INSERT INTO quotes (
           quote_number, status, customer_id, customer_name, customer_phone,
           customer_document, customer_address, notes, valid_until,
           subtotal_cents, discount_cents, total_cents, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        quote_number,
        status,
        customer.customer_id,
        customer.customer_name,
        customer.customer_phone,
        customer.customer_document,
        customer.customer_address,
        notes,
        valid_until,
        totals.subtotal_cents,
        totals.discount_cents,
        totals.total_cents,
        created_by
      );
    insertItems(db, info.lastInsertRowid, items);
    return info.lastInsertRowid;
  });

  const id = tx();
  return getQuoteById(id);
}

/**
 * Atualiza orçamento aberto. NÃO altera estoque/caixa.
 */
export function updateQuote(id, payload = {}) {
  const db = getDb();
  const current = getQuoteById(id);
  if (!current) {
    throw new AppError('Orçamento não encontrado', { status: 404, code: 'QUOTE_NOT_FOUND' });
  }
  if (CLOSED_STATUSES.has(current.status)) {
    throw new AppError(`Orçamento ${current.status_label} não pode ser editado`, {
      status: 409,
      code: 'QUOTE_LOCKED',
    });
  }

  const items = payload.items != null ? normalizeItems(payload.items) : current.items;
  const totals = totalsFromItems(
    items.map((i) => ({
      ...i,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
      line_total_cents: i.line_total_cents,
      is_misc: i.is_misc,
      product_id: i.product_id,
      name: i.name,
      sku: i.sku,
      barcode: i.barcode,
    })),
    payload.discount_cents != null ? payload.discount_cents : current.discount_cents
  );
  const customer = fillCustomerFields({
    customer_id: payload.customer_id !== undefined ? payload.customer_id : current.customer_id,
    customer_name:
      payload.customer_name !== undefined ? payload.customer_name : current.customer_name,
    customer_phone:
      payload.customer_phone !== undefined ? payload.customer_phone : current.customer_phone,
    customer_document:
      payload.customer_document !== undefined
        ? payload.customer_document
        : current.customer_document,
    customer_address:
      payload.customer_address !== undefined
        ? payload.customer_address
        : current.customer_address,
  });
  const notes =
    payload.notes !== undefined
      ? String(payload.notes || '').trim() || null
      : current.notes;
  const valid_until =
    payload.valid_until !== undefined
      ? payload.valid_until
        ? String(payload.valid_until).slice(0, 10)
        : null
      : current.valid_until;
  const status =
    payload.status && ['aberto', 'enviado', 'aprovado'].includes(payload.status)
      ? payload.status
      : current.status;

  const normalizedItems = payload.items != null ? normalizeItems(payload.items) : null;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE quotes SET
         status = ?, customer_id = ?, customer_name = ?, customer_phone = ?,
         customer_document = ?, customer_address = ?, notes = ?, valid_until = ?,
         subtotal_cents = ?, discount_cents = ?, total_cents = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      status,
      customer.customer_id,
      customer.customer_name,
      customer.customer_phone,
      customer.customer_document,
      customer.customer_address,
      notes,
      valid_until,
      totals.subtotal_cents,
      totals.discount_cents,
      totals.total_cents,
      Number(id)
    );
    if (normalizedItems) {
      db.prepare(`DELETE FROM quote_items WHERE quote_id = ?`).run(Number(id));
      insertItems(db, Number(id), normalizedItems);
    }
  });
  tx();
  return getQuoteById(id);
}

export function cancelQuote(id, payload = {}) {
  const db = getDb();
  const current = getQuoteById(id);
  if (!current) {
    throw new AppError('Orçamento não encontrado', { status: 404, code: 'QUOTE_NOT_FOUND' });
  }
  if (current.status === 'cancelado') {
    throw new AppError('Orçamento já cancelado', { status: 409, code: 'QUOTE_ALREADY_CANCELLED' });
  }
  if (current.status === 'convertido') {
    throw new AppError('Orçamento convertido não pode ser cancelado', {
      status: 409,
      code: 'QUOTE_CONVERTED',
    });
  }
  const reason = String(payload.reason || '').trim() || 'Cancelado pelo operador';
  db.prepare(
    `UPDATE quotes SET status = 'cancelado', cancelled_at = datetime('now'),
       cancel_reason = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(reason, Number(id));
  return getQuoteById(id);
}

/**
 * Marca orçamento como convertido após venda criada na UI.
 * NÃO cria a venda aqui — apenas vincula.
 */
export function markQuoteConverted(id, saleId) {
  const db = getDb();
  const current = getQuoteById(id);
  if (!current) {
    throw new AppError('Orçamento não encontrado', { status: 404, code: 'QUOTE_NOT_FOUND' });
  }
  if (current.status === 'convertido' && current.converted_sale_id) {
    throw new AppError(
      `Este orçamento já foi convertido na venda Nº ${current.converted_sale_id}.`,
      { status: 409, code: 'QUOTE_ALREADY_CONVERTED', details: { sale_id: current.converted_sale_id } }
    );
  }
  if (current.status === 'cancelado') {
    throw new AppError('Orçamento cancelado não pode ser convertido', {
      status: 409,
      code: 'QUOTE_CANCELLED',
    });
  }
  const sale = db.prepare(`SELECT id, sale_number FROM sales WHERE id = ?`).get(Number(saleId));
  if (!sale) {
    throw new AppError('Venda não encontrada para vínculo', { status: 404, code: 'SALE_NOT_FOUND' });
  }
  db.prepare(
    `UPDATE quotes SET status = 'convertido', converted_sale_id = ?,
       converted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(Number(saleId), Number(id));
  return getQuoteById(id);
}

/**
 * Payload para a tela de Vendas (sem finalizar).
 */
export function getQuoteConversionPayload(id) {
  const quote = getQuoteById(id);
  if (!quote) {
    throw new AppError('Orçamento não encontrado', { status: 404, code: 'QUOTE_NOT_FOUND' });
  }
  if (quote.status === 'convertido' && quote.converted_sale_id) {
    const sale = getDb()
      .prepare(`SELECT id, sale_number FROM sales WHERE id = ?`)
      .get(quote.converted_sale_id);
    throw new AppError(
      `Este orçamento já foi convertido na venda Nº ${sale?.sale_number || quote.converted_sale_id}.`,
      {
        status: 409,
        code: 'QUOTE_ALREADY_CONVERTED',
        details: { sale_id: quote.converted_sale_id, sale_number: sale?.sale_number },
      }
    );
  }
  if (quote.status === 'cancelado') {
    throw new AppError('Orçamento cancelado não pode ser convertido', {
      status: 409,
      code: 'QUOTE_CANCELLED',
    });
  }
  return {
    quote_id: quote.id,
    quote_number: quote.quote_number,
    customer_id: quote.customer_id,
    customer_name: quote.customer_name,
    customer_phone: quote.customer_phone,
    discount_cents: quote.discount_cents,
    notes: quote.notes,
    items: quote.items.map((i) => ({
      product_id: i.product_id,
      name: i.name,
      barcode: i.barcode,
      sku: i.sku,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
      is_misc: i.is_misc,
    })),
  };
}
