-- Fase 2: revisões de duplicados, auditoria de mesclagem e estoque anterior nas movimentações

CREATE TABLE IF NOT EXISTS product_duplicate_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_a_id INTEGER NOT NULL REFERENCES products(id),
  product_b_id INTEGER NOT NULL REFERENCES products(id),
  match_type TEXT NOT NULL CHECK (
    match_type IN ('barcode', 'sku', 'name_exact', 'name_similar')
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'not_duplicate', 'review', 'merged')
  ),
  notes TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_a_id, product_b_id, match_type)
);

CREATE INDEX IF NOT EXISTS idx_dup_reviews_status ON product_duplicate_reviews(status);
CREATE INDEX IF NOT EXISTS idx_dup_reviews_products ON product_duplicate_reviews(product_a_id, product_b_id);

CREATE TABLE IF NOT EXISTS product_merges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_product_id INTEGER NOT NULL REFERENCES products(id),
  secondary_product_id INTEGER NOT NULL REFERENCES products(id),
  stock_rule TEXT NOT NULL CHECK (
    stock_rule IN ('sum', 'keep_primary', 'keep_secondary')
  ),
  stock_primary_before INTEGER NOT NULL,
  stock_secondary_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  sales_reassigned INTEGER NOT NULL DEFAULT 0,
  movements_reassigned INTEGER NOT NULL DEFAULT 0,
  details_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_product_merges_primary ON product_merges(primary_product_id);

-- Adiciona stock_before sem quebrar linhas antigas (NULL = calcular via stock_after - quantity_delta)
ALTER TABLE stock_movements ADD COLUMN stock_before INTEGER;
