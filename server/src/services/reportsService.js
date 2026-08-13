import { getDb } from '../db/index.js';
import { AppError } from '../utils/errors.js';

function dateRange(filters = {}) {
  const from = filters.from || filters.date_from || null;
  const to = filters.to || filters.date_to || null;
  return { from, to };
}

function betweenClause(column, from, to, params) {
  const parts = [];
  if (from) {
    parts.push(`${column} >= ?`);
    params.push(from.length === 10 ? `${from} 00:00:00` : from);
  }
  if (to) {
    parts.push(`${column} <= ?`);
    params.push(to.length === 10 ? `${to} 23:59:59` : to);
  }
  return parts;
}

const REPORTS = {
  vendas_periodo: {
    title: 'Vendas por período',
    run(f) {
      const db = getDb();
      const { from, to } = dateRange(f);
      const params = [];
      const where = [...betweenClause('s.created_at', from, to, params)];

      // Inclui concluídas e canceladas; filtro opcional de situação.
      const statusFilter = f.status || f.situacao || null;
      if (statusFilter === 'completed' || statusFilter === 'concluida' || statusFilter === 'Concluída') {
        where.push(`s.status = 'completed'`);
      } else if (
        statusFilter === 'cancelled' ||
        statusFilter === 'cancelada' ||
        statusFilter === 'Cancelada'
      ) {
        where.push(`s.status = 'cancelled'`);
      } else {
        where.push(`s.status IN ('completed', 'cancelled')`);
      }

      if (f.customer_id) {
        where.push('s.customer_id = ?');
        params.push(Number(f.customer_id));
      }
      if (f.customer) {
        where.push(`LOWER(COALESCE(c.name, '')) LIKE ?`);
        params.push(`%${String(f.customer).toLowerCase()}%`);
      }
      if (f.operator || f.operador) {
        where.push(`LOWER(COALESCE(cs.operator_name, '')) LIKE ?`);
        params.push(`%${String(f.operator || f.operador).toLowerCase()}%`);
      }
      if (f.sale_number || f.numero) {
        where.push(`s.sale_number LIKE ?`);
        params.push(`%${String(f.sale_number || f.numero)}%`);
      }
      if (f.payment_method) {
        const pm = String(f.payment_method).toLowerCase();
        if (pm === 'misto') {
          where.push(
            `(SELECT COUNT(*) FROM sale_payments sp WHERE sp.sale_id = s.id) > 1`
          );
        } else if (pm === 'cartao_credito') {
          where.push(
            `EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = 'cartao' AND sp.card_type = 'CREDIT')`
          );
        } else if (pm === 'cartao_debito') {
          where.push(
            `EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = 'cartao' AND sp.card_type = 'DEBIT')`
          );
        } else {
          where.push(
            `EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = ?)`
          );
          params.push(pm);
        }
      }

      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT s.id,
                  s.sale_number,
                  s.created_at,
                  date(s.created_at) AS sale_date,
                  time(s.created_at) AS sale_time,
                  c.name AS customer_name,
                  (SELECT COALESCE(SUM(si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id) AS items_count,
                  s.total_cents,
                  s.discount_cents,
                  s.subtotal_cents,
                  s.status,
                  CASE s.status WHEN 'cancelled' THEN 'Cancelada' ELSE 'Concluída' END AS status_label,
                  cs.operator_name AS operator_name,
                  (SELECT GROUP_CONCAT(
                     CASE
                       WHEN sp.method = 'cartao' AND sp.card_type = 'CREDIT' THEN 'cartao_credito'
                       WHEN sp.method = 'cartao' AND sp.card_type = 'DEBIT' THEN 'cartao_debito'
                       ELSE sp.method
                     END
                   )
                   FROM sale_payments sp WHERE sp.sale_id = s.id) AS payment_methods
           FROM sales s
           LEFT JOIN customers c ON c.id = s.customer_id
           LEFT JOIN cash_sessions cs ON cs.id = s.cash_session_id
           ${clause}
           ORDER BY s.created_at, s.id`
        )
        .all(...params);

      const completed = rows.filter((r) => r.status === 'completed');
      const cancelled = rows.filter((r) => r.status === 'cancelled');
      const grossCents = completed.reduce((a, r) => a + Number(r.total_cents || 0), 0);
      const cancelledCents = cancelled.reduce((a, r) => a + Number(r.total_cents || 0), 0);

      const payParams = [];
      const payWhere = [`s.status = 'completed'`, ...betweenClause('s.created_at', from, to, payParams)];
      const payRows = db
        .prepare(
          `SELECT sp.method, sp.card_type, sp.amount_cents, s.id AS sale_id
           FROM sale_payments sp
           JOIN sales s ON s.id = sp.sale_id
           WHERE ${payWhere.join(' AND ')}`
        )
        .all(...payParams);

      const byMethod = {
        dinheiro: 0,
        pix: 0,
        cartao_credito: 0,
        cartao_debito: 0,
        cartao: 0,
        crediario: 0,
        misto: 0,
      };
      const payBySale = new Map();
      for (const p of payRows) {
        if (!payBySale.has(p.sale_id)) payBySale.set(p.sale_id, []);
        payBySale.get(p.sale_id).push(p);
      }
      for (const [, plist] of payBySale) {
        if (plist.length > 1) {
          byMethod.misto += plist.reduce((a, p) => a + Number(p.amount_cents || 0), 0);
          continue;
        }
        const p = plist[0];
        const amt = Number(p.amount_cents || 0);
        if (p.method === 'cartao') {
          if (p.card_type === 'CREDIT') byMethod.cartao_credito += amt;
          else if (p.card_type === 'DEBIT') byMethod.cartao_debito += amt;
          else byMethod.cartao += amt;
        } else if (byMethod[p.method] != null) {
          byMethod[p.method] += amt;
        }
      }

      const retParams = [];
      const retWhere = betweenClause('r.created_at', from, to, retParams);
      const retRow = db
        .prepare(
          `SELECT COUNT(*) AS cnt, COALESCE(SUM(r.total_cents), 0) AS total_cents
           FROM returns r
           ${retWhere.length ? `WHERE ${retWhere.join(' AND ')}` : ''}`
        )
        .get(...retParams);

      const returnsCount = Number(retRow?.cnt || 0);
      const returnsCents = Number(retRow?.total_cents || 0);
      const netCents = Math.max(0, grossCents - returnsCents);
      const ticketAvg = completed.length ? Math.round(grossCents / completed.length) : 0;

      const totals = {
        sales_count: rows.length,
        completed_count: completed.length,
        cancelled_count: cancelled.length,
        gross_cents: grossCents,
        cancelled_cents: cancelledCents,
        returns_count: returnsCount,
        returns_cents: returnsCents,
        net_cents: netCents,
        ticket_avg_cents: ticketAvg,
        dinheiro_cents: byMethod.dinheiro,
        pix_cents: byMethod.pix,
        cartao_credito_cents: byMethod.cartao_credito,
        cartao_debito_cents: byMethod.cartao_debito,
        cartao_cents: byMethod.cartao,
        crediario_cents: byMethod.crediario,
        misto_cents: byMethod.misto,
        // Compatibilidade com totais anteriores
        count: rows.length,
        total_cents: grossCents,
        discount_cents: completed.reduce((a, r) => a + Number(r.discount_cents || 0), 0),
      };

      return {
        columns: [
          'sale_number',
          'sale_date',
          'sale_time',
          'customer_name',
          'items_count',
          'total_cents',
          'payment_methods',
          'operator_name',
          'status_label',
        ],
        rows,
        totals,
      };
    },
  },

  vendas_dia: {
    title: 'Vendas por dia',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [`status = 'completed'`, ...betweenClause('created_at', from, to, params)];
      const rows = getDb()
        .prepare(
          `SELECT date(created_at) AS day, COUNT(*) AS sales_count, SUM(total_cents) AS total_cents,
                  SUM(discount_cents) AS discount_cents
           FROM sales WHERE ${where.join(' AND ')}
           GROUP BY date(created_at) ORDER BY day`
        )
        .all(...params);
      const totals = {
        days: rows.length,
        sales_count: rows.reduce((a, r) => a + r.sales_count, 0),
        total_cents: rows.reduce((a, r) => a + r.total_cents, 0),
      };
      return { columns: ['day', 'sales_count', 'discount_cents', 'total_cents'], rows, totals };
    },
  },

  vendas_mes: {
    title: 'Vendas por mês',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [`status = 'completed'`, ...betweenClause('created_at', from, to, params)];
      const rows = getDb()
        .prepare(
          `SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS sales_count,
                  SUM(total_cents) AS total_cents
           FROM sales WHERE ${where.join(' AND ')}
           GROUP BY strftime('%Y-%m', created_at) ORDER BY month`
        )
        .all(...params);
      return {
        columns: ['month', 'sales_count', 'total_cents'],
        rows,
        totals: { total_cents: rows.reduce((a, r) => a + r.total_cents, 0) },
      };
    },
  },

  vendas_produto: {
    title: 'Vendas por produto',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [`s.status = 'completed'`, ...betweenClause('s.created_at', from, to, params)];
      if (f.product_id) {
        where.push('si.product_id = ?');
        params.push(Number(f.product_id));
      }
      if (f.category) {
        where.push('p.category = ?');
        params.push(f.category);
      }
      const rows = getDb()
        .prepare(
          `SELECT COALESCE(p.name, si.name) AS product_name, p.category, p.sku, p.barcode,
                  SUM(si.quantity) AS quantity, SUM(si.line_total_cents) AS total_cents
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           LEFT JOIN products p ON p.id = si.product_id
           WHERE ${where.join(' AND ')}
           GROUP BY COALESCE(si.product_id, -si.id), COALESCE(p.name, si.name)
           ORDER BY total_cents DESC`
        )
        .all(...params);
      return {
        columns: ['product_name', 'category', 'sku', 'quantity', 'total_cents'],
        rows,
        totals: {
          quantity: rows.reduce((a, r) => a + r.quantity, 0),
          total_cents: rows.reduce((a, r) => a + r.total_cents, 0),
        },
      };
    },
  },

  vendas_categoria: {
    title: 'Vendas por categoria',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [`s.status = 'completed'`, ...betweenClause('s.created_at', from, to, params)];
      const rows = getDb()
        .prepare(
          `SELECT COALESCE(p.category, 'Diversos') AS category,
                  SUM(si.quantity) AS quantity, SUM(si.line_total_cents) AS total_cents
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           LEFT JOIN products p ON p.id = si.product_id
           WHERE ${where.join(' AND ')}
           GROUP BY COALESCE(p.category, 'Diversos')
           ORDER BY total_cents DESC`
        )
        .all(...params);
      return {
        columns: ['category', 'quantity', 'total_cents'],
        rows,
        totals: { total_cents: rows.reduce((a, r) => a + r.total_cents, 0) },
      };
    },
  },

  vendas_cliente: {
    title: 'Vendas por cliente',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [`s.status = 'completed'`, ...betweenClause('s.created_at', from, to, params)];
      if (f.customer_id) {
        where.push('s.customer_id = ?');
        params.push(Number(f.customer_id));
      }
      const rows = getDb()
        .prepare(
          `SELECT COALESCE(c.name, '(sem cliente)') AS customer_name, c.document, c.phone,
                  COUNT(*) AS sales_count, SUM(s.total_cents) AS total_cents
           FROM sales s
           LEFT JOIN customers c ON c.id = s.customer_id
           WHERE ${where.join(' AND ')}
           GROUP BY s.customer_id
           ORDER BY total_cents DESC`
        )
        .all(...params);
      return {
        columns: ['customer_name', 'document', 'phone', 'sales_count', 'total_cents'],
        rows,
        totals: { total_cents: rows.reduce((a, r) => a + r.total_cents, 0) },
      };
    },
  },

  vendas_pagamento: {
    title: 'Vendas por forma de pagamento',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [`s.status = 'completed'`, ...betweenClause('s.created_at', from, to, params)];
      if (f.payment_method) {
        where.push('sp.method = ?');
        params.push(f.payment_method);
      }
      const rows = getDb()
        .prepare(
          `SELECT sp.method, COUNT(DISTINCT sp.sale_id) AS sales_count, SUM(sp.amount_cents) AS total_cents
           FROM sale_payments sp
           JOIN sales s ON s.id = sp.sale_id
           WHERE ${where.join(' AND ')}
           GROUP BY sp.method ORDER BY total_cents DESC`
        )
        .all(...params);
      return {
        columns: ['method', 'sales_count', 'total_cents'],
        rows,
        totals: { total_cents: rows.reduce((a, r) => a + r.total_cents, 0) },
      };
    },
  },

  vendas_canceladas: {
    title: 'Vendas canceladas',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [`s.status = 'cancelled'`, ...betweenClause('s.cancelled_at', from, to, params)];
      const rows = getDb()
        .prepare(
          `SELECT s.sale_number, s.created_at, s.cancelled_at, s.total_cents, s.cancel_reason, s.cancelled_by
           FROM sales s WHERE ${where.join(' AND ')} ORDER BY s.cancelled_at DESC`
        )
        .all(...params);
      return {
        columns: ['sale_number', 'created_at', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'total_cents'],
        rows,
        totals: { count: rows.length, total_cents: rows.reduce((a, r) => a + r.total_cents, 0) },
      };
    },
  },

  devolucoes: {
    title: 'Devoluções',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = betweenClause('r.created_at', from, to, params);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = getDb()
        .prepare(
          `SELECT r.return_number, r.created_at, r.reason, r.total_cents, r.status, s.sale_number
           FROM returns r JOIN sales s ON s.id = r.sale_id
           ${clause} ORDER BY r.created_at DESC`
        )
        .all(...params);
      return {
        columns: ['return_number', 'sale_number', 'created_at', 'reason', 'status', 'total_cents'],
        rows,
        totals: { count: rows.length, total_cents: rows.reduce((a, r) => a + r.total_cents, 0) },
      };
    },
  },

  compras: {
    title: 'Compras',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [...betweenClause('p.purchase_date', from, to, params)];
      if (f.supplier_id) {
        where.push('p.supplier_id = ?');
        params.push(Number(f.supplier_id));
      }
      if (f.status) {
        where.push('p.status = ?');
        params.push(f.status);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = getDb()
        .prepare(
          `SELECT p.purchase_number, p.purchase_date, p.status, p.total_cents, s.name AS supplier_name
           FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
           ${clause} ORDER BY p.purchase_date DESC`
        )
        .all(...params);
      return {
        columns: ['purchase_number', 'purchase_date', 'supplier_name', 'status', 'total_cents'],
        rows,
        totals: { count: rows.length, total_cents: rows.reduce((a, r) => a + r.total_cents, 0) },
      };
    },
  },

  fornecedores: {
    title: 'Fornecedores',
    run(f) {
      const rows = getDb()
        .prepare(
          `SELECT s.name, s.trade_name, s.document, s.city, s.state, s.phone, s.active,
                  (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS purchases_count,
                  (SELECT COALESCE(SUM(total_cents),0) FROM purchases p WHERE p.supplier_id = s.id AND p.status='completed') AS total_cents
           FROM suppliers s
           WHERE (? = 1 OR s.active = 1)
           ORDER BY s.name`
        )
        .all(f.include_inactive ? 1 : 0);
      return {
        columns: ['name', 'document', 'city', 'phone', 'purchases_count', 'total_cents', 'active'],
        rows,
        totals: { count: rows.length },
      };
    },
  },

  estoque_atual: {
    title: 'Estoque atual',
    run(f) {
      const params = [];
      const where = ['p.active = 1'];
      if (f.category) {
        where.push('p.category = ?');
        params.push(f.category);
      }
      if (f.supplier_id) {
        where.push('p.supplier_id = ?');
        params.push(Number(f.supplier_id));
      }
      const rows = getDb()
        .prepare(
          `SELECT p.name, p.sku, p.barcode, p.category, p.stock_qty, p.min_stock_qty,
                  p.cost_cents, p.price_cents, (p.stock_qty * p.cost_cents) AS stock_value_cents
           FROM products p WHERE ${where.join(' AND ')} ORDER BY p.name`
        )
        .all(...params);
      return {
        columns: ['name', 'sku', 'category', 'stock_qty', 'min_stock_qty', 'cost_cents', 'price_cents', 'stock_value_cents'],
        rows,
        totals: {
          count: rows.length,
          stock_value_cents: rows.reduce((a, r) => a + r.stock_value_cents, 0),
        },
      };
    },
  },

  estoque_baixo: {
    title: 'Estoque baixo',
    run() {
      const rows = getDb()
        .prepare(
          `SELECT name, sku, barcode, category, stock_qty, min_stock_qty
           FROM products
           WHERE active = 1 AND min_stock_qty > 0 AND stock_qty <= min_stock_qty AND stock_qty > 0
           ORDER BY stock_qty`
        )
        .all();
      return { columns: ['name', 'sku', 'category', 'stock_qty', 'min_stock_qty'], rows, totals: { count: rows.length } };
    },
  },

  estoque_zerado: {
    title: 'Estoque zerado',
    run() {
      const rows = getDb()
        .prepare(
          `SELECT name, sku, barcode, category, stock_qty, min_stock_qty
           FROM products WHERE active = 1 AND stock_qty <= 0 ORDER BY name`
        )
        .all();
      return { columns: ['name', 'sku', 'category', 'stock_qty', 'min_stock_qty'], rows, totals: { count: rows.length } };
    },
  },

  movimentacoes_estoque: {
    title: 'Movimentações de estoque',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = betweenClause('sm.created_at', from, to, params);
      if (f.product_id) {
        where.push('sm.product_id = ?');
        params.push(Number(f.product_id));
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = getDb()
        .prepare(
          `SELECT sm.created_at, p.name AS product_name, sm.movement_type, sm.quantity_delta,
                  sm.stock_after, sm.reason, sm.user_name
           FROM stock_movements sm
           JOIN products p ON p.id = sm.product_id
           ${clause}
           ORDER BY sm.id DESC LIMIT 2000`
        )
        .all(...params);
      return {
        columns: ['created_at', 'product_name', 'movement_type', 'quantity_delta', 'stock_after', 'user_name'],
        rows,
        totals: { count: rows.length },
      };
    },
  },

  entradas_saidas: {
    title: 'Entradas e saídas de estoque',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = betweenClause('created_at', from, to, params);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = getDb()
        .prepare(
          `SELECT movement_type,
                  SUM(CASE WHEN quantity_delta > 0 THEN quantity_delta ELSE 0 END) AS entries,
                  SUM(CASE WHEN quantity_delta < 0 THEN -quantity_delta ELSE 0 END) AS exits
           FROM stock_movements ${clause}
           GROUP BY movement_type ORDER BY movement_type`
        )
        .all(...params);
      return {
        columns: ['movement_type', 'entries', 'exits'],
        rows,
        totals: {
          entries: rows.reduce((a, r) => a + r.entries, 0),
          exits: rows.reduce((a, r) => a + r.exits, 0),
        },
      };
    },
  },

  caixa: {
    title: 'Caixa',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = betweenClause('opened_at', from, to, params);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = getDb()
        .prepare(
          `SELECT id, terminal_id, operator_name, status, opened_at, closed_at,
                  opening_amount_cents, sales_total_cents, cash_in_cents, cash_out_cents,
                  expected_amount_cents, counted_amount_cents, difference_cents
           FROM cash_sessions ${clause} ORDER BY opened_at DESC`
        )
        .all(...params);
      return {
        columns: [
          'id',
          'operator_name',
          'status',
          'opened_at',
          'closed_at',
          'sales_total_cents',
          'expected_amount_cents',
          'counted_amount_cents',
          'difference_cents',
        ],
        rows,
        totals: { sessions: rows.length },
      };
    },
  },

  caixa_abertura_fechamento: {
    title: 'Abertura e fechamento de caixa',
    run(f) {
      return REPORTS.caixa.run(f);
    },
  },

  sangrias: {
    title: 'Sangrias',
    run(f) {
      return cashMovements('sangria', f);
    },
  },

  suprimentos: {
    title: 'Suprimentos',
    run(f) {
      return cashMovements('suprimento', f);
    },
  },

  diferencas_caixa: {
    title: 'Diferenças de caixa',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [`status = 'closed'`, `difference_cents IS NOT NULL`, ...betweenClause('closed_at', from, to, params)];
      const rows = getDb()
        .prepare(
          `SELECT id, operator_name, closed_at, expected_amount_cents, counted_amount_cents, difference_cents, close_notes
           FROM cash_sessions WHERE ${where.join(' AND ')} ORDER BY closed_at DESC`
        )
        .all(...params);
      return {
        columns: ['id', 'operator_name', 'closed_at', 'expected_amount_cents', 'counted_amount_cents', 'difference_cents'],
        rows,
        totals: { difference_cents: rows.reduce((a, r) => a + (r.difference_cents || 0), 0) },
      };
    },
  },

  crediario_aberto: {
    title: 'Crediário em aberto',
    run(f) {
      const params = [];
      const where = [`ca.status IN ('aberto','parcialmente_pago','vencido')`];
      if (f.customer_id) {
        where.push('ca.customer_id = ?');
        params.push(Number(f.customer_id));
      }
      const rows = getDb()
        .prepare(
          `SELECT ca.id, c.name AS customer_name, ca.status, ca.total_cents, ca.balance_cents,
                  ca.installment_count, s.sale_number
           FROM credit_accounts ca
           JOIN customers c ON c.id = ca.customer_id
           LEFT JOIN sales s ON s.id = ca.sale_id
           WHERE ${where.join(' AND ')}
           ORDER BY ca.balance_cents DESC`
        )
        .all(...params);
      return {
        columns: ['customer_name', 'sale_number', 'status', 'total_cents', 'balance_cents', 'installment_count'],
        rows,
        totals: { balance_cents: rows.reduce((a, r) => a + r.balance_cents, 0) },
      };
    },
  },

  crediario_vencido: {
    title: 'Crediário vencido',
    run(f) {
      const rows = getDb()
        .prepare(
          `SELECT c.name AS customer_name, ci.installment_number, ci.due_date, ci.amount_cents,
                  ci.paid_cents, (ci.amount_cents - ci.paid_cents) AS open_cents, ci.status, s.sale_number
           FROM credit_installments ci
           JOIN credit_accounts ca ON ca.id = ci.credit_account_id
           JOIN customers c ON c.id = ca.customer_id
           LEFT JOIN sales s ON s.id = ca.sale_id
           WHERE ci.status IN ('vencido','aberto','parcialmente_pago')
             AND ci.due_date < date('now')
             AND (ci.amount_cents - ci.paid_cents) > 0
           ORDER BY ci.due_date`
        )
        .all();
      return {
        columns: ['customer_name', 'sale_number', 'installment_number', 'due_date', 'open_cents', 'status'],
        rows,
        totals: { open_cents: rows.reduce((a, r) => a + r.open_cents, 0) },
      };
    },
  },

  pagamentos_recebidos: {
    title: 'Pagamentos recebidos (crediário)',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = betweenClause('cp.paid_at', from, to, params);
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = getDb()
        .prepare(
          `SELECT cp.paid_at, cp.amount_cents, cp.method, c.name AS customer_name, cp.user_name
           FROM credit_payments cp
           JOIN credit_accounts ca ON ca.id = cp.credit_account_id
           JOIN customers c ON c.id = ca.customer_id
           ${clause}
           ORDER BY cp.paid_at DESC`
        )
        .all(...params);
      return {
        columns: ['paid_at', 'customer_name', 'method', 'amount_cents', 'user_name'],
        rows,
        totals: { total_cents: rows.reduce((a, r) => a + r.amount_cents, 0) },
      };
    },
  },

  clientes_devedores: {
    title: 'Clientes devedores',
    run() {
      const rows = getDb()
        .prepare(
          `SELECT c.name, c.document, c.phone, c.whatsapp,
                  SUM(ca.balance_cents) AS balance_cents,
                  COUNT(*) AS accounts
           FROM credit_accounts ca
           JOIN customers c ON c.id = ca.customer_id
           WHERE ca.balance_cents > 0 AND ca.status IN ('aberto','parcialmente_pago','vencido')
           GROUP BY c.id
           ORDER BY balance_cents DESC`
        )
        .all();
      return {
        columns: ['name', 'document', 'phone', 'accounts', 'balance_cents'],
        rows,
        totals: { balance_cents: rows.reduce((a, r) => a + r.balance_cents, 0) },
      };
    },
  },

  entregas: {
    title: 'Entregas',
    run(f) {
      const { from, to } = dateRange(f);
      const params = [];
      const where = [];
      if (from) {
        where.push('d.scheduled_date >= ?');
        params.push(from.slice(0, 10));
      }
      if (to) {
        where.push('d.scheduled_date <= ?');
        params.push(to.slice(0, 10));
      }
      if (f.status) {
        where.push('d.status = ?');
        params.push(f.status);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = getDb()
        .prepare(
          `SELECT d.id, d.scheduled_date, d.period, d.status, d.courier_name, d.customer_name, s.sale_number
           FROM deliveries d
           JOIN sales s ON s.id = d.sale_id
           ${clause}
           ORDER BY d.scheduled_date DESC, d.id DESC`
        )
        .all(...params);
      return {
        columns: ['sale_number', 'customer_name', 'scheduled_date', 'period', 'courier_name', 'status'],
        rows,
        totals: { count: rows.length },
      };
    },
  },

  produtos_mais_vendidos: {
    title: 'Produtos mais vendidos',
    run(f) {
      const base = REPORTS.vendas_produto.run(f);
      return { ...base, rows: base.rows.slice(0, Number(f.limit) || 50) };
    },
  },
};

function cashMovements(type, f) {
  const { from, to } = dateRange(f);
  const params = [type];
  const where = [`cm.type = ?`, ...betweenClause('cm.created_at', from, to, params)];
  const rows = getDb()
    .prepare(
      `SELECT cm.created_at, cm.amount_cents, cm.note, cm.user_name, cs.operator_name, cs.id AS session_id
       FROM cash_movements cm
       JOIN cash_sessions cs ON cs.id = cm.session_id
       WHERE ${where.join(' AND ')}
       ORDER BY cm.created_at DESC`
    )
    .all(...params);
  return {
    columns: ['created_at', 'session_id', 'operator_name', 'amount_cents', 'note', 'user_name'],
    rows,
    totals: { count: rows.length, total_cents: rows.reduce((a, r) => a + r.amount_cents, 0) },
  };
}

export function listReportCatalog() {
  return Object.entries(REPORTS).map(([id, r]) => ({ id, title: r.title }));
}

export function runReport(reportId, filters = {}) {
  const report = REPORTS[reportId];
  if (!report) throw new AppError('Relatório não encontrado', { status: 404, code: 'NOT_FOUND' });
  const data = report.run(filters || {});
  return {
    id: reportId,
    title: report.title,
    filters,
    generated_at: new Date().toISOString(),
    ...data,
  };
}
