-- Fase 4: histórico de preços, journal de recuperação e ajustes de caixa fechado

CREATE TABLE IF NOT EXISTS product_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price_cents INTEGER NOT NULL,
  new_price_cents INTEGER NOT NULL,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON product_price_history(product_id, created_at);

CREATE TABLE IF NOT EXISTS operation_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_key TEXT NOT NULL UNIQUE,
  op_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'committed', 'failed', 'aborted')),
  payload_json TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_operation_journal_status ON operation_journal(status);

CREATE TABLE IF NOT EXISTS cash_session_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
