-- Cartão: crédito ou débito (não destrutivo)
-- Vendas antigas permanecem com card_type NULL (= CARTÃO genérico)

ALTER TABLE sale_payments ADD COLUMN card_type TEXT
  CHECK (card_type IS NULL OR card_type IN ('CREDIT', 'DEBIT'));

ALTER TABLE delivery_order_payments ADD COLUMN card_type TEXT
  CHECK (card_type IS NULL OR card_type IN ('CREDIT', 'DEBIT'));
