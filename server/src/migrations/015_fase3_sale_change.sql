-- Fase 3: troco e valor recebido em dinheiro (pagamentos mistos somam exatamente o total)
ALTER TABLE sales ADD COLUMN amount_received_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_received_cents >= 0);
ALTER TABLE sales ADD COLUMN change_cents INTEGER NOT NULL DEFAULT 0 CHECK (change_cents >= 0);
