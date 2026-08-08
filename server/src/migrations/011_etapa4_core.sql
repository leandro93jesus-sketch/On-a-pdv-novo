-- ONÇA PDV — Etapa 4: usuários, sessões, legacy refs, backup, importação, settings expandidos

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operador'
    CHECK (role IN ('administrador', 'operador')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(active);

CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE backup_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  filepath TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  app_version TEXT,
  db_schema_version TEXT,
  kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (kind IN ('manual', 'pre_restore', 'pre_import', 'auto')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT,
  valid INTEGER NOT NULL DEFAULT 1 CHECK (valid IN (0, 1))
);

CREATE INDEX idx_backup_history_created ON backup_history(created_at);

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  importer_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'running', 'completed', 'failed', 'rolled_back')),
  preview_json TEXT,
  report_json TEXT,
  unknown_fields_json TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  created_by TEXT,
  error_message TEXT,
  backup_history_id INTEGER REFERENCES backup_history(id)
);

CREATE INDEX idx_import_runs_started ON import_runs(started_at);

-- Referências legadas (não usam PK antigo)
ALTER TABLE products ADD COLUMN legacy_id TEXT;
ALTER TABLE products ADD COLUMN legacy_source TEXT;
ALTER TABLE customers ADD COLUMN legacy_id TEXT;
ALTER TABLE customers ADD COLUMN legacy_source TEXT;
ALTER TABLE suppliers ADD COLUMN legacy_id TEXT;
ALTER TABLE suppliers ADD COLUMN legacy_source TEXT;
ALTER TABLE sales ADD COLUMN legacy_id TEXT;
ALTER TABLE sales ADD COLUMN legacy_source TEXT;

CREATE INDEX idx_products_legacy ON products(legacy_source, legacy_id);
CREATE INDEX idx_customers_legacy ON customers(legacy_source, legacy_id);
CREATE INDEX idx_suppliers_legacy ON suppliers(legacy_source, legacy_id);
CREATE INDEX idx_sales_legacy ON sales(legacy_source, legacy_id);

ALTER TABLE audit_logs ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE audit_logs ADD COLUMN result TEXT DEFAULT 'ok';

-- Configurações padrão da empresa / PDV (não sobrescreve se já existir via INSERT OR IGNORE)
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('store_trade_name', 'ONÇA PRODUTOS DE LIMPEZA'),
  ('store_phone', ''),
  ('store_whatsapp', ''),
  ('store_address', ''),
  ('store_site', ''),
  ('store_instagram', ''),
  ('receipt_message', 'Obrigado pela preferência!'),
  ('ui_theme', 'padrao'),
  ('ui_scale', 'normal'),
  ('cash_require_open', '1'),
  ('sale_allow_misc', '1'),
  ('print_auto_open', '0'),
  ('backup_dir', ''),
  ('whatsapp_default_message', 'Olá! Segue o comprovante da sua compra na Onça Produtos de Limpeza. Obrigado pela preferência.'),
  ('app_version', '0.4.0');
