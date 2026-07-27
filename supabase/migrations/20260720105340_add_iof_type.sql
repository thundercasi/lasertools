-- IOF type: 'percent' or 'fixed' (valor)
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS iof_type text NOT NULL DEFAULT 'percent';