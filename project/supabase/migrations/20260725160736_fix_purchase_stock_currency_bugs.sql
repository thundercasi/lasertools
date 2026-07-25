/*
  # Fix stock duplication and currency mixing bugs on purchases

  ## Problem
  1. `purchase_items.unit_cost` only stored the raw cost typed by the user
     (in the purchase's own currency, e.g. USD). It never stored the
     apportioned, BRL-normalized cost that is actually used to update the
     weighted-average `parts.unit_cost`. Because of that, the app could not
     precisely reverse a purchase's effect on stock when the purchase was
     edited, causing quantities to be summed again on every edit.
  2. There is a legacy trigger (`trg_purchase_items_stock`) that duplicates,
     inside the database, stock/cost logic that the frontend already
     performs itself. Its status check (`v_status <> 'received'`) never
     matches any status actually used by the app ('Pendente',
     'Aguardando Entrega', 'Concluída'), so today it is dead code — but it
     is a landmine: if someone "fixes" that string later without knowing
     the frontend already manages stock, purchases will start double
     counting stock again. It is removed here since stock/cost management
     is handled exclusively in the application layer.

  ## Changes
  1. Add `purchase_items.unit_cost_total numeric NOT NULL DEFAULT 0` —
     stores the final apportioned unit cost, in BRL, used to update the
     part's weighted-average cost. This lets purchase edits reverse the
     exact previous impact before applying the new one.
  2. Drop the trigger `trg_purchase_items_stock` and its function
     `adjust_stock_on_purchase_items`, since stock/cost adjustments are
     handled by the application (Purchases.tsx) to keep currency
     conversion (USD -> BRL) and edit-time reversal correct in one place.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_items' AND column_name = 'unit_cost_total'
  ) THEN
    ALTER TABLE purchase_items ADD COLUMN unit_cost_total numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_purchase_items_stock ON purchase_items;
DROP FUNCTION IF EXISTS adjust_stock_on_purchase_items();
