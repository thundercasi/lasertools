-- Forma de pagamento combinada com o cliente na venda.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_method text;
