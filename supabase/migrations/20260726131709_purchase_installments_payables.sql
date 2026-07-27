/*
  # Contas a Pagar — installment purchases + auto-generation

  ## Context
  The `installments` table was originally designed to be polymorphic
  (`reference_type` = 'purchase' | 'sale'), but only the 'sale' side was
  ever implemented (see 20260720123705_add_installments_collection_management.sql,
  which added `sale_id`/`customer_id` and the auto-generation trigger for
  sales). This migration implements the 'purchase' side, mirroring that
  same architecture so "Contas a Pagar" works exactly like "Contas a
  Receber".

  ## 1. purchases — new columns
  - `installment_count` (integer, default 1) — any payment method can be
    split into installments, not just "Parcelamento".
  - `installment_interval_days` (integer, default 30)
  - `first_installment_date` (date, nullable) — only used when
    installment_count > 1.

  ## 2. installments — new columns
  - `purchase_id` (uuid, FK -> purchases ON DELETE CASCADE) — explicit
    link, mirrors `sale_id`.
  - `supplier_id` (uuid, FK -> suppliers ON DELETE SET NULL) —
    denormalized for fast "Contas a Pagar" queries, mirrors `customer_id`.

  ## 3. Auto-generation trigger
  Mirrors `generate_sale_installments()`: on insert/update of a purchase's
  total_amount/installment fields, deletes and regenerates that purchase's
  installment rows. `total_amount` on purchases is always stored in BRL
  (see fix_purchase_stock_currency_bugs.sql), so installment currency is
  always 'BRL'.
*/

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS installment_count integer NOT NULL DEFAULT 1;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS installment_interval_days integer NOT NULL DEFAULT 30;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS first_installment_date date;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installments' AND column_name = 'purchase_id') THEN
    ALTER TABLE installments ADD COLUMN purchase_id uuid REFERENCES purchases(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installments' AND column_name = 'supplier_id') THEN
    ALTER TABLE installments ADD COLUMN supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_installments_purchase ON installments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_installments_supplier ON installments(supplier_id);

CREATE OR REPLACE FUNCTION generate_purchase_installments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete old installments for this purchase
  DELETE FROM installments WHERE reference_id = NEW.id AND reference_type = 'purchase';

  -- Generate new installments (any payment method can be split)
  FOR i IN 1..GREATEST(NEW.installment_count, 1) LOOP
    INSERT INTO installments (
      reference_type, reference_id, purchase_id, supplier_id,
      installment_number, due_date, amount, paid, paid_amount,
      currency, collection_status
    ) VALUES (
      'purchase',
      NEW.id,
      NEW.id,
      NEW.supplier_id,
      i,
      (COALESCE(NEW.first_installment_date, NEW.purchase_date)::date + ((i - 1) * NEW.installment_interval_days))::date,
      NEW.total_amount / GREATEST(NEW.installment_count, 1),
      false,
      0,
      'BRL',
      'Não Cobrado'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_purchase_installments ON purchases;
CREATE TRIGGER trg_generate_purchase_installments
  AFTER INSERT OR UPDATE OF total_amount, installment_count, installment_interval_days, purchase_date, first_installment_date, supplier_id
  ON purchases
  FOR EACH ROW
  EXECUTE FUNCTION generate_purchase_installments();

NOTIFY pgrst, 'reload schema';
