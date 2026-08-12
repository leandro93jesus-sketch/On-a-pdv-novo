import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { writeAudit } from './auditService.js';
import { getCurrentOperator } from './settingsService.js';
import { applyStockMovement } from './stockService.js';
import { createSale } from './salesService.js';

const ORDER_STATUSES = new Set([
  'aguardando_pagamento',
  'aguardando_separacao',
  'em_separacao',
  'separado',
  'pronto_para_entrega',
  'saiu_para_entrega',
  'entregue',
  'problema_na_entrega',
  'cancelado',
]);

const PAY_STATUSES = new Set([
  'nao_pago',
  'parcial',
  'pago',
  'pix_pendente',
  'pagamento_na_entrega',
]);

function nextOrderNumber(db) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM delivery_orders`).get();
  const n = Number(row?.c || 0) + 1;
  return `PED-${String(n).padStart(6, '0')}`;
}

function availableStock(db, productId) {
  const p = db
    .prepare(
      `SELECT id, name, price_cents, stock_qty, COALESCE(reserved_qty, 0) AS reserved_qty, allow_negative_stock
       FROM products WHERE id = ?`
    )
    .get(Number(productId));
  if (!p) throw new AppError('Produto não encontrado', { status: 404, code: 'PRODUCT_NOT_FOUND' });
  return {
    ...p,
    available: Math.max(0, Number(p.stock_qty) - Number(p.reserved_qty || 0)),
  };
}

function mapOrder(row) {
  if (!row) return null;
  return {
    ...row,
    amount_due_cents: Math.max(0, Number(row.total_cents) - Number(row.amount_paid_cents)),
    in_cash: Number(row.amount_paid_cents) > 0,
  };
}

function checkStatusForItem(quantity, checkedQty) {
  const q = Number(quantity) || 0;
  const c = Math.max(0, Number(checkedQty) || 0);
  if (c <= 0) return 'PENDENTE';
  if (c >= q) return 'CONFERIDO';
  return 'PARCIAL';
}

function mapOrderItem(row) {
  const quantity = Number(row.quantity) || 0;
  const checked = Math.max(0, Number(row.checked_qty) || 0);
  return {
    ...row,
    checked_qty: checked,
    remaining_qty: Math.max(0, quantity - checked),
    check_status: checkStatusForItem(quantity, checked),
  };
}

function allItemsChecked(items) {
  return (items || []).every((it) => Number(it.checked_qty || 0) >= Number(it.quantity || 0));
}

export function getDeliveryOrder(id) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM delivery_orders WHERE id = ?`).get(Number(id));
  if (!row) throw new AppError('Pedido não encontrado', { status: 404, code: 'ORDER_NOT_FOUND' });
  const items = db
    .prepare(
      `SELECT i.*, p.barcode AS product_barcode, p.sku AS product_sku
       FROM delivery_order_items i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ?
       ORDER BY i.id`
    )
    .all(Number(id))
    .map(mapOrderItem);
  const payments = db
    .prepare(`SELECT * FROM delivery_order_payments WHERE order_id = ? ORDER BY id`)
    .all(Number(id));
  const history = db
    .prepare(`SELECT * FROM delivery_order_history WHERE order_id = ? ORDER BY id`)
    .all(Number(id));
  const reservations = db
    .prepare(`SELECT * FROM stock_reservations WHERE order_id = ? ORDER BY id`)
    .all(Number(id));
  let scans = [];
  try {
    scans = db
      .prepare(`SELECT * FROM delivery_order_scans WHERE order_id = ? ORDER BY id DESC LIMIT 100`)
      .all(Number(id));
  } catch {
    scans = [];
  }
  return {
    ...mapOrder(row),
    items,
    payments,
    history,
    reservations,
    scans,
    all_items_checked: allItemsChecked(items),
  };
}

export function listDeliveryOrders({ status, payment_status, limit = 100 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (payment_status) {
    where.push('payment_status = ?');
    params.push(payment_status);
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);
  params.push(safeLimit);
  return db
    .prepare(
      `SELECT * FROM delivery_orders
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY id DESC LIMIT ?`
    )
    .all(...params)
    .map(mapOrder);
}

function normalizeDeliveryItems(db, items, { extraAvailableByProduct = {} } = {}) {
  if (!Array.isArray(items) || !items.length) {
    throw new AppError('Pedido sem itens', { status: 400, code: 'ORDER_EMPTY' });
  }
  return items.map((raw) => {
    const qty = Number(raw.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new AppError('Quantidade inválida', { status: 400, code: 'INVALID_QTY' });
    }
    const isMisc = Boolean(raw.is_misc);
    if (isMisc) {
      const price = Number(raw.unit_price_cents);
      if (!Number.isInteger(price) || price < 0) {
        throw new AppError('Preço do item diversos inválido', { status: 400, code: 'INVALID_PRICE' });
      }
      return {
        product_id: null,
        product_name: String(raw.name || 'Item Diversos').trim() || 'Item Diversos',
        quantity: qty,
        unit_price_cents: price,
        line_total_cents: price * qty,
        is_misc: 1,
      };
    }
    const productId = Number(raw.product_id);
    const prod = availableStock(db, productId);
    const extra = Number(extraAvailableByProduct[productId] || 0);
    const available = prod.available + extra;
    if (qty > available && !prod.allow_negative_stock) {
      throw new AppError(`Estoque disponível insuficiente para "${prod.name}". Disponível: ${available}`, {
        status: 409,
        code: 'STOCK_AVAILABLE_INSUFFICIENT',
      });
    }
    const price =
      raw.unit_price_cents != null ? Number(raw.unit_price_cents) : Number(prod.price_cents || 0);
    return {
      product_id: productId,
      product_name: String(raw.name || prod.name),
      quantity: qty,
      unit_price_cents: price,
      line_total_cents: price * qty,
      is_misc: 0,
    };
  });
}

function resolveOrderDiscount(normalized, discountRaw) {
  const subtotal = normalized.reduce((s, i) => s + i.line_total_cents, 0);
  let discount = Number(discountRaw || 0);
  if (!Number.isInteger(discount) || discount < 0) {
    throw new AppError('Desconto inválido', { status: 400, code: 'INVALID_DISCOUNT' });
  }
  if (discount > subtotal) {
    throw new AppError('Desconto maior que o subtotal', { status: 400, code: 'DISCOUNT_OVER' });
  }
  return { subtotal, discount, total: subtotal - discount };
}

function assertDeliveryAddress(payload) {
  const street = String(payload.address || '').trim();
  const number = String(payload.address_number || '').trim();
  const city = String(payload.city || '').trim();
  if (!street || !number || !city) {
    throw new AppError('ENDEREÇO INCOMPLETO PARA GERAR ROTA. Informe rua, número e cidade.', {
      status: 400,
      code: 'ADDRESS_INCOMPLETE',
    });
  }
}

function appendOrderHistory(db, orderId, fromStatus, toStatus, note) {
  db.prepare(
    `INSERT INTO delivery_order_history (order_id, from_status, to_status, note, user_name)
     VALUES (?, ?, ?, ?, ?)`
  ).run(Number(orderId), fromStatus, toStatus, note || null, getCurrentOperator());
}

function releaseActiveReservations(db, orderId) {
  const reservas = db
    .prepare(`SELECT * FROM stock_reservations WHERE order_id = ? AND status = 'ativa'`)
    .all(Number(orderId));
  for (const r of reservas) {
    db.prepare(
      `UPDATE products SET reserved_qty = MAX(COALESCE(reserved_qty, 0) - ?, 0) WHERE id = ?`
    ).run(r.quantity, r.product_id);
    db.prepare(
      `UPDATE stock_reservations SET status = 'liberada', released_at = datetime('now') WHERE id = ?`
    ).run(r.id);
  }
  return reservas;
}

function insertOrderItemsAndReserve(db, orderId, normalized) {
  const insertItem = db.prepare(
    `INSERT INTO delivery_order_items (
       order_id, product_id, product_name, quantity, unit_price_cents, line_total_cents, is_misc
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const item of normalized) {
    insertItem.run(
      orderId,
      item.product_id,
      item.product_name,
      item.quantity,
      item.unit_price_cents,
      item.line_total_cents,
      item.is_misc
    );
    if (item.product_id) {
      db.prepare(
        `UPDATE products SET reserved_qty = COALESCE(reserved_qty, 0) + ? WHERE id = ?`
      ).run(item.quantity, item.product_id);
      db.prepare(
        `INSERT INTO stock_reservations (product_id, order_id, quantity, status)
         VALUES (?, ?, ?, 'ativa')`
      ).run(item.product_id, orderId, item.quantity);
    }
  }
}

export function createDeliveryOrder(payload = {}) {
  const db = getDb();

  if (payload.client_request_id) {
    const existing = db
      .prepare(`SELECT id FROM delivery_orders WHERE client_request_id = ?`)
      .get(String(payload.client_request_id));
    if (existing) return getDeliveryOrder(existing.id);
  }

  assertDeliveryAddress(payload);
  const normalized = normalizeDeliveryItems(db, payload.items);
  const { subtotal, discount, total } = resolveOrderDiscount(normalized, payload.discount_cents);
  const paymentStatus = PAY_STATUSES.has(payload.payment_status)
    ? payload.payment_status
    : 'nao_pago';
  const status = 'aguardando_pagamento';

  return db.transaction(() => {
    const orderNumber = nextOrderNumber(db);
    const info = db
      .prepare(
        `INSERT INTO delivery_orders (
           order_number, customer_id, customer_name, phone, whatsapp, address, address_number,
           neighborhood, city, state, zip_code, scheduled_date, period, notes, courier_name,
           status, payment_status, total_cents, amount_paid_cents, discount_cents,
           complement, reference_note, courier_phone, expected_payment_method, change_for_cents,
           client_request_id, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orderNumber,
        payload.customer_id ? Number(payload.customer_id) : null,
        payload.customer_name || null,
        payload.phone || null,
        payload.whatsapp || null,
        String(payload.address || '').trim() || null,
        String(payload.address_number || '').trim() || null,
        payload.neighborhood || null,
        String(payload.city || '').trim() || null,
        payload.state || null,
        payload.zip_code || null,
        payload.scheduled_date ? String(payload.scheduled_date).slice(0, 10) : null,
        payload.period || null,
        payload.notes || null,
        payload.courier_name || null,
        status,
        paymentStatus,
        total,
        discount,
        payload.complement || null,
        payload.reference_note || payload.reference || null,
        payload.courier_phone || null,
        payload.expected_payment_method || null,
        payload.change_for_cents != null ? Number(payload.change_for_cents) : null,
        payload.client_request_id ? String(payload.client_request_id) : null,
        getCurrentOperator()
      );
    const orderId = Number(info.lastInsertRowid);

    insertOrderItemsAndReserve(db, orderId, normalized);

    db.prepare(
      `INSERT INTO delivery_order_history (order_id, from_status, to_status, note, user_name)
       VALUES (?, NULL, ?, ?, ?)`
    ).run(
      orderId,
      status,
      `Pedido criado — aguardando pagamento (subtotal ${(subtotal / 100).toFixed(2)}, desc. ${(discount / 100).toFixed(2)})`,
      getCurrentOperator()
    );

    writeAudit({
      action: 'delivery_order.create',
      entityType: 'delivery_order',
      entityId: orderId,
      details: {
        order_number: orderNumber,
        total_cents: total,
        discount_cents: discount,
        payment_status: paymentStatus,
      },
      userName: getCurrentOperator(),
    });

    return getDeliveryOrder(orderId);
  })();
}

/**
 * Edita pedido ainda não pago: atualiza dados/itens e reajusta reservas.
 * Não lança caixa nem baixa definitiva.
 */
export function updateDeliveryOrder(orderId, payload = {}) {
  const db = getDb();
  const order = getDeliveryOrder(orderId);
  if (order.status === 'cancelado') {
    throw new AppError('Pedido cancelado', { status: 409, code: 'ORDER_CANCELLED' });
  }
  if (order.payment_status === 'pago' || Number(order.amount_paid_cents) > 0) {
    throw new AppError('Pedido já tem pagamento — edição bloqueada', {
      status: 409,
      code: 'ORDER_ALREADY_PAID',
    });
  }

  const hasItems = Array.isArray(payload.items);
  const currentReserves = (order.reservations || []).filter((r) => r.status === 'ativa');
  const extraAvailable = {};
  for (const r of currentReserves) {
    extraAvailable[r.product_id] = (extraAvailable[r.product_id] || 0) + Number(r.quantity || 0);
  }

  const normalized = hasItems
    ? normalizeDeliveryItems(db, payload.items, { extraAvailableByProduct: extraAvailable })
    : (order.items || []).map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price_cents: it.unit_price_cents,
        line_total_cents: it.line_total_cents,
        is_misc: it.is_misc ? 1 : 0,
      }));

  const discountSource =
    payload.discount_cents != null ? payload.discount_cents : order.discount_cents || 0;
  const { discount, total } = resolveOrderDiscount(normalized, discountSource);

  const nextAddress = {
    address: payload.address !== undefined ? payload.address || null : order.address,
    address_number:
      payload.address_number !== undefined ? payload.address_number || null : order.address_number,
    city: payload.city !== undefined ? payload.city || null : order.city,
  };
  assertDeliveryAddress(nextAddress);

  return db.transaction(() => {
    if (hasItems) {
      releaseActiveReservations(db, orderId);
      db.prepare(`DELETE FROM delivery_order_items WHERE order_id = ?`).run(Number(orderId));
      insertOrderItemsAndReserve(db, orderId, normalized);
    }

    db.prepare(
      `UPDATE delivery_orders SET
         customer_id = ?,
         customer_name = ?,
         phone = ?,
         address = ?,
         address_number = ?,
         neighborhood = ?,
         city = ?,
         state = ?,
         zip_code = ?,
         notes = ?,
         complement = ?,
         reference_note = ?,
         discount_cents = ?,
         total_cents = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      payload.customer_id != null
        ? Number(payload.customer_id) || null
        : order.customer_id ?? null,
      payload.customer_name !== undefined ? payload.customer_name || null : order.customer_name,
      payload.phone !== undefined ? payload.phone || null : order.phone,
      payload.address !== undefined ? payload.address || null : order.address,
      payload.address_number !== undefined
        ? payload.address_number || null
        : order.address_number,
      payload.neighborhood !== undefined ? payload.neighborhood || null : order.neighborhood,
      payload.city !== undefined ? payload.city || null : order.city,
      payload.state !== undefined ? payload.state || null : order.state,
      payload.zip_code !== undefined ? payload.zip_code || null : order.zip_code,
      payload.notes !== undefined ? payload.notes || null : order.notes,
      payload.complement !== undefined ? payload.complement || null : order.complement ?? null,
      payload.reference_note !== undefined || payload.reference !== undefined
        ? payload.reference_note || payload.reference || null
        : order.reference_note ?? null,
      discount,
      total,
      Number(orderId)
    );

    db.prepare(
      `INSERT INTO delivery_order_history (order_id, from_status, to_status, note, user_name)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      Number(orderId),
      order.status,
      order.status,
      'Pedido editado (ainda aguardando pagamento)',
      getCurrentOperator()
    );

    writeAudit({
      action: 'delivery_order.update',
      entityType: 'delivery_order',
      entityId: Number(orderId),
      details: { total_cents: total, discount_cents: discount, items_replaced: hasItems },
      userName: getCurrentOperator(),
    });

    return getDeliveryOrder(orderId);
  })();
}

/**
 * Corrige endereço do pedido (não altera cadastro do cliente, caixa nem estoque).
 * Permitido mesmo com pagamento pendente ou confirmado.
 */
export function updateDeliveryOrderAddress(orderId, payload = {}) {
  const db = getDb();
  const order = getDeliveryOrder(orderId);
  if (order.status === 'cancelado') {
    throw new AppError('Pedido cancelado', { status: 409, code: 'ORDER_CANCELLED' });
  }

  const next = {
    phone: payload.phone !== undefined ? payload.phone || null : order.phone,
    address: payload.address !== undefined ? payload.address || null : order.address,
    address_number:
      payload.address_number !== undefined ? payload.address_number || null : order.address_number,
    complement: payload.complement !== undefined ? payload.complement || null : order.complement,
    neighborhood:
      payload.neighborhood !== undefined ? payload.neighborhood || null : order.neighborhood,
    city: payload.city !== undefined ? payload.city || null : order.city,
    state: payload.state !== undefined ? payload.state || null : order.state,
    zip_code: payload.zip_code !== undefined ? payload.zip_code || null : order.zip_code,
    reference_note:
      payload.reference_note !== undefined || payload.reference !== undefined
        ? payload.reference_note || payload.reference || null
        : order.reference_note,
    notes: payload.notes !== undefined ? payload.notes || null : order.notes,
    courier_name:
      payload.courier_name !== undefined ? payload.courier_name || null : order.courier_name,
    courier_phone:
      payload.courier_phone !== undefined ? payload.courier_phone || null : order.courier_phone,
    customer_name:
      payload.customer_name !== undefined ? payload.customer_name || null : order.customer_name,
  };
  assertDeliveryAddress(next);

  return db.transaction(() => {
    db.prepare(
      `UPDATE delivery_orders SET
         phone = ?, address = ?, address_number = ?, complement = ?, neighborhood = ?,
         city = ?, state = ?, zip_code = ?, reference_note = ?, notes = ?,
         courier_name = ?, courier_phone = ?, customer_name = ?,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      next.phone,
      String(next.address || '').trim(),
      String(next.address_number || '').trim(),
      next.complement,
      next.neighborhood,
      String(next.city || '').trim(),
      next.state,
      next.zip_code,
      next.reference_note,
      next.notes,
      next.courier_name,
      next.courier_phone,
      next.customer_name,
      Number(orderId)
    );
    appendOrderHistory(db, orderId, order.status, order.status, 'Endereço do pedido corrigido');
    writeAudit({
      action: 'delivery_order.address_update',
      entityType: 'delivery_order',
      entityId: Number(orderId),
      details: { city: next.city, address: next.address },
      userName: getCurrentOperator(),
    });
    return getDeliveryOrder(orderId);
  })();
}

/**
 * Registra evento de rota/WhatsApp no histórico (sem impacto financeiro).
 * event: 'route_opened' | 'route_shared' | 'route_link_copied' | 'address_copied'
 */
export function logDeliveryOrderRouteEvent(orderId, { event, note, phone } = {}) {
  const order = getDeliveryOrder(orderId);
  const labels = {
    route_opened: 'Rota aberta no mapa',
    route_shared: 'Rota compartilhada no WhatsApp',
    route_link_copied: 'Link da rota copiado',
    address_copied: 'Endereço copiado',
  };
  const label = labels[event] || 'Evento de rota';
  const detail = [label, phone ? `dest: ${phone}` : null, note || null].filter(Boolean).join(' · ');
  const db = getDb();
  appendOrderHistory(db, orderId, order.status, order.status, detail);
  writeAudit({
    action: `delivery_order.${event || 'route_event'}`,
    entityType: 'delivery_order',
    entityId: Number(orderId),
    details: { event, phone: phone || null },
    userName: getCurrentOperator(),
  });
  return getDeliveryOrder(orderId);
}

/**
 * Confirma pagamento (parcial ou total). Idempotente por client_request_id.
 * Somente o valor pago entra no caixa (via createSale quando quita ou gera venda vinculada).
 */
export function confirmDeliveryOrderPayment(orderId, payload = {}) {
  const db = getDb();
  if (payload.client_request_id) {
    const dup = db
      .prepare(`SELECT id, order_id FROM delivery_order_payments WHERE client_request_id = ?`)
      .get(String(payload.client_request_id));
    if (dup) return getDeliveryOrder(dup.order_id);
  }

  const order = getDeliveryOrder(orderId);
  if (order.status === 'cancelado') {
    throw new AppError('Pedido cancelado', { status: 409, code: 'ORDER_CANCELLED' });
  }
  if (order.payment_status === 'pago' && (order.sale_id || Number(order.amount_paid_cents) > 0)) {
    const lastPay = (order.payments || [])[(order.payments || []).length - 1];
    throw new AppError('PAGAMENTO JÁ CONFIRMADO', {
      status: 409,
      code: 'ORDER_ALREADY_PAID',
      details: {
        paid_at: order.paid_at || null,
        operator: lastPay?.user_name || null,
        payment_method: lastPay?.method || null,
        amount_paid_cents: order.amount_paid_cents,
      },
    });
  }

  // Marcações sem lançar caixa (devem vir ANTES da validação de payments)
  if (payload.mark_pix_pending) {
    return db.transaction(() => {
      db.prepare(
        `UPDATE delivery_orders
         SET payment_status = 'pix_pendente', updated_at = datetime('now')
         WHERE id = ?`
      ).run(Number(orderId));
      db.prepare(
        `INSERT INTO delivery_order_history (order_id, from_status, to_status, note, user_name)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        Number(orderId),
        order.status,
        order.status,
        'Aguardando confirmação PIX',
        getCurrentOperator()
      );
      return getDeliveryOrder(orderId);
    })();
  }

  if (payload.mark_pagamento_na_entrega) {
    const expected = payload.expected_payment_method
      ? String(payload.expected_payment_method).toLowerCase()
      : null;
    const changeFor =
      payload.change_for_cents != null && Number.isFinite(Number(payload.change_for_cents))
        ? Math.max(0, Math.round(Number(payload.change_for_cents)))
        : null;
    return db.transaction(() => {
      db.prepare(
        `UPDATE delivery_orders
         SET payment_status = 'pagamento_na_entrega',
             expected_payment_method = COALESCE(?, expected_payment_method),
             change_for_cents = COALESCE(?, change_for_cents),
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(expected, changeFor, Number(orderId));
      appendOrderHistory(
        db,
        orderId,
        order.status,
        order.status,
        'Pagamento na entrega — aguardando recebimento'
      );
      return getDeliveryOrder(orderId);
    })();
  }

  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  if (!payments.length && payload.payment_method) {
    payments.push({
      method: payload.payment_method,
      amount_cents: payload.amount_cents ?? Math.max(0, order.total_cents - order.amount_paid_cents),
      amount_received_cents: payload.amount_received_cents,
    });
  }
  if (!payments.length) {
    throw new AppError('Informe o pagamento', { status: 400, code: 'PAYMENT_REQUIRED' });
  }

  let paySum = 0;
  for (const p of payments) {
    const amt = Number(p.amount_cents);
    if (!Number.isInteger(amt) || amt <= 0) {
      throw new AppError('Valor de pagamento inválido', { status: 400, code: 'INVALID_PAYMENT' });
    }
    if (!['dinheiro', 'pix', 'cartao', 'crediario'].includes(p.method)) {
      throw new AppError('Forma de pagamento inválida', { status: 400, code: 'INVALID_METHOD' });
    }
    paySum += amt;
  }

  const due = order.total_cents - order.amount_paid_cents;
  if (paySum > due) {
    throw new AppError('Pagamento maior que o saldo do pedido', { status: 400, code: 'PAYMENT_OVER' });
  }

  const newPaid = order.amount_paid_cents + paySum;
  const fullyPaid = newPaid >= order.total_cents;
  const saleRequestId =
    payload.client_request_id || `order-pay-${orderId}-${newPaid}-${Date.now()}`;

  // createSale fora da transaction do pedido (evita nested transaction + recovery).
  // Lança no caixa SOMENTE o valor deste pagamento (misc), sem baixar produtos aqui.
  let saleId = order.sale_id;
  if (paySum > 0) {
    const sale = createSale({
      payment_method: payments.length === 1 ? payments[0].method : undefined,
      payments: payments.map((p) => ({
        method: p.method,
        amount_cents: p.amount_cents,
        card_type: p.card_type || null,
      })),
      amount_received_cents: payments.find((p) => p.method === 'dinheiro')?.amount_received_cents,
      discount_cents: 0,
      customer_id: order.customer_id,
      client_request_id: saleRequestId,
      notes: `Pagamento pedido ${order.order_number}${fullyPaid ? ' (quitação)' : ' (parcial)'}`,
      items: [
        {
          name: `Pagamento pedido ${order.order_number}`,
          quantity: 1,
          unit_price_cents: paySum,
          is_misc: true,
        },
      ],
    });
    saleId = sale.id;
  }

  return db.transaction(() => {
    // Revalida quitação (proteção contra corrida / duplo clique)
    const fresh = db.prepare(`SELECT * FROM delivery_orders WHERE id = ?`).get(Number(orderId));
    if (!fresh || fresh.status === 'cancelado') {
      throw new AppError('Pedido indisponível', { status: 409, code: 'ORDER_UNAVAILABLE' });
    }
    if (payload.client_request_id) {
      const dup = db
        .prepare(`SELECT id FROM delivery_order_payments WHERE client_request_id = ?`)
        .get(String(payload.client_request_id));
      if (dup) return getDeliveryOrder(orderId);
    }
    if (Number(fresh.amount_paid_cents) + paySum > Number(fresh.total_cents)) {
      throw new AppError('Pagamento maior que o saldo do pedido', { status: 400, code: 'PAYMENT_OVER' });
    }

    const insertPay = db.prepare(
      `INSERT INTO delivery_order_payments (
         order_id, method, amount_cents, amount_received_cents, change_cents, note, user_name, client_request_id, card_type
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of payments) {
      const received = p.amount_received_cents != null ? Number(p.amount_received_cents) : null;
      const change =
        received != null && Number.isInteger(received) ? Math.max(0, received - Number(p.amount_cents)) : 0;
      const cardType =
        p.method === 'cartao'
          ? p.card_type
            ? String(p.card_type).trim().toUpperCase()
            : null
          : null;
      if (p.method === 'cartao' && !cardType) {
        throw new AppError('Informe se o cartão é Crédito ou Débito', {
          status: 400,
          code: 'CARD_TYPE_REQUIRED',
        });
      }
      if (cardType && cardType !== 'CREDIT' && cardType !== 'DEBIT') {
        throw new AppError('Tipo de cartão inválido (use CREDIT ou DEBIT)', {
          status: 400,
          code: 'INVALID_CARD_TYPE',
        });
      }
      insertPay.run(
        Number(orderId),
        p.method,
        Number(p.amount_cents),
        received,
        change,
        p.note || null,
        getCurrentOperator(),
        payload.client_request_id && payments.length === 1
          ? String(payload.client_request_id)
          : p.client_request_id
            ? String(p.client_request_id)
            : null,
        cardType
      );
    }

    const paidNow = Number(fresh.amount_paid_cents) + paySum;
    const done = paidNow >= Number(fresh.total_cents);

    if (done) {
      const reservas = db
        .prepare(`SELECT * FROM stock_reservations WHERE order_id = ? AND status = 'ativa'`)
        .all(Number(orderId));
      for (const r of reservas) {
        applyStockMovement(
          {
            productId: r.product_id,
            movementType: 'sale',
            quantity: r.quantity,
            reason: `Pedido ${order.order_number} pago`,
            referenceType: 'delivery_order',
            referenceId: Number(orderId),
          },
          { db, skipAudit: true }
        );
        db.prepare(
          `UPDATE products SET reserved_qty = MAX(COALESCE(reserved_qty, 0) - ?, 0) WHERE id = ?`
        ).run(r.quantity, r.product_id);
        db.prepare(
          `UPDATE stock_reservations SET status = 'convertida', released_at = datetime('now') WHERE id = ?`
        ).run(r.id);
      }
    }

    const nextPayStatus = done ? 'pago' : 'parcial';
    const nextStatus = done
      ? fresh.status === 'aguardando_pagamento'
        ? 'aguardando_separacao'
        : fresh.status
      : fresh.status;

    db.prepare(
      `UPDATE delivery_orders
       SET amount_paid_cents = ?, payment_status = ?, status = ?, sale_id = ?,
           paid_at = CASE WHEN ? = 'pago' THEN datetime('now') ELSE paid_at END,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(paidNow, nextPayStatus, nextStatus, saleId, nextPayStatus, Number(orderId));

    db.prepare(
      `INSERT INTO delivery_order_history (order_id, from_status, to_status, note, user_name)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      Number(orderId),
      fresh.status,
      nextStatus,
      `Pagamento ${nextPayStatus}: +${(paySum / 100).toFixed(2)}`,
      getCurrentOperator()
    );

    writeAudit({
      action: 'delivery_order.payment',
      entityType: 'delivery_order',
      entityId: Number(orderId),
      details: { paySum, paidNow, fullyPaid: done, saleId },
      userName: getCurrentOperator(),
    });

    return getDeliveryOrder(orderId);
  })();
}

export function cancelDeliveryOrder(orderId, { reason } = {}) {
  const db = getDb();
  const order = getDeliveryOrder(orderId);
  if (order.status === 'cancelado') return order;
  if (order.payment_status === 'pago') {
    throw new AppError('Pedido pago não pode ser cancelado por este fluxo', {
      status: 409,
      code: 'ORDER_PAID',
    });
  }
  if (!reason || !String(reason).trim()) {
    throw new AppError('Motivo obrigatório', { status: 400, code: 'REASON_REQUIRED' });
  }

  return db.transaction(() => {
    const reservas = db
      .prepare(`SELECT * FROM stock_reservations WHERE order_id = ? AND status = 'ativa'`)
      .all(Number(orderId));
    for (const r of reservas) {
      db.prepare(
        `UPDATE products SET reserved_qty = MAX(COALESCE(reserved_qty, 0) - ?, 0) WHERE id = ?`
      ).run(r.quantity, r.product_id);
      db.prepare(
        `UPDATE stock_reservations SET status = 'liberada', released_at = datetime('now') WHERE id = ?`
      ).run(r.id);
    }

    db.prepare(
      `UPDATE delivery_orders
       SET status = 'cancelado', cancel_reason = ?, cancelled_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(String(reason).trim(), Number(orderId));

    db.prepare(
      `INSERT INTO delivery_order_history (order_id, from_status, to_status, note, user_name)
       VALUES (?, ?, 'cancelado', ?, ?)`
    ).run(Number(orderId), order.status, String(reason).trim(), getCurrentOperator());

    writeAudit({
      action: 'delivery_order.cancel',
      entityType: 'delivery_order',
      entityId: Number(orderId),
      details: { reason },
      userName: getCurrentOperator(),
    });

    return getDeliveryOrder(orderId);
  })();
}

const SEPARATION_LOCK_STATUSES = new Set(['separado', 'pronto_para_entrega']);

export function updateDeliveryOrderStatus(orderId, toStatus, note, { allowUnchecked = false, userRole } = {}) {
  const db = getDb();
  if (!ORDER_STATUSES.has(toStatus)) {
    throw new AppError('Status inválido', { status: 400, code: 'INVALID_STATUS' });
  }
  const order = getDeliveryOrder(orderId);
  if (order.status === 'cancelado') {
    throw new AppError('Pedido cancelado', { status: 409, code: 'ORDER_CANCELLED' });
  }
  const unpaidBlock =
    ['nao_pago', 'pix_pendente', 'pagamento_na_entrega'].includes(order.payment_status) &&
    toStatus !== 'aguardando_pagamento' &&
    toStatus !== 'cancelado';
  if (unpaidBlock) {
    throw new AppError('Confirme o pagamento antes de avançar o pedido', {
      status: 409,
      code: 'PAYMENT_REQUIRED_FIRST',
    });
  }

  if (SEPARATION_LOCK_STATUSES.has(toStatus) && !order.all_items_checked) {
    const isAdmin = userRole === 'administrador';
    if (!allowUnchecked || !isAdmin) {
      throw new AppError('AINDA EXISTEM PRODUTOS NÃO CONFERIDOS.', {
        status: 409,
        code: 'ITEMS_NOT_CHECKED',
      });
    }
    if (!note || !String(note).trim()) {
      throw new AppError('Motivo obrigatório para liberação excepcional', {
        status: 400,
        code: 'EXCEPTION_REASON_REQUIRED',
      });
    }
  }

  const historyNote =
    SEPARATION_LOCK_STATUSES.has(toStatus) && !order.all_items_checked && allowUnchecked
      ? `Liberação excepcional (itens não conferidos): ${String(note).trim()}`
      : note || null;

  db.prepare(
    `UPDATE delivery_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(toStatus, Number(orderId));
  db.prepare(
    `INSERT INTO delivery_order_history (order_id, from_status, to_status, note, user_name)
     VALUES (?, ?, ?, ?, ?)`
  ).run(Number(orderId), order.status, toStatus, historyNote, getCurrentOperator());
  return getDeliveryOrder(orderId);
}

/**
 * Conferência por código de barras (ou código interno/SKU).
 * Incrementa checked_qty em +1 por leitura.
 */
export function scanDeliveryOrderBarcode(orderId, barcodeRaw) {
  const db = getDb();
  const code = String(barcodeRaw || '').trim();
  if (!code) {
    throw new AppError('Código vazio', { status: 400, code: 'EMPTY_BARCODE' });
  }
  const order = getDeliveryOrder(orderId);
  if (order.status === 'cancelado') {
    throw new AppError('Pedido cancelado', { status: 409, code: 'ORDER_CANCELLED' });
  }

  const product = db
    .prepare(
      `SELECT id, name, barcode, sku FROM products
       WHERE active = 1 AND (barcode = ? OR sku = ? OR CAST(id AS TEXT) = ?)
       LIMIT 1`
    )
    .get(code, code, code);

  if (!product) {
    throw new AppError('PRODUTO NÃO PERTENCE A ESTE PEDIDO', {
      status: 404,
      code: 'PRODUCT_NOT_IN_ORDER',
      details: { barcode: code, found: false, product_name: null },
    });
  }

  const item = order.items.find((i) => Number(i.product_id) === Number(product.id));
  if (!item) {
    throw new AppError('PRODUTO NÃO PERTENCE A ESTE PEDIDO', {
      status: 409,
      code: 'PRODUCT_NOT_IN_ORDER',
      details: {
        barcode: code,
        found: true,
        product_name: product.name,
        product_id: product.id,
      },
    });
  }

  if (Number(item.checked_qty) >= Number(item.quantity)) {
    throw new AppError('QUANTIDADE DO PEDIDO JÁ CONFERIDA.', {
      status: 409,
      code: 'ALREADY_CHECKED',
      details: {
        item_id: item.id,
        product_name: item.product_name,
        quantity: item.quantity,
        checked_qty: item.checked_qty,
      },
    });
  }

  return db.transaction(() => {
    db.prepare(
      `UPDATE delivery_order_items SET checked_qty = checked_qty + 1 WHERE id = ?`
    ).run(item.id);
    db.prepare(
      `INSERT INTO delivery_order_scans (
         order_id, item_id, product_id, product_name, barcode_read, quantity, method, user_name
       ) VALUES (?, ?, ?, ?, ?, 1, 'barcode', ?)`
    ).run(
      Number(orderId),
      item.id,
      product.id,
      product.name,
      code,
      getCurrentOperator()
    );

    if (order.status === 'aguardando_separacao') {
      db.prepare(
        `UPDATE delivery_orders SET status = 'em_separacao', updated_at = datetime('now') WHERE id = ?`
      ).run(Number(orderId));
      db.prepare(
        `INSERT INTO delivery_order_history (order_id, from_status, to_status, note, user_name)
         VALUES (?, ?, 'em_separacao', ?, ?)`
      ).run(Number(orderId), order.status, 'Início da conferência', getCurrentOperator());
    }

    writeAudit({
      action: 'delivery_order.scan',
      entityType: 'delivery_order',
      entityId: Number(orderId),
      details: { barcode: code, product_id: product.id, item_id: item.id, method: 'barcode' },
      userName: getCurrentOperator(),
    });

    const updated = getDeliveryOrder(orderId);
    const updatedItem = updated.items.find((i) => i.id === item.id);
    return {
      ok: true,
      beep: true,
      message: updatedItem?.check_status === 'CONFERIDO' ? 'Item CONFERIDO' : 'Unidade conferida',
      item: updatedItem,
      order: updated,
    };
  })();
}

/** Conferência manual (produtos sem código). Requer autenticação; admin ou operador. */
export function confirmDeliveryOrderItemManual(orderId, itemId, { quantity } = {}) {
  const db = getDb();
  const order = getDeliveryOrder(orderId);
  if (order.status === 'cancelado') {
    throw new AppError('Pedido cancelado', { status: 409, code: 'ORDER_CANCELLED' });
  }
  const item = order.items.find((i) => Number(i.id) === Number(itemId));
  if (!item) {
    throw new AppError('Item não encontrado no pedido', { status: 404, code: 'ITEM_NOT_FOUND' });
  }
  const remaining = Math.max(0, Number(item.quantity) - Number(item.checked_qty));
  if (remaining <= 0) {
    throw new AppError('QUANTIDADE DO PEDIDO JÁ CONFERIDA.', {
      status: 409,
      code: 'ALREADY_CHECKED',
    });
  }
  const add = quantity != null ? Number(quantity) : remaining;
  if (!Number.isInteger(add) || add <= 0 || add > remaining) {
    throw new AppError('Quantidade de conferência inválida', { status: 400, code: 'INVALID_CHECK_QTY' });
  }

  return db.transaction(() => {
    db.prepare(
      `UPDATE delivery_order_items SET checked_qty = checked_qty + ? WHERE id = ?`
    ).run(add, item.id);
    db.prepare(
      `INSERT INTO delivery_order_scans (
         order_id, item_id, product_id, product_name, barcode_read, quantity, method, user_name, note
       ) VALUES (?, ?, ?, ?, NULL, ?, 'manual', ?, ?)`
    ).run(
      Number(orderId),
      item.id,
      item.product_id,
      item.product_name,
      add,
      getCurrentOperator(),
      'Conferência manual'
    );
    writeAudit({
      action: 'delivery_order.scan_manual',
      entityType: 'delivery_order',
      entityId: Number(orderId),
      details: { item_id: item.id, quantity: add, method: 'manual' },
      userName: getCurrentOperator(),
    });
    return getDeliveryOrder(orderId);
  })();
}

/** Disponibilidade para UI/estoque. */
export function getProductAvailability(productId) {
  const db = getDb();
  const p = availableStock(db, productId);
  return {
    product_id: p.id,
    name: p.name,
    stock_qty: p.stock_qty,
    reserved_qty: p.reserved_qty,
    available_qty: p.available,
  };
}
