-- Amend de vendas + PIN administrativo (hash) + movimento de caixa de ajuste
-- Sem DELETE de dados históricos.

ALTER TABLE sales ADD COLUMN amended_at TEXT;
ALTER TABLE sales ADD COLUMN amended_by TEXT;
ALTER TABLE sales ADD COLUMN amend_reason TEXT;
ALTER TABLE sales ADD COLUMN amend_authorized_by TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_amended_at ON sales(amended_at);

-- Amplia tipos de movimento de caixa com ajuste_venda (recria tabela com CHECK novo)
CREATE TABLE cash_movements_new_022 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  movement_type TEXT NOT NULL CHECK (
    movement_type IN (
      'abertura', 'sangria', 'suprimento', 'entrada', 'saida',
      'venda', 'cancelamento_venda', 'ajuste_venda'
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

INSERT INTO cash_movements_new_022 (
  id, cash_session_id, movement_type, amount_cents, payment_method,
  reason, user_name, reference_type, reference_id, created_at
)
SELECT
  id, cash_session_id, movement_type, amount_cents, payment_method,
  reason, user_name, reference_type, reference_id, created_at
FROM cash_movements;

DROP TABLE cash_movements;
ALTER TABLE cash_movements_new_022 RENAME TO cash_movements;
CREATE INDEX idx_cash_movements_session ON cash_movements(cash_session_id);
CREATE INDEX idx_cash_movements_type ON cash_movements(movement_type);
CREATE INDEX idx_cash_movements_created_at ON cash_movements(created_at);

-- PIN administrativo inicial (scrypt). NÃO contém a senha em texto puro.
-- Senha inicial correspondente foi definida fora do código-fonte; apenas hash+salt.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('admin_op_pin_salt', 'b6435d68246fd85289efcb88a9db8d54'),
  ('admin_op_pin_hash', 'df11dee16955ec92b2402e8f6aa71d83a88b525427f6d450c718ff77a21ccae5374b90cc4f409a1f72f57be13a82050d6c562fb721b4a8e97ee5e30360c5c349');

-- Vendas com estoque insuficiente/zerado passam a ser permitidas por padrão (aviso na UI).
INSERT INTO settings (key, value) VALUES ('allow_negative_stock_global', '1')
ON CONFLICT(key) DO UPDATE SET value = '1';
