-- Etapa 2: vínculo venda↔cliente/caixa, cancelamento e auditoria

ALTER TABLE sales ADD COLUMN customer_id INTEGER REFERENCES customers(id);
ALTER TABLE sales ADD COLUMN cash_session_id INTEGER REFERENCES cash_sessions(id);
ALTER TABLE sales ADD COLUMN cancelled_by TEXT;
ALTER TABLE sales ADD COLUMN cancel_reason TEXT;

CREATE INDEX idx_sales_customer_id ON sales(customer_id);
CREATE INDEX idx_sales_cash_session_id ON sales(cash_session_id);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
