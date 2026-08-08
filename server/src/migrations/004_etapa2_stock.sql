-- Etapa 2: amplia tipos e metadados de movimentação de estoque

CREATE TABLE stock_movements_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  movement_type TEXT NOT NULL CHECK (
    movement_type IN (
      'entry', 'exit', 'adjust_in', 'adjust_out',
      'sale', 'return', 'sale_cancel', 'purchase'
    )
  ),
  quantity_delta INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason TEXT,
  user_name TEXT,
  reference_type TEXT,
  reference_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO stock_movements_new (
  id, product_id, movement_type, quantity_delta, stock_after,
  reason, user_name, reference_type, reference_id, note, created_at
)
SELECT
  id,
  product_id,
  CASE
    WHEN movement_type = 'adjustment' AND quantity_delta >= 0 THEN 'adjust_in'
    WHEN movement_type = 'adjustment' AND quantity_delta < 0 THEN 'adjust_out'
    ELSE movement_type
  END,
  quantity_delta,
  stock_after,
  note,
  NULL,
  reference_type,
  reference_id,
  note,
  created_at
FROM stock_movements;

DROP TABLE stock_movements;
ALTER TABLE stock_movements_new RENAME TO stock_movements;

CREATE INDEX idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_reference ON stock_movements(reference_type, reference_id);
CREATE INDEX idx_stock_movements_created_at ON stock_movements(created_at);
CREATE INDEX idx_stock_movements_type ON stock_movements(movement_type);
