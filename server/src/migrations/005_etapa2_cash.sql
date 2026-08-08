-- Etapa 2: sessões e movimentos de caixa

CREATE TABLE cash_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terminal_id TEXT NOT NULL DEFAULT 'TERM-1',
  operator_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_amount_cents >= 0),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  sales_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (sales_total_cents >= 0),
  sales_dinheiro_cents INTEGER NOT NULL DEFAULT 0 CHECK (sales_dinheiro_cents >= 0),
  sales_pix_cents INTEGER NOT NULL DEFAULT 0 CHECK (sales_pix_cents >= 0),
  sales_cartao_cents INTEGER NOT NULL DEFAULT 0 CHECK (sales_cartao_cents >= 0),
  cash_in_cents INTEGER NOT NULL DEFAULT 0 CHECK (cash_in_cents >= 0),
  cash_out_cents INTEGER NOT NULL DEFAULT 0 CHECK (cash_out_cents >= 0),
  expected_amount_cents INTEGER,
  counted_amount_cents INTEGER,
  difference_cents INTEGER,
  close_notes TEXT
);

CREATE UNIQUE INDEX idx_cash_sessions_one_open_per_terminal
  ON cash_sessions(terminal_id)
  WHERE status = 'open';

CREATE INDEX idx_cash_sessions_status ON cash_sessions(status);
CREATE INDEX idx_cash_sessions_opened_at ON cash_sessions(opened_at);

CREATE TABLE cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('abertura', 'sangria', 'suprimento', 'entrada', 'saida', 'venda', 'cancelamento_venda')
  ),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  payment_method TEXT CHECK (
    payment_method IS NULL OR payment_method IN ('dinheiro', 'pix', 'cartao', 'misto')
  ),
  reason TEXT,
  user_name TEXT,
  reference_type TEXT,
  reference_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cash_movements_session ON cash_movements(cash_session_id);
CREATE INDEX idx_cash_movements_type ON cash_movements(movement_type);
CREATE INDEX idx_cash_movements_created_at ON cash_movements(created_at);

INSERT INTO settings (key, value) VALUES
  ('terminal_id', 'TERM-1'),
  ('current_operator', 'Operador')
ON CONFLICT(key) DO NOTHING;
