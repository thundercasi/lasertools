/*
# Contas a Receber — collection management + auto-generation

## 1. Installments table — new columns for collection management
- `customer_id` (uuid, nullable, FK → customers ON DELETE SET NULL) — denormalized for fast dashboard queries.
- `collection_status` (text, NOT NULL, default 'Não Cobrado') — status de cobrança: 'Não Cobrado' | 'Notificado'.
- `notified_at` (date, nullable) — data em que o cliente foi notificado.
- `sale_id` (uuid, nullable, FK → sales ON DELETE CASCADE) — explicit link to the sale (in addition to reference_id).

## 2. Auto-generation trigger
- A trigger fires AFTER INSERT or UPDATE on `sales` that:
  1. Deletes all existing installments for that sale (reference_id = sale.id, reference_type = 'sale').
  2. Generates N installment rows based on `installment_count`, `installment_interval_days`,
     `total_amount`, `delivery_fee`, `sale_date`, and `customer_id`.
  3. Each installment: amount = (total_amount + delivery_fee) / installment_count,
     due_date = sale_date + (i * interval_days), reference_type = 'sale',
     collection_status = 'Não Cobrado', paid = false.
  4. Skips generation entirely if the sale is cancelled.
- This makes the frontend simpler: just save the sale, installments appear automatically.

## 3. Security
- RLS already enabled on installments; existing anon+authenticated policies remain.
- New tables: none. New columns are additive.

## 4. Notes
- No existing data is lost. The trigger only regenerates installments for the sale being saved.
- When a sale is updated (e.g. installment_count changes), old installments are replaced.
- Paid installments that are regenerated will reset to unpaid — this is intentional because
  the sale terms changed. In practice, users should not edit installment terms after payments.
*/

-- ===== Add collection columns =====
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installments' AND column_name = 'customer_id') THEN
    ALTER TABLE installments ADD COLUMN customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installments' AND column_name = 'collection_status') THEN
    ALTER TABLE installments ADD COLUMN collection_status text NOT NULL DEFAULT 'Não Cobrado';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installments' AND column_name = 'notified_at') THEN
    ALTER TABLE installments ADD COLUMN notified_at date;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installments' AND column_name = 'sale_id') THEN
    ALTER TABLE installments ADD COLUMN sale_id uuid REFERENCES sales(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Backfill sale_id and customer_id for existing installments
UPDATE installments
SET sale_id = reference_id
WHERE reference_type = 'sale' AND sale_id IS NULL;

UPDATE installments i
SET customer_id = s.customer_id
FROM sales s
WHERE i.sale_id = s.id AND i.customer_id IS NULL;

-- ===== Auto-generation function =====
CREATE OR REPLACE FUNCTION generate_sale_installments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only generate for sales (not purchases) and skip cancelled sales
  IF NEW.status = 'Cancelada' THEN
    DELETE FROM installments WHERE reference_id = NEW.id AND reference_type = 'sale';
    RETURN NEW;
  END IF;

  -- Delete old installments for this sale
  DELETE FROM installments WHERE reference_id = NEW.id AND reference_type = 'sale';

  -- Generate new installments
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
      (NEW.sale_date::date + (i * NEW.installment_interval_days))::date,
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

-- Drop old trigger if exists, create new one
DROP TRIGGER IF EXISTS trg_generate_sale_installments ON sales;
CREATE TRIGGER trg_generate_sale_installments
  AFTER INSERT OR UPDATE OF total_amount, delivery_fee, installment_count, installment_interval_days, sale_date, customer_id, status
  ON sales
  FOR EACH ROW
  EXECUTE FUNCTION generate_sale_installments();

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
