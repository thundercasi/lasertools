-- Payment status for purchases
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'Pendente';