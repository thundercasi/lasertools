/*
  # Maintenance records for parts

  ## Context
  Some parts need maintenance/repair after being acquired, and that has a
  real cost that should be reflected in the part's average cost — same
  spirit as a purchase, but without adding quantity to stock.

  ## 1. New table: maintenances
  - part_id (FK -> parts, cascade delete)
  - maintenance_date, cost, description, provider (optional technician/fornecedor)

  ## 2. Cost application
  Unlike a purchase (which combines new quantity + new cost into the
  weighted average), a maintenance event adds cost WITHOUT adding
  quantity. The cost is spread across the part's current stock:

    new_unit_cost = unit_cost + (maintenance.cost / stock_quantity)

  When stock_quantity is 0, the cost is added directly to unit_cost
  (nothing to spread it across yet).

  This is handled entirely by a database trigger (unlike Purchases, which
  is managed in the app) because, unlike purchases, nothing in the
  frontend independently recomputes this value — so there's no risk of
  double-counting between two competing implementations.

  The trigger correctly reverses the previous contribution on UPDATE/DELETE
  before applying the new one, so editing or deleting a maintenance entry
  never double-counts or leaves stale cost behind. It assumes a
  maintenance record's part_id is not changed after creation (the app
  enforces this).
*/

CREATE TABLE IF NOT EXISTS maintenances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  maintenance_date date NOT NULL DEFAULT CURRENT_DATE,
  cost numeric(14,2) NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintenances_part ON maintenances(part_id);
CREATE INDEX IF NOT EXISTS idx_maintenances_date ON maintenances(maintenance_date);

ALTER TABLE maintenances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "maintenances_crud_select" ON maintenances FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "maintenances_crud_insert" ON maintenances FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "maintenances_crud_update" ON maintenances FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "maintenances_crud_delete" ON maintenances FOR DELETE TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION apply_maintenance_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stock numeric;
  v_cost numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT stock_quantity, unit_cost INTO v_stock, v_cost FROM parts WHERE id = OLD.part_id;
    IF v_stock IS NULL THEN RETURN OLD; END IF;
    IF v_stock > 0 THEN
      UPDATE parts SET unit_cost = GREATEST(v_cost - (OLD.cost / v_stock), 0) WHERE id = OLD.part_id;
    ELSE
      UPDATE parts SET unit_cost = GREATEST(v_cost - OLD.cost, 0) WHERE id = OLD.part_id;
    END IF;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    SELECT stock_quantity, unit_cost INTO v_stock, v_cost FROM parts WHERE id = OLD.part_id;
    IF v_stock IS NULL THEN RETURN NEW; END IF;
    -- Reverse the old contribution
    IF v_stock > 0 THEN
      v_cost := GREATEST(v_cost - (OLD.cost / v_stock), 0);
    ELSE
      v_cost := GREATEST(v_cost - OLD.cost, 0);
    END IF;
    -- Apply the new contribution
    IF v_stock > 0 THEN
      v_cost := v_cost + (NEW.cost / v_stock);
    ELSE
      v_cost := v_cost + NEW.cost;
    END IF;
    UPDATE parts SET unit_cost = v_cost WHERE id = NEW.part_id;
    RETURN NEW;

  ELSE -- INSERT
    SELECT stock_quantity, unit_cost INTO v_stock, v_cost FROM parts WHERE id = NEW.part_id;
    IF v_stock IS NULL THEN RETURN NEW; END IF;
    IF v_stock > 0 THEN
      UPDATE parts SET unit_cost = v_cost + (NEW.cost / v_stock) WHERE id = NEW.part_id;
    ELSE
      UPDATE parts SET unit_cost = v_cost + NEW.cost WHERE id = NEW.part_id;
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_maintenance_cost ON maintenances;
CREATE TRIGGER trg_apply_maintenance_cost
  AFTER INSERT OR UPDATE OF cost OR DELETE ON maintenances
  FOR EACH ROW
  EXECUTE FUNCTION apply_maintenance_cost();

NOTIFY pgrst, 'reload schema';
