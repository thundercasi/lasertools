-- Increase IOF precision to 5 decimal places (was numeric(14,2))
ALTER TABLE purchases
  ALTER COLUMN iof TYPE numeric(18,5);

-- Add import_tax column (fixed value in BRL, only for imports)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = 'import_tax') THEN
    ALTER TABLE purchases ADD COLUMN import_tax numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
