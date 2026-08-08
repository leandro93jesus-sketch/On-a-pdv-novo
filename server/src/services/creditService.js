import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';
import { assertNonNegativeCents } from '../utils/money.js';
import { writeAudit } from './auditService.js';
import { getCurrentOperator } from './settingsService.js';

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function markOverdueInstallments(db = getDb()) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `UPDATE credit_installments
     SET status = 'vencido'
     WHERE status IN ('aberto', 'parcialmente_pago')
       AND due_date < ?
       AND paid_cents < amount_cents`
  ).run(today);

  db.prepare(
    `UPDATE credit_accounts
     SET status = 'vencido', updated_at = datetime('now')
     WHERE status IN ('aberto', 'parcialmente_pago')
       AND EXISTS (
         SELECT 1 FROM credit_installments i
         WHERE i.credit_account_id = credit_accounts.id AND i.status = 'vencido'
       )`
  ).run();
}

function refreshAccountStatus(db, accountId) {
  const account = db.prepare('SELECT * FROM credit_accounts WHERE id = ?').get(accountId);
  if (!account || account.status === 'cancelado') return;
  const today = new Date().toISOString().slice(0, 10);
  const installments = db
    .prepare('SELECT * FROM credit_installments WHERE credit_account_id = ? ORDER BY installment_number')
    .all(accountId);

  for (const inst of installments) {
    if (inst.paid_cents >= inst.amount_cents) {
      db.prepare(`UPDATE credit_installments SET status='quitado' WHERE id=?`).run(inst.id);
    } else if (inst.paid_cents > 0) {
      const status = inst.due_date < today ? 'vencido' : 'parcialmente_pago';
      db.prepare(`UPDATE credit_installments SET status=? WHERE id=?`).run(status, inst.id);
    } else if (inst.due_date < today) {
      db.prepare(`UPDATE credit_installments SET status='vencido' WHERE id=?`).run(inst.id);
    } else {
      db.prepare(`UPDATE credit_installments SET status='aberto' WHERE id=?`).run(inst.id);
    }
  }

  const balance = Number(
    db.prepare(
      `SELECT COALESCE(SUM(amount_cents - paid_cents),0) AS b
       FROM credit_installments WHERE credit_account_id = ?`
    ).get(accountId).b
  );
  let status = 'aberto';
  if (balance <= 0) status = 'quitado';
  else if (
    db.prepare(
      `SELECT COUNT(*) AS c FROM credit_installments WHERE credit_account_id=? AND status='vencido'`
    ).get(accountId).c > 0
  ) {
    status = 'vencido';
  } else if (
    db.prepare(
      `SELECT COUNT(*) AS c FROM credit_installments WHERE credit_account_id=? AND paid_cents > 0`
    ).get(accountId).c > 0
  ) {
    status = 'parcialmente_pago';
  }

  db.prepare(
    `UPDATE credit_accounts SET balance_cents=?, status=?, updated_at=datetime('now') WHERE id=?`
  ).run(Math.max(balance, 0), status, accountId);
}

export function getCreditAccountById(id) {
  const db = getDb();
  markOverdueInstallments(db);
  const account = db.prepare('SELECT * FROM credit_accounts WHERE id = ?').get(Number(id));
  if (!account) throw new AppError('Conta de crediário não encontrada', { status: 404, code: 'CREDIT_NOT_FOUND' });
  const customer = db.prepare('SELECT id, name, document, phone FROM customers WHERE id = ?').get(account.customer_id);
  const installments = db
    .prepare('SELECT * FROM credit_installments WHERE credit_account_id = ? ORDER BY installment_number')
    .all(Number(id));
  const payments = db
    .prepare('SELECT * FROM credit_payments WHERE credit_account_id = ? ORDER BY id DESC')
    .all(Number(id));
  const sale = db.prepare('SELECT id, sale_number, total_cents, created_at FROM sales WHERE id = ?').get(account.sale_id);
  return { ...account, customer, installments, payments, sale };
}

export function listCreditAccounts({ status, customerId, limit = 100 } = {}) {
  const db = getDb();
  markOverdueInstallments(db);
  const where = [];
  const params = [];
  if (status) {
    where.push('a.status = ?');
    params.push(status);
  }
  if (customerId) {
    where.push('a.customer_id = ?');
    params.push(Number(customerId));
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 300);
  params.push(safeLimit);
  return db
    .prepare(
      `SELECT a.*, c.name AS customer_name, s.sale_number
       FROM credit_accounts a
       JOIN customers c ON c.id = a.customer_id
       JOIN sales s ON s.id = a.sale_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(...params);
}

export function getCreditSummary() {
  const db = getDb();
  markOverdueInstallments(db);
  const open = db
    .prepare(
      `SELECT COALESCE(SUM(balance_cents),0) AS total FROM credit_accounts WHERE status IN ('aberto','parcialmente_pago','vencido')`
    )
    .get().total;
  const overdue = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents - paid_cents),0) AS total
       FROM credit_installments WHERE status = 'vencido'`
    )
    .get().total;
  const received = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN is_reversal=1 THEN -amount_cents ELSE amount_cents END),0) AS total
       FROM credit_payments`
    )
    .get().total;
  const customersOpen = db
    .prepare(
      `SELECT COUNT(DISTINCT customer_id) AS c FROM credit_accounts
       WHERE status IN ('aberto','parcialmente_pago','vencido') AND balance_cents > 0`
    )
    .get().c;
  return {
    total_open_cents: open,
    total_overdue_cents: overdue,
    total_received_cents: received,
    customers_with_balance: customersOpen,
  };
}

/** Chamado dentro da transaction da venda. */
export function createCreditAccountFromSale(db, {
  saleId,
  customerId,
  totalCents,
  entryCents = 0,
  installmentCount = 1,
  firstDueDate = null,
  notes = null,
}) {
  const entry = assertNonNegativeCents(entryCents, 'entry_cents');
  const total = assertNonNegativeCents(totalCents, 'total_cents');
  if (entry > total) throw new AppError('Entrada maior que o total', { status: 400, code: 'INVALID_ENTRY' });
  const count = Number(installmentCount);
  if (!Number.isInteger(count) || count <= 0) {
    throw new AppError('Número de parcelas inválido', { status: 400, code: 'INVALID_INSTALLMENTS' });
  }
  const balance = total - entry;
  const dueBase = firstDueDate || addMonths(new Date().toISOString().slice(0, 10), 1);

  const info = db
    .prepare(
      `INSERT INTO credit_accounts (
         customer_id, sale_id, total_cents, entry_cents, balance_cents, installment_count, status, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      customerId,
      saleId,
      total,
      entry,
      balance,
      count,
      balance === 0 ? 'quitado' : 'aberto',
      notes
    );
  const accountId = Number(info.lastInsertRowid);

  if (balance === 0) {
    db.prepare(
      `INSERT INTO credit_installments (
         credit_account_id, installment_number, due_date, amount_cents, paid_cents, status
       ) VALUES (?, 1, ?, 0, 0, 'quitado')`
    ).run(accountId, dueBase);
    return accountId;
  }

  const base = Math.floor(balance / count);
  let remainder = balance - base * count;
  const insert = db.prepare(
    `INSERT INTO credit_installments (
       credit_account_id, installment_number, due_date, amount_cents, paid_cents, status
     ) VALUES (?, ?, ?, ?, 0, 'aberto')`
  );
  for (let i = 1; i <= count; i++) {
    const amount = base + (i === count ? remainder : 0);
    insert.run(accountId, i, addMonths(dueBase, i - 1), amount);
  }

  if (entry > 0) {
    // registra entrada como pagamento sem parcela específica
    db.prepare(
      `INSERT INTO credit_payments (
         credit_account_id, installment_id, amount_cents, method, user_name, notes
       ) VALUES (?, NULL, ?, 'dinheiro', ?, 'Entrada na venda')`
    ).run(accountId, entry, getCurrentOperator());
  }

  return accountId;
}

export function registerCreditPayment(payload = {}) {
  const db = getDb();
  const accountId = Number(payload.credit_account_id);
  const amount = assertNonNegativeCents(payload.amount_cents, 'amount_cents');
  if (amount <= 0) throw new AppError('Valor do pagamento deve ser > 0', { status: 400, code: 'INVALID_AMOUNT' });
  const method = String(payload.method || 'dinheiro').toLowerCase();
  if (!['dinheiro', 'pix', 'cartao'].includes(method)) {
    throw new AppError('Forma de pagamento inválida', { status: 400, code: 'INVALID_PAYMENT_METHOD' });
  }
  const userName = String(payload.user_name || getCurrentOperator()).trim();
  const notes = payload.notes ? String(payload.notes).trim() : null;

  return db.transaction(() => {
    markOverdueInstallments(db);
    const account = db.prepare('SELECT * FROM credit_accounts WHERE id = ?').get(accountId);
    if (!account) throw new AppError('Conta não encontrada', { status: 404, code: 'CREDIT_NOT_FOUND' });
    if (account.status === 'cancelado' || account.status === 'quitado') {
      throw new AppError('Conta não admite novos pagamentos', { status: 409, code: 'CREDIT_CLOSED' });
    }
    if (amount > account.balance_cents) {
      throw new AppError('Pagamento maior que o saldo', { status: 400, code: 'PAYMENT_EXCEEDS_BALANCE' });
    }

    let remaining = amount;
    const installments = db
      .prepare(
        `SELECT * FROM credit_installments
         WHERE credit_account_id = ? AND paid_cents < amount_cents
         ORDER BY installment_number`
      )
      .all(accountId);

    for (const inst of installments) {
      if (remaining <= 0) break;
      const due = inst.amount_cents - inst.paid_cents;
      const pay = Math.min(due, remaining);
      db.prepare(`UPDATE credit_installments SET paid_cents = paid_cents + ? WHERE id = ?`).run(pay, inst.id);
      db.prepare(
        `INSERT INTO credit_payments (
           credit_account_id, installment_id, amount_cents, method, user_name, notes
         ) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(accountId, inst.id, pay, method, userName, notes);
      remaining -= pay;
    }

    refreshAccountStatus(db, accountId);
    writeAudit({
      action: 'credit.payment',
      entityType: 'credit_account',
      entityId: accountId,
      details: { amount_cents: amount, method },
      userName,
    });
    return getCreditAccountById(accountId);
  })();
}

export function reverseCreditPayment(paymentId, payload = {}) {
  const db = getDb();
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!reason) throw new AppError('Motivo do estorno é obrigatório', { status: 400, code: 'REASON_REQUIRED' });
  const userName = String(payload.user_name || getCurrentOperator()).trim();

  return db.transaction(() => {
    const payment = db.prepare('SELECT * FROM credit_payments WHERE id = ?').get(Number(paymentId));
    if (!payment) throw new AppError('Pagamento não encontrado', { status: 404, code: 'PAYMENT_NOT_FOUND' });
    if (payment.is_reversal) throw new AppError('Lançamento já é um estorno', { status: 409, code: 'ALREADY_REVERSAL' });
    const already = db
      .prepare('SELECT id FROM credit_payments WHERE reverses_payment_id = ?')
      .get(payment.id);
    if (already) throw new AppError('Pagamento já estornado', { status: 409, code: 'ALREADY_REVERSED' });

    if (payment.installment_id) {
      db.prepare(
        `UPDATE credit_installments SET paid_cents = MAX(paid_cents - ?, 0) WHERE id = ?`
      ).run(payment.amount_cents, payment.installment_id);
    }

    db.prepare(
      `INSERT INTO credit_payments (
         credit_account_id, installment_id, amount_cents, method, user_name, notes, is_reversal, reverses_payment_id
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      payment.credit_account_id,
      payment.installment_id,
      payment.amount_cents,
      payment.method,
      userName,
      reason,
      payment.id
    );

    refreshAccountStatus(db, payment.credit_account_id);
    writeAudit({
      action: 'credit.payment_reversal',
      entityType: 'credit_account',
      entityId: payment.credit_account_id,
      details: { payment_id: payment.id, reason },
      userName,
    });
    return getCreditAccountById(payment.credit_account_id);
  })();
}
