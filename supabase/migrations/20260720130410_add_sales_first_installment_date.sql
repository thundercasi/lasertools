/*
# Add first_installment_date to sales + fix installment due dates

## 1. Sales table
- Add `first_installment_date` (date, nullable) — data de vencimento da primeira parcela.
  When set, installment due dates are calculated from this date instead of sale_date.

## 2. Trigger update
- `generate_sale_installments()` now uses COALESCE(NEW.first_installment_date, NEW.sale_date)
  as the base date for installment due dates. Installment 1 = base_date, installment N =
  base_date + (N-1) * interval_days.
- Trigger fires on UPDATE OF first_installment_date too.

## Notes
- Existing sales get first_installment_date = sale_date as a sensible default.
- No data is lost.
*/

-- Add first_installment_date to sales
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'first_installment_date') THEN
    ALTER TABLE sales ADD COLUMN first_installment_date date;
  END IF;
END $$;

-- Backfill: default first_installment_date to sale_date for existing sales
UPDATE sales SET first_installment_date = sale_date WHERE first_installment_date IS NULL;

-- Updated trigger function
CREATE OR REPLACE FUNCTION generate_sale_installments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  base_date date;
BEGIN
  IF NEW.status = 'Cancelada' THEN
    DELETE FROM installments WHERE reference_id = NEW.id AND reference_type = 'sale';
    RETURN NEW;
  END IF;

  DELETE FROM installments WHERE reference_id = NEW.id AND reference_type = 'sale';

  base_date := COALESCE(NEW.first_installment_date, NEW.sale_date);

  FOR i IN 1..NEW.installment_count LOOP
    INSERT INTO installments (
      reference_type, reference_id, sale_id, customer_id,
      installment_number, due_date, amount, paid, paid_amount,
      currency, collection_status
    ) VALUES (
      'sale',
      NEW.id,
      NEW.id,
      NEW.customer_id,
      i,
      (base_date + ((i - 1) * NEW.installment_interval_days))::date,
      (NEW.total_amount + COALESCE(NEW.delivery_fee, 0)) / NEW.installment_count,
      false,
      0,
      NEW.currency,
      'Não Cobrado'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_sale_installments ON sales;
CREATE TRIGGER trg_generate_sale_installments
  AFTER INSERT OR UPDATE OF total_amount, delivery_fee, installment_count, installment_interval_days, sale_date, first_installment_date, customer_id, status
  ON sales
  FOR EACH ROW
  EXECUTE FUNCTION generate_sale_installments();

-- Regenerate installments for existing sales
UPDATE sales SET installment_count = installment_count WHERE status <> 'Cancelada';

NOTIFY pgrst, 'reload schema';
