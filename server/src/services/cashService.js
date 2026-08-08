import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { assertNonNegativeCents } from '../utils/money.js';
import { getCurrentOperator, getTerminalId } from './settingsService.js';
import { writeAudit } from './auditService.js';

function mapSession(row) {
  if (!row) return null;
  return { ...row };
}

export function getOpenCashSession(terminalId = getTerminalId()) {
  return mapSession(
    getDb()
      .prepare(`SELECT * FROM cash_sessions WHERE terminal_id = ? AND status = 'open'`)
      .get(terminalId)
  );
}

export function requireOpenCashSession(terminalId = getTerminalId()) {
  const session = getOpenCashSession(terminalId);
  if (!session) {
    throw new AppError('Não há caixa aberto neste terminal. Abra o caixa antes de vender.', {
      status: 409,
      code: 'CASH_SESSION_REQUIRED',
    });
  }
  return session;
}

export function getCashSessionById(id) {
  const row = getDb().prepare('SELECT * FROM cash_sessions WHERE id = ?').get(Number(id));
  if (!row) {
    throw new AppError('Sessão de caixa não encontrada', { status: 404, code: 'CASH_NOT_FOUND' });
  }
  return mapSession(row);
}

export function listCashSessions({ limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return getDb()
    .prepare(`SELECT * FROM cash_sessions ORDER BY id DESC LIMIT ?`)
    .all(safeLimit)
    .map(mapSession);
}

export function listCashMovements(sessionId, { limit = 200 } = {}) {
  getCashSessionById(sessionId);
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
  return getDb()
    .prepare(
      `SELECT * FROM cash_movements
       WHERE cash_session_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(Number(sessionId), safeLimit);
}

export function openCashSession(payload = {}) {
  const db = getDb();
  const terminalId = String(payload.terminal_id || getTerminalId()).trim() || 'TERM-1';
  const operator = String(payload.operator_name || getCurrentOperator()).trim();
  if (!operator) {
    throw new AppError('Operador é obrigatório', { status: 400, code: 'OPERATOR_REQUIRED' });
  }
  const opening = assertNonNegativeCents(payload.opening_amount_cents ?? 0, 'opening_amount_cents');

  return db.transaction(() => {
    const existing = getOpenCashSession(terminalId);
    if (existing) {
      throw new AppError('Já existe um caixa aberto neste terminal', {
        status: 409,
        code: 'CASH_ALREADY_OPEN',
        details: { session_id: existing.id },
      });
    }

    const info = db
      .prepare(
        `INSERT INTO cash_sessions (terminal_id, operator_name, status, opening_amount_cents)
         VALUES (?, ?, 'open', ?)`
      )
      .run(terminalId, operator, opening);
    const id = Number(info.lastInsertRowid);

    db.prepare(
      `INSERT INTO cash_movements (
         cash_session_id, movement_type, amount_cents, payment_method, reason, user_name
       ) VALUES (?, 'abertura', ?, 'dinheiro', 'Abertura de caixa', ?)`
    ).run(id, opening, operator);

    writeAudit({
      action: 'cash.open',
      entityType: 'cash_session',
      entityId: id,
      details: { terminalId, operator, opening },
      userName: operator,
    });

    return getCashSessionById(id);
  })();
}

function addCashMovementTx(db, {
  sessionId,
  movementType,
  amountCents,
  paymentMethod = null,
  reason = null,
  userName = null,
  referenceType = null,
  referenceId = null,
}) {
  const amount = assertNonNegativeCents(amountCents, 'amount_cents');
  db.prepare(
    `INSERT INTO cash_movements (
       cash_session_id, movement_type, amount_cents, payment_method,
       reason, user_name, reference_type, reference_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    movementType,
    amount,
    paymentMethod,
    reason,
    userName || getCurrentOperator(),
    referenceType,
    referenceId
  );

  if (movementType === 'sangria' || movementType === 'saida') {
    db.prepare(
      `UPDATE cash_sessions SET cash_out_cents = cash_out_cents + ? WHERE id = ?`
    ).run(amount, sessionId);
  } else if (movementType === 'suprimento' || movementType === 'entrada') {
    db.prepare(
      `UPDATE cash_sessions SET cash_in_cents = cash_in_cents + ? WHERE id = ?`
    ).run(amount, sessionId);
  }
}

export function registerCashMovement(payload = {}) {
  const db = getDb();
  const type = String(payload.movement_type || '').trim();
  if (!['sangria', 'suprimento', 'entrada', 'saida'].includes(type)) {
    throw new AppError('Tipo de movimento de caixa inválido', {
      status: 400,
      code: 'INVALID_CASH_TYPE',
    });
  }
  if (!payload.reason || !String(payload.reason).trim()) {
    throw new AppError('Motivo é obrigatório', { status: 400, code: 'REASON_REQUIRED' });
  }

  return db.transaction(() => {
    const session = requireOpenCashSession(payload.terminal_id);
    addCashMovementTx(db, {
      sessionId: session.id,
      movementType: type,
      amountCents: payload.amount_cents,
      paymentMethod: 'dinheiro',
      reason: String(payload.reason).trim(),
      userName: payload.user_name || session.operator_name,
    });
    writeAudit({
      action: `cash.${type}`,
      entityType: 'cash_session',
      entityId: session.id,
      details: { amount_cents: payload.amount_cents, reason: payload.reason },
    });
    return getCashSessionById(session.id);
  })();
}

/** Registra venda no caixa (chamado dentro da transaction da venda). */
export function recordSaleOnCash(db, { sessionId, saleId, totalCents, payments }) {
  let dinheiro = 0;
  let pix = 0;
  let cartao = 0;
  let crediario = 0;
  for (const p of payments) {
    if (p.method === 'dinheiro') dinheiro += p.amount_cents;
    else if (p.method === 'pix') pix += p.amount_cents;
    else if (p.method === 'cartao') cartao += p.amount_cents;
    else if (p.method === 'crediario') crediario += p.amount_cents;
  }

  db.prepare(
    `UPDATE cash_sessions SET
       sales_total_cents = sales_total_cents + ?,
       sales_dinheiro_cents = sales_dinheiro_cents + ?,
       sales_pix_cents = sales_pix_cents + ?,
       sales_cartao_cents = sales_cartao_cents + ?,
       sales_crediario_cents = sales_crediario_cents + ?
     WHERE id = ? AND status = 'open'`
  ).run(totalCents, dinheiro, pix, cartao, crediario, sessionId);

  const method =
    payments.length === 1 ? payments[0].method : 'misto';
  addCashMovementTx(db, {
    sessionId,
    movementType: 'venda',
    amountCents: totalCents,
    paymentMethod: method,
    reason: `Venda #${saleId}`,
    referenceType: 'sale',
    referenceId: saleId,
  });
}

/** Estorno de venda cancelada no caixa. */
export function recordSaleCancelOnCash(db, { sessionId, saleId, totalCents, payments, reason, userName }) {
  let dinheiro = 0;
  let pix = 0;
  let cartao = 0;
  let crediario = 0;
  for (const p of payments) {
    if (p.method === 'dinheiro') dinheiro += p.amount_cents;
    else if (p.method === 'pix') pix += p.amount_cents;
    else if (p.method === 'cartao') cartao += p.amount_cents;
    else if (p.method === 'crediario') crediario += p.amount_cents;
  }

  db.prepare(
    `UPDATE cash_sessions SET
       sales_total_cents = MAX(sales_total_cents - ?, 0),
       sales_dinheiro_cents = MAX(sales_dinheiro_cents - ?, 0),
       sales_pix_cents = MAX(sales_pix_cents - ?, 0),
       sales_cartao_cents = MAX(sales_cartao_cents - ?, 0),
       sales_crediario_cents = MAX(sales_crediario_cents - ?, 0)
     WHERE id = ?`
  ).run(totalCents, dinheiro, pix, cartao, crediario, sessionId);

  addCashMovementTx(db, {
    sessionId,
    movementType: 'cancelamento_venda',
    amountCents: totalCents,
    paymentMethod: payments.length === 1 ? payments[0].method : 'misto',
    reason: reason || `Cancelamento venda #${saleId}`,
    userName,
    referenceType: 'sale',
    referenceId: saleId,
  });
}

export function computeExpectedCash(session) {
  // Valor esperado em dinheiro no gaveteiro
  return (
    session.opening_amount_cents +
    session.sales_dinheiro_cents +
    session.cash_in_cents -
    session.cash_out_cents
  );
}

export function getCashConference(sessionId) {
  const session = getCashSessionById(sessionId);
  const expected = computeExpectedCash(session);
  return {
    session,
    expected_amount_cents: expected,
    breakdown: {
      opening_amount_cents: session.opening_amount_cents,
      sales_total_cents: session.sales_total_cents,
      sales_dinheiro_cents: session.sales_dinheiro_cents,
      sales_pix_cents: session.sales_pix_cents,
      sales_cartao_cents: session.sales_cartao_cents,
      sales_crediario_cents: session.sales_crediario_cents || 0,
      cash_in_cents: session.cash_in_cents,
      cash_out_cents: session.cash_out_cents,
      expected_amount_cents: expected,
      counted_amount_cents: session.counted_amount_cents,
      difference_cents: session.difference_cents,
    },
  };
}

export function closeCashSession(payload = {}) {
  const db = getDb();
  return db.transaction(() => {
    const session = requireOpenCashSession(payload.terminal_id);
    const counted = assertNonNegativeCents(payload.counted_amount_cents, 'counted_amount_cents');
    const expected = computeExpectedCash(session);
    const difference = counted - expected;

    db.prepare(
      `UPDATE cash_sessions SET
         status = 'closed',
         closed_at = datetime('now'),
         expected_amount_cents = ?,
         counted_amount_cents = ?,
         difference_cents = ?,
         close_notes = ?
       WHERE id = ?`
    ).run(
      expected,
      counted,
      difference,
      payload.close_notes ? String(payload.close_notes).trim() : null,
      session.id
    );

    writeAudit({
      action: 'cash.close',
      entityType: 'cash_session',
      entityId: session.id,
      details: { expected, counted, difference },
      userName: payload.user_name || session.operator_name,
    });

    return getCashConference(session.id);
  })();
}

/** Correção após fechamento: gera ajuste auditado (nunca alteração silenciosa). */
export function adjustClosedCashSession(sessionId, payload = {}) {
  const db = getDb();
  const session = db.prepare(`SELECT * FROM cash_sessions WHERE id = ?`).get(Number(sessionId));
  if (!session) {
    throw new AppError('Sessão de caixa não encontrada', { status: 404, code: 'CASH_NOT_FOUND' });
  }
  if (session.status !== 'closed') {
    throw new AppError('Ajuste pós-fechamento só se aplica a caixa fechado', {
      status: 400,
      code: 'CASH_NOT_CLOSED',
    });
  }
  if (!payload.reason || !String(payload.reason).trim()) {
    throw new AppError('Motivo do ajuste é obrigatório', { status: 400, code: 'REASON_REQUIRED' });
  }
  const amount = assertNonNegativeCents(payload.counted_amount_cents, 'counted_amount_cents');
  const expected = session.expected_amount_cents;
  const difference = amount - expected;

  return db.transaction(() => {
    db.prepare(
      `UPDATE cash_sessions SET
         counted_amount_cents = ?,
         difference_cents = ?,
         close_notes = TRIM(COALESCE(close_notes,'') || ' | Ajuste: ' || ?)
       WHERE id = ?`
    ).run(amount, difference, String(payload.reason).trim(), session.id);

    db.prepare(
      `INSERT INTO cash_session_adjustments (cash_session_id, amount_cents, reason, user_name)
       VALUES (?, ?, ?, ?)`
    ).run(
      session.id,
      amount,
      String(payload.reason).trim(),
      payload.user_name || getCurrentOperator()
    );

    writeAudit({
      action: 'cash.adjust_closed',
      entityType: 'cash_session',
      entityId: session.id,
      details: {
        previous_counted: session.counted_amount_cents,
        new_counted: amount,
        difference,
        reason: String(payload.reason).trim(),
      },
      userName: payload.user_name || getCurrentOperator(),
    });

    return getCashConference(session.id);
  })();
}

export function reprintCashClosing(sessionId) {
  return getCashConference(Number(sessionId));
}
