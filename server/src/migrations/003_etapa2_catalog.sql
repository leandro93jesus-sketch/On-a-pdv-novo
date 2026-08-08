-- Etapa 2: fornecedores (mínimo), expansão de produtos e clientes

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_suppliers_name ON suppliers(name);

ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'UN';
ALTER TABLE products ADD COLUMN min_stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_qty >= 0);
ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
ALTER TABLE products ADD COLUMN notes TEXT;

CREATE INDEX idx_products_supplier_id ON products(supplier_id);
CREATE INDEX idx_products_min_stock ON products(min_stock_qty);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  whatsapp TEXT,
  address TEXT,
  address_number TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_document ON customers(document);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_active ON customers(active);

CREATE UNIQUE INDEX idx_customers_document_unique
  ON customers(document)
  WHERE document IS NOT NULL AND document != '';
