-- Add missing fields to parts: condition (Novo/Usado), brand, purchase_date
ALTER TABLE parts ADD COLUMN IF NOT EXISTS condition text NOT NULL DEFAULT 'Novo';
ALTER TABLE parts ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE parts ADD COLUMN IF NOT EXISTS purchase_date date;