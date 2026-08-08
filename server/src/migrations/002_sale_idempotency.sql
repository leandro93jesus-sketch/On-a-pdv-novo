-- Idempotência de finalização de venda (evita duplicar por reenvio)
ALTER TABLE sales ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX idx_sales_client_request_id
  ON sales(client_request_id)
  WHERE client_request_id IS NOT NULL AND client_request_id != '';
