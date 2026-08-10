import { getDb } from '../db/index.js';
import { writeAudit } from './auditService.js';
import { getCurrentOperator } from './settingsService.js';

const EXPORTERS = {
  products: {
    filename: 'produtos',
    sql: `SELECT id, sku, barcode, name, category, unit, price_cents, cost_cents,
                 stock_qty, min_stock_qty, active, created_at, updated_at
          FROM products ORDER BY name`,
  },
  stock: {
    filename: 'estoque',
    sql: `SELECT id, sku, barcode, name, category, stock_qty, min_stock_qty, unit, active
          FROM products WHERE active = 1 ORDER BY name`,
  },
  customers: {
    filename: 'clientes',
    sql: `SELECT id, name, document, phone, whatsapp, city, active, created_at
          FROM customers ORDER BY name`,
  },
  sales: {
    filename: 'vendas',
    sql: `SELECT s.id, s.sale_number, s.status, s.subtotal_cents, s.discount_cents, s.total_cents,
                 s.change_cents, s.amount_received_cents, s.created_at, c.name AS customer_name,
                 (SELECT GROUP_CONCAT(method || ':' || amount_cents, '|')
                    FROM sale_payments sp WHERE sp.sale_id = s.id) AS payments
          FROM sales s
          LEFT JOIN customers c ON c.id = s.customer_id
          ORDER BY s.id DESC`,
  },
  credit: {
    filename: 'crediario',
    sql: `SELECT a.id, a.sale_id, a.total_cents, a.entry_cents, a.balance_cents,
                 a.installment_count, a.status, a.created_at, c.name AS customer_name
          FROM credit_accounts a
          LEFT JOIN customers c ON c.id = a.customer_id
          ORDER BY a.id DESC`,
  },
};

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function listExportDatasets() {
  return Object.keys(EXPORTERS);
}

export function exportDatasetCsv(dataset) {
  const cfg = EXPORTERS[dataset];
  if (!cfg) {
    const err = new Error('Dataset de exportação inválido');
    err.status = 400;
    err.code = 'INVALID_EXPORT_DATASET';
    throw err;
  }
  const rows = getDb().prepare(cfg.sql).all();
  const columns = rows.length
    ? Object.keys(rows[0])
    : cfg.sql
        .replace(/[\s\S]*SELECT\s+/i, '')
        .replace(/\s+FROM[\s\S]*/i, '')
        .split(',')
        .map((c) => c.trim().split(/\s+AS\s+/i).pop().split('.').pop());

  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col])).join(','));
  }
  const csv = `\uFEFF${lines.join('\n')}\n`;
  writeAudit({
    action: 'export.csv',
    entityType: 'export',
    details: { dataset, rows: rows.length },
    userName: getCurrentOperator(),
  });
  return {
    dataset,
    filename: `onca-pdv-${cfg.filename}-${new Date().toISOString().slice(0, 10)}.csv`,
    mime: 'text/csv; charset=utf-8',
    content: csv,
    rows: rows.length,
  };
}
