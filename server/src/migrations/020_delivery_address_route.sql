-- Telefone do entregador e previsão de pagamento na entrega (mensagem WhatsApp/rota)
ALTER TABLE delivery_orders ADD COLUMN courier_phone TEXT;
ALTER TABLE delivery_orders ADD COLUMN expected_payment_method TEXT;
ALTER TABLE delivery_orders ADD COLUMN change_for_cents INTEGER;
