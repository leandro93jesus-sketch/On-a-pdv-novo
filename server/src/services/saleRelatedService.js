import { getDb } from '../db/index.js';

/**
 * Dados relacionados a uma venda para exibição no detalhe do histórico:
 * crediário, entrega (pedido ou agendamento) e devoluções.
 * Somente leitura — não altera venda, estoque, caixa nem crediário.
 */
export function getSaleRelated(saleId) {
  const db = getDb();
  const id = Number(saleId);

  const credit = db
    .prepare(
      `SELECT id, status, total_cents, entry_cents, balance_cents, installment_count, created_at
       FROM credit_accounts WHERE sale_id = ?`
    )
    .get(id);

  let creditInfo = null;
  if (credit) {
    const installments = db
      .prepare(
        `SELECT installment_number, due_date, amount_cents, paid_cents AS paid_amount_cents, status
         FROM credit_installments WHERE credit_account_id = ? ORDER BY installment_number`
      )
      .all(credit.id);
    const paid = db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS paid_cents FROM credit_payments WHERE credit_account_id = ?`
      )
      .get(credit.id);
    creditInfo = {
      ...credit,
      paid_cents: Number(paid?.paid_cents || 0),
      installments,
    };
  }

  const deliveryOrder = db
    .prepare(
      `SELECT id, status, payment_status, total_cents, amount_paid_cents, courier_name,
              scheduled_date, period, created_at
       FROM delivery_orders WHERE sale_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(id);

  const delivery = db
    .prepare(
      `SELECT id, status, scheduled_date, period, courier_name, city, neighborhood, created_at
       FROM deliveries WHERE sale_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(id);

  const returns = db
    .prepare(
      `SELECT id, total_cents, reason, created_at FROM returns WHERE sale_id = ? ORDER BY id DESC`
    )
    .all(id);

  return {
    sale_id: id,
    credit: creditInfo,
    delivery_order: deliveryOrder ?? null,
    delivery: delivery ?? null,
    returns,
  };
}
