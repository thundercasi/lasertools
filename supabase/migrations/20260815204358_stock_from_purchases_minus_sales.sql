/*
  # Stock quantity becomes database-derived (purchases - sales)

  ## Problem
  `parts.stock_quantity` has always been manually written by the
  frontend (Purchases.tsx, Sales.tsx) using incremental add/subtract
  logic. This has repeatedly been a source of bugs:
  - Purchases.tsx originally double-counted stock on edit (fixed
    earlier in this project's history).
  - Sales.tsx has the SAME class of bug and was never fixed until now:
    editing a sale deletes its old sale_items and re-inserts new ones,
    but never reverses the stock effect of the old items first — so
    every edit of an existing sale silently decrements stock a second
    time, using a stale in-memory `part.stock_quantity` snapshot.

  ## Fix
  `stock_quantity` becomes a value the DATABASE recomputes from
  scratch — never incremented/decremented — every time a purchase_item
  or sale_item is inserted, updated, or deleted:

      stock_quantity = SUM(purchase_items.quantity) - SUM(sale_items.quantity)

  Because this is a full recomputation (not an incremental delta) on
  every change, there is no way for it to drift or double-count,
  regardless of how the frontend structures its inserts/deletes.

  `unit_cost` (weighted average cost) is NOT touched by this migration
  — that stays owned by the application, since its calculation depends
  on business context (import currency conversion, apportioned
  freight/import tax) that isn't available at the database level.

  ## Frontend impact
  Purchases.tsx and Sales.tsx must stop writing `stock_quantity`
  directly — the database now owns it exclusively. See the
  accompanying frontend changes.
*/

CREATE OR REPLACE FUNCTION recompute_part_stock(p_part_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_part_id IS NULL THEN RETURN; END IF;
  UPDATE parts
  SET stock_quantity = COALESCE((SELECT SUM(quantity) FROM purchase_items WHERE part_id = p_part_id), 0)
                      - COALESCE((SELECT SUM(quantity) FROM sale_items WHERE part_id = p_part_id), 0)
  WHERE id = p_part_id;
END;
$$;

CREATE OR REPLACE FUNCTION trg_stock_sync_purchase_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_part_stock(OLD.part_id);
    RETURN OLD;
  END IF;
  PERFORM recompute_part_stock(NEW.part_id);
  IF TG_OP = 'UPDATE' AND OLD.part_id IS DISTINCT FROM NEW.part_id THEN
    PERFORM recompute_part_stock(OLD.part_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_sync_purchase_items ON purchase_items;
CREATE TRIGGER trg_stock_sync_purchase_items
  AFTER INSERT OR UPDATE OF part_id, quantity OR DELETE ON purchase_items
  FOR EACH ROW
  EXECUTE FUNCTION trg_stock_sync_purchase_items();

CREATE OR REPLACE FUNCTION trg_stock_sync_sale_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_part_stock(OLD.part_id);
    RETURN OLD;
  END IF;
  PERFORM recompute_part_stock(NEW.part_id);
  IF TG_OP = 'UPDATE' AND OLD.part_id IS DISTINCT FROM NEW.part_id THEN
    PERFORM recompute_part_stock(OLD.part_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_sync_sale_items ON sale_items;
CREATE TRIGGER trg_stock_sync_sale_items
  AFTER INSERT OR UPDATE OF part_id, quantity OR DELETE ON sale_items
  FOR EACH ROW
  EXECUTE FUNCTION trg_stock_sync_sale_items();

-- One-time backfill: recompute every part's stock right now, fixing
-- any drift that already accumulated from the old incremental logic.
UPDATE parts p
SET stock_quantity = COALESCE((SELECT SUM(quantity) FROM purchase_items WHERE part_id = p.id), 0)
                    - COALESCE((SELECT SUM(quantity) FROM sale_items WHERE part_id = p.id), 0);

NOTIFY pgrst, 'reload schema';
