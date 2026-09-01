-- Conferência por código de barras na separação de pedidos

ALTER TABLE delivery_order_items ADD COLUMN checked_qty INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS delivery_order_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES delivery_order_items(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id),
  product_name TEXT,
  barcode_read TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  method TEXT NOT NULL CHECK (method IN ('barcode', 'manual')),
  user_name TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_order_scans_order ON delivery_order_scans(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_order_scans_created ON delivery_order_scans(created_at);
