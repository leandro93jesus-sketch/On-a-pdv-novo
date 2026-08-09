-- Mestre 1.2.0: fila/log de impressão, reservas e pedidos aguardando pagamento

ALTER TABLE products ADD COLUMN reserved_qty INTEGER NOT NULL DEFAULT 0;

ALTER TABLE deliveries ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'pago';
ALTER TABLE deliveries ADD COLUMN amount_paid_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deliveries ADD COLUMN amount_due_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type TEXT NOT NULL,
  document_ref TEXT,
  title TEXT NOT NULL,
  printer_name TEXT,
  paper_format TEXT NOT NULL DEFAULT 'A4'
    CHECK (paper_format IN ('A4', '80mm', '58mm')),
  copies INTEGER NOT NULL DEFAULT 1 CHECK (copies >= 1 AND copies <= 10),
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'impresso', 'erro')),
  error_message TEXT,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  printed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);
CREATE INDEX IF NOT EXISTS idx_print_jobs_created ON print_jobs(created_at);

CREATE TABLE IF NOT EXISTS print_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  print_job_id INTEGER REFERENCES print_jobs(id),
  document_type TEXT NOT NULL,
  document_ref TEXT,
  printer_name TEXT,
  paper_format TEXT,
  user_name TEXT,
  result TEXT NOT NULL CHECK (result IN ('ok', 'erro', 'cancelado')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_print_log_created ON print_log(created_at);

CREATE TABLE IF NOT EXISTS delivery_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT,
  phone TEXT,
  whatsapp TEXT,
  address TEXT,
  address_number TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  scheduled_date TEXT,
  period TEXT,
  notes TEXT,
  courier_name TEXT,
  status TEXT NOT NULL DEFAULT 'aguardando_pagamento'
    CHECK (status IN (
      'aguardando_pagamento',
      'aguardando_separacao',
      'em_separacao',
      'separado',
      'pronto_para_entrega',
      'saiu_para_entrega',
      'entregue',
      'problema_na_entrega',
      'cancelado'
    )),
  payment_status TEXT NOT NULL DEFAULT 'nao_pago'
    CHECK (payment_status IN ('nao_pago', 'parcial', 'pago', 'pix_pendente', 'pagamento_na_entrega')),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  sale_id INTEGER REFERENCES sales(id),
  client_request_id TEXT UNIQUE,
  cancel_reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_payment ON delivery_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_customer ON delivery_orders(customer_id);

CREATE TABLE IF NOT EXISTS delivery_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  is_misc INTEGER NOT NULL DEFAULT 0 CHECK (is_misc IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_delivery_order_items_order ON delivery_order_items(order_id);

CREATE TABLE IF NOT EXISTS delivery_order_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('dinheiro', 'pix', 'cartao', 'crediario')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  amount_received_cents INTEGER,
  change_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  user_name TEXT,
  client_request_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_order_payments_order ON delivery_order_payments(order_id);

CREATE TABLE IF NOT EXISTS stock_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  order_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'ativa'
    CHECK (status IN ('ativa', 'convertida', 'liberada')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  released_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_product ON stock_reservations(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_order ON stock_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_status ON stock_reservations(status);

CREATE TABLE IF NOT EXISTS delivery_order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_order_history_order ON delivery_order_history(order_id);
