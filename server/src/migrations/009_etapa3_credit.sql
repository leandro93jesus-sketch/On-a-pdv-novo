-- Etapa 3: crediário + expansão do método de pagamento

CREATE TABLE sale_payments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('dinheiro', 'pix', 'cartao', 'crediario')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO sale_payments_new (id, sale_id, method, amount_cents, created_at)
SELECT id, sale_id, method, amount_cents, created_at FROM sale_payments;

DROP TABLE sale_payments;
ALTER TABLE sale_payments_new RENAME TO sale_payments;
CREATE INDEX idx_sale_payments_sale_id ON sale_payments(sale_id);

ALTER TABLE cash_sessions ADD COLUMN sales_crediario_cents INTEGER NOT NULL DEFAULT 0 CHECK (sales_crediario_cents >= 0);

CREATE TABLE cash_movements_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('abertura', 'sangria', 'suprimento', 'entrada', 'saida', 'venda', 'cancelamento_venda')
  ),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  payment_method TEXT CHECK (
    payment_method IS NULL OR payment_method IN ('dinheiro', 'pix', 'cartao', 'crediario', 'misto')
  ),
  reason TEXT,
  user_name TEXT,
  reference_type TEXT,
  reference_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO cash_movements_new (
  id, cash_session_id, movement_type, amount_cents, payment_method,
  reason, user_name, reference_type, reference_id, created_at
)
SELECT id, cash_session_id, movement_type, amount_cents, payment_method,
       reason, user_name, reference_type, reference_id, created_at
FROM cash_movements;

DROP TABLE cash_movements;
ALTER TABLE cash_movements_new RENAME TO cash_movements;
CREATE INDEX idx_cash_movements_session ON cash_movements(cash_session_id);
CREATE INDEX idx_cash_movements_type ON cash_movements(movement_type);
CREATE INDEX idx_cash_movements_created_at ON cash_movements(created_at);

CREATE TABLE credit_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  entry_cents INTEGER NOT NULL DEFAULT 0 CHECK (entry_cents >= 0),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  installment_count INTEGER NOT NULL CHECK (installment_count > 0),
  status TEXT NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'parcialmente_pago', 'quitado', 'vencido', 'cancelado')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_credit_accounts_customer ON credit_accounts(customer_id);
CREATE INDEX idx_credit_accounts_status ON credit_accounts(status);

CREATE TABLE credit_installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_account_id INTEGER NOT NULL REFERENCES credit_accounts(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL CHECK (installment_number > 0),
  due_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
  status TEXT NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'parcialmente_pago', 'quitado', 'vencido', 'cancelado')),
  UNIQUE (credit_account_id, installment_number)
);

CREATE INDEX idx_credit_installments_account ON credit_installments(credit_account_id);
CREATE INDEX idx_credit_installments_due ON credit_installments(due_date);
CREATE INDEX idx_credit_installments_status ON credit_installments(status);

CREATE TABLE credit_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_account_id INTEGER NOT NULL REFERENCES credit_accounts(id),
  installment_id INTEGER REFERENCES credit_installments(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL DEFAULT 'dinheiro'
    CHECK (method IN ('dinheiro', 'pix', 'cartao')),
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_name TEXT,
  notes TEXT,
  is_reversal INTEGER NOT NULL DEFAULT 0 CHECK (is_reversal IN (0, 1)),
  reverses_payment_id INTEGER REFERENCES credit_payments(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_credit_payments_account ON credit_payments(credit_account_id);
CREATE INDEX idx_credit_payments_installment ON credit_payments(installment_id);
