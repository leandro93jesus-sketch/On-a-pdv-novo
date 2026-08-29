-- Recebimento de crediário no caixa (movimento dedicado).
-- Sem DELETE de dados históricos — apenas amplia CHECK de movement_type.

CREATE TABLE cash_movements_new_024 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  movement_type TEXT NOT NULL CHECK (
    movement_type IN (
      'abertura', 'sangria', 'suprimento', 'entrada', 'saida',
      'venda', 'cancelamento_venda', 'ajuste_venda', 'recebimento_crediario'
    )
  ),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  payment_method TEXT,
  reason TEXT,
  user_name TEXT,
  reference_type TEXT,
  reference_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO cash_movements_new_024 (
  id, cash_session_id, movement_type, amount_cents, payment_method,
  reason, user_name, reference_type, reference_id, created_at
)
SELECT
  id, cash_session_id, movement_type, amount_cents, payment_method,
  reason, user_name, reference_type, reference_id, created_at
FROM cash_movements;

DROP TABLE cash_movements;
ALTER TABLE cash_movements_new_024 RENAME TO cash_movements;
CREATE INDEX idx_cash_movements_session ON cash_movements(cash_session_id);
CREATE INDEX idx_cash_movements_type ON cash_movements(movement_type);
CREATE INDEX idx_cash_movements_created_at ON cash_movements(created_at);
