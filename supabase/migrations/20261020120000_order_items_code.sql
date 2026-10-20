-- Código do item na proposta comercial (ex.: SP00614), impresso na coluna "Código".
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS code text;
