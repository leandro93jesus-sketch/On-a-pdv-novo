-- Desconto e campos extras do pedido de entrega (modo Vendas → Entrega)
ALTER TABLE delivery_orders ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_orders ADD COLUMN complement TEXT;
ALTER TABLE delivery_orders ADD COLUMN reference_note TEXT;
