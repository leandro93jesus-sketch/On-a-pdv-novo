-- Etapa 3: expansão do cadastro de fornecedores

ALTER TABLE suppliers ADD COLUMN trade_name TEXT;
ALTER TABLE suppliers ADD COLUMN email TEXT;
ALTER TABLE suppliers ADD COLUMN whatsapp TEXT;
ALTER TABLE suppliers ADD COLUMN address TEXT;
ALTER TABLE suppliers ADD COLUMN address_number TEXT;
ALTER TABLE suppliers ADD COLUMN neighborhood TEXT;
ALTER TABLE suppliers ADD COLUMN city TEXT;
ALTER TABLE suppliers ADD COLUMN state TEXT;
ALTER TABLE suppliers ADD COLUMN zip_code TEXT;
ALTER TABLE suppliers ADD COLUMN contact_name TEXT;
ALTER TABLE suppliers ADD COLUMN notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_document_unique
  ON suppliers(document)
  WHERE document IS NOT NULL AND document != '';

CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(active);
CREATE INDEX IF NOT EXISTS idx_suppliers_city ON suppliers(city);
