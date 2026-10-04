/*
# Customer portal schema

Customers of Laser Tools log into a separate frontend (laser-tools-portal)
backed by this same project. They manage their own equipment, maintenance
history, preventive plans, error occurrences and stock, and see what they
bought from Laser Tools.

## Tenancy
- `customer_users` links an auth user to a `customers` row.
- `my_customer_id()` returns the caller's customer (NULL for staff/unknown).
- Every customer-owned table carries `customer_id`, and child tables use
  composite FKs (id, customer_id) so a row can never point at another
  customer's equipment/maintenance.
- Policies: customer sees/edits only `customer_id = my_customer_id()`;
  staff (`is_staff()`) sees everything.

## Reference data maintained by staff (read-only for customers)
- `maintenance_plan_templates`, `model_part_recommendations`, `error_codes`.

## ERP data exposure
ERP tables stay staff-only. The portal reads ERP data exclusively through
SECURITY DEFINER functions (`portal_*`) that filter by `my_customer_id()` and
never return cost, margin or supplier columns.
*/

-- ============================================================
-- customer_users
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  email_notifications boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_users_customer ON customer_users(customer_id);

CREATE OR REPLACE FUNCTION public.my_customer_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT customer_id FROM customer_users WHERE user_id = auth.uid() AND active;
$$;
REVOKE ALL ON FUNCTION public.my_customer_id() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_customer_id() TO authenticated;

ALTER TABLE customer_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_users_select ON customer_users FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_staff());
CREATE POLICY customer_users_update ON customer_users FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_staff()) WITH CHECK (user_id = auth.uid() OR is_staff());
CREATE POLICY customer_users_staff_insert ON customer_users FOR INSERT TO authenticated
  WITH CHECK (is_staff());
CREATE POLICY customer_users_staff_delete ON customer_users FOR DELETE TO authenticated
  USING (is_staff());
-- Customers may only change their own preferences, not customer_id/active.
REVOKE UPDATE ON customer_users FROM authenticated;
GRANT UPDATE (full_name, email_notifications, active) ON customer_users TO authenticated;

-- Stops a customer from flipping their own `active` flag (only staff can).
CREATE OR REPLACE FUNCTION guard_customer_users_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_staff() AND NEW.active IS DISTINCT FROM OLD.active THEN
    RAISE EXCEPTION 'Sem permissão para alterar este campo';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_customer_users ON customer_users;
CREATE TRIGGER trg_guard_customer_users BEFORE UPDATE ON customer_users
  FOR EACH ROW EXECUTE FUNCTION guard_customer_users_update();

-- ============================================================
-- Staff-maintained reference data
-- ============================================================
CREATE TABLE IF NOT EXISTS maintenance_plan_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text,
  machine_model text NOT NULL,
  title text NOT NULL,
  description text,
  interval_days integer NOT NULL CHECK (interval_days > 0),
  part_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_templates_model ON maintenance_plan_templates(lower(machine_model));

CREATE TABLE IF NOT EXISTS model_part_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_model text NOT NULL,
  part_id uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  qty_per_equipment numeric(14,3) NOT NULL CHECK (qty_per_equipment > 0),
  period_days integer NOT NULL DEFAULT 365 CHECK (period_days > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (machine_model, part_id)
);

CREATE TABLE IF NOT EXISTS error_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text,
  machine_model text,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  causes text,
  solution text,
  severity text NOT NULL DEFAULT 'media' CHECK (severity IN ('baixa', 'media', 'alta')),
  related_part_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_error_codes_code ON error_codes(lower(code));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['maintenance_plan_templates', 'model_part_recommendations', 'error_codes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_staff() OR my_customer_id() IS NOT NULL)', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff())', t || '_staff_write', t);
  END LOOP;
END $$;

-- ============================================================
-- Customer-owned data
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_equipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL DEFAULT my_customer_id() REFERENCES customers(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  brand text,
  machine_model text,
  serial_number text,
  acquired_at date,
  acquisition_cost numeric(14,2) NOT NULL DEFAULT 0,
  location text,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'parado', 'inativo')),
  photo_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_equipments_customer ON customer_equipments(customer_id);

CREATE TABLE IF NOT EXISTS maintenance_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL DEFAULT my_customer_id() REFERENCES customers(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL,
  template_id uuid REFERENCES maintenance_plan_templates(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  interval_days integer NOT NULL CHECK (interval_days > 0),
  remind_days_before integer NOT NULL DEFAULT 7 CHECK (remind_days_before >= 0),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  last_done_at date,
  next_due_at date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, customer_id),
  FOREIGN KEY (equipment_id, customer_id) REFERENCES customer_equipments(id, customer_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_maintenance_plans_due ON maintenance_plans(next_due_at) WHERE active;

CREATE TABLE IF NOT EXISTS equipment_maintenances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL DEFAULT my_customer_id() REFERENCES customers(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL,
  plan_id uuid,
  performed_at date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL DEFAULT 'corretiva' CHECK (kind IN ('preventiva', 'corretiva')),
  description text NOT NULL DEFAULT '',
  provider text,
  labor_cost numeric(14,2) NOT NULL DEFAULT 0,
  downtime_hours numeric(10,2) NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, customer_id),
  FOREIGN KEY (equipment_id, customer_id) REFERENCES customer_equipments(id, customer_id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id, customer_id) REFERENCES maintenance_plans(id, customer_id) ON DELETE SET NULL (plan_id)
);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenances_equipment ON equipment_maintenances(equipment_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_maintenances_plan ON equipment_maintenances(plan_id);

CREATE TABLE IF NOT EXISTS equipment_maintenance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL DEFAULT my_customer_id() REFERENCES customers(id) ON DELETE CASCADE,
  maintenance_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'laser_tools')),
  part_id uuid REFERENCES parts(id) ON DELETE SET NULL,
  sale_item_id uuid REFERENCES sale_items(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  quantity numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (maintenance_id, customer_id) REFERENCES equipment_maintenances(id, customer_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_maintenance_items_maintenance ON equipment_maintenance_items(maintenance_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_items_part ON equipment_maintenance_items(part_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_items_sale_item ON equipment_maintenance_items(sale_item_id);

CREATE TABLE IF NOT EXISTS equipment_error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL DEFAULT my_customer_id() REFERENCES customers(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL,
  error_code_id uuid REFERENCES error_codes(id) ON DELETE SET NULL,
  custom_code text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  resolved_at timestamptz,
  maintenance_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (equipment_id, customer_id) REFERENCES customer_equipments(id, customer_id) ON DELETE CASCADE,
  FOREIGN KEY (maintenance_id, customer_id) REFERENCES equipment_maintenances(id, customer_id) ON DELETE SET NULL (maintenance_id)
);
CREATE INDEX IF NOT EXISTS idx_error_logs_equipment ON equipment_error_logs(equipment_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS customer_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL DEFAULT my_customer_id() REFERENCES customers(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, part_id)
);

CREATE TABLE IF NOT EXISTS quote_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL DEFAULT my_customer_id() REFERENCES customers(id) ON DELETE CASCADE,
  requested_by uuid DEFAULT auth.uid(),
  items jsonb NOT NULL DEFAULT '[]',
  notes text,
  status text NOT NULL DEFAULT 'Nova' CHECK (status IN ('Nova', 'Em análise', 'Orçamento enviado', 'Fechada', 'Cancelada')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  dedupe_key text UNIQUE,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_customer ON notifications(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_email_queue ON notifications(created_at) WHERE emailed_at IS NULL;

-- Standard tenant policies
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customer_equipments', 'maintenance_plans', 'equipment_maintenances',
    'equipment_maintenance_items', 'equipment_error_logs', 'customer_stock'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated
      USING (customer_id = my_customer_id() OR is_staff())
      WITH CHECK (customer_id = my_customer_id() OR is_staff())', t || '_tenant', t);
  END LOOP;
END $$;

ALTER TABLE quote_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY quote_requests_select ON quote_requests FOR SELECT TO authenticated
  USING (customer_id = my_customer_id() OR is_staff());
CREATE POLICY quote_requests_insert ON quote_requests FOR INSERT TO authenticated
  WITH CHECK (customer_id = my_customer_id() OR is_staff());
CREATE POLICY quote_requests_staff_update ON quote_requests FOR UPDATE TO authenticated
  USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY quote_requests_staff_delete ON quote_requests FOR DELETE TO authenticated
  USING (is_staff());

-- Notifications are created by the server; customers can only mark read.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated
  USING (customer_id = my_customer_id() OR is_staff());
CREATE POLICY notifications_update ON notifications FOR UPDATE TO authenticated
  USING (customer_id = my_customer_id() OR is_staff())
  WITH CHECK (customer_id = my_customer_id() OR is_staff());
CREATE POLICY notifications_staff_write ON notifications FOR INSERT TO authenticated
  WITH CHECK (is_staff());
REVOKE UPDATE ON notifications FROM authenticated;
GRANT UPDATE (read_at) ON notifications TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object OR undefined_object THEN NULL;
END $$;

-- ============================================================
-- Triggers
-- ============================================================

-- A "Laser Tools" item must point at a sale item the customer actually
-- bought; its price comes from the sale, never from what the client typed.
CREATE OR REPLACE FUNCTION validate_maintenance_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_part uuid;
  v_price numeric;
  v_name text;
BEGIN
  IF NEW.sale_item_id IS NULL THEN
    NEW.source := 'manual';
    RETURN NEW;
  END IF;

  SELECT si.part_id, si.unit_price, p.name
    INTO v_part, v_price, v_name
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN parts p ON p.id = si.part_id
  WHERE si.id = NEW.sale_item_id AND s.customer_id = NEW.customer_id;

  IF v_part IS NULL THEN
    RAISE EXCEPTION 'Item de compra inválido para este cliente';
  END IF;

  NEW.source := 'laser_tools';
  NEW.part_id := v_part;
  NEW.unit_cost := v_price;
  IF coalesce(NEW.description, '') = '' THEN NEW.description := v_name; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_maintenance_item ON equipment_maintenance_items;
CREATE TRIGGER trg_validate_maintenance_item BEFORE INSERT OR UPDATE ON equipment_maintenance_items
  FOR EACH ROW EXECUTE FUNCTION validate_maintenance_item();

-- next_due_at = (last done, or start date) + interval
CREATE OR REPLACE FUNCTION compute_plan_next_due()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.next_due_at := coalesce(NEW.last_done_at, NEW.start_date) + NEW.interval_days;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_plan_next_due ON maintenance_plans;
CREATE TRIGGER trg_plan_next_due BEFORE INSERT OR UPDATE OF last_done_at, start_date, interval_days ON maintenance_plans
  FOR EACH ROW EXECUTE FUNCTION compute_plan_next_due();

-- Keep plan.last_done_at in sync with the latest maintenance linked to it.
CREATE OR REPLACE FUNCTION refresh_plan_last_done(p_plan uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE maintenance_plans
     SET last_done_at = (SELECT max(performed_at) FROM equipment_maintenances WHERE plan_id = p_plan)
   WHERE id = p_plan;
$$;
REVOKE ALL ON FUNCTION refresh_plan_last_done(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION sync_plan_from_maintenance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.plan_id IS NOT NULL THEN
    PERFORM refresh_plan_last_done(OLD.plan_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.plan_id IS NOT NULL THEN
    PERFORM refresh_plan_last_done(NEW.plan_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_sync_plan_from_maintenance ON equipment_maintenances;
CREATE TRIGGER trg_sync_plan_from_maintenance AFTER INSERT OR UPDATE OF plan_id, performed_at OR DELETE ON equipment_maintenances
  FOR EACH ROW EXECUTE FUNCTION sync_plan_from_maintenance();

-- ============================================================
-- Portal RPCs (safe views over ERP data)
-- ============================================================

CREATE OR REPLACE FUNCTION portal_me()
RETURNS TABLE (customer_id uuid, customer_name text, full_name text, email text, email_notifications boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.name, cu.full_name, cu.email, cu.email_notifications
  FROM customer_users cu JOIN customers c ON c.id = cu.customer_id
  WHERE cu.user_id = auth.uid() AND cu.active;
$$;

-- Everything the customer bought from Laser Tools, with the price THEY paid.
CREATE OR REPLACE FUNCTION portal_my_purchases()
RETURNS TABLE (
  sale_item_id uuid, sale_id uuid, sale_code text, sale_date date, sale_status text, currency text,
  part_id uuid, part_name text, sku text, part_number text, brand text, machine_model text,
  condition text, quantity numeric, unit_price numeric, serial_number text,
  warranty_months integer, warranty_until date, used_quantity numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT si.id, s.id, s.code, s.sale_date, s.status, s.currency,
         p.id, p.name, p.sku, p.part_number, p.brand, p.machine_model,
         si.condition, si.quantity, si.unit_price, si.serial_number,
         p.warranty_months,
         CASE WHEN coalesce(p.warranty_months, 0) > 0
              THEN (s.sale_date + make_interval(months => p.warranty_months))::date END,
         coalesce((SELECT sum(i.quantity) FROM equipment_maintenance_items i WHERE i.sale_item_id = si.id), 0)
  FROM sales s
  JOIN sale_items si ON si.sale_id = s.id
  JOIN parts p ON p.id = si.part_id
  WHERE s.customer_id = my_customer_id()
    AND s.status <> 'Cancelada'
  ORDER BY s.sale_date DESC, p.name;
$$;

-- Public-safe part catalog: no cost, price, stock or supplier data.
CREATE OR REPLACE FUNCTION portal_parts(p_ids uuid[] DEFAULT NULL, p_search text DEFAULT NULL)
RETURNS TABLE (id uuid, sku text, part_number text, name text, brand text, machine_model text, category text, photo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.sku, p.part_number, p.name, p.brand, p.machine_model, p.category, p.photo_url
  FROM parts p
  WHERE my_customer_id() IS NOT NULL
    AND (p_ids IS NULL OR p.id = ANY (p_ids))
    AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%'
         OR p.sku ILIKE '%' || p_search || '%' OR p.part_number ILIKE '%' || p_search || '%')
  ORDER BY p.name
  LIMIT 200;
$$;

-- Suggested stock for a coverage window. Takes the larger of:
--   * expected: equipments of each model × recommended qty per period
--   * historical: the customer's own consumption over the last 365 days
-- then subtracts what the customer says they already have.
CREATE OR REPLACE FUNCTION portal_stock_suggestion(p_coverage_days integer DEFAULT 180)
RETURNS TABLE (
  part_id uuid, part_name text, sku text, part_number text, brand text,
  equipment_count integer, expected_qty numeric, historical_qty numeric,
  on_hand numeric, suggested_qty numeric, basis text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cid AS (SELECT my_customer_id() AS id),
  eq AS (
    SELECT lower(trim(e.machine_model)) AS model, count(*)::int AS n
    FROM customer_equipments e, cid
    WHERE e.customer_id = cid.id AND e.status <> 'inativo' AND coalesce(trim(e.machine_model), '') <> ''
    GROUP BY 1
  ),
  expected AS (
    SELECT r.part_id,
           sum(eq.n)::int AS n,
           sum(eq.n * r.qty_per_equipment * p_coverage_days::numeric / r.period_days) AS qty
    FROM model_part_recommendations r
    JOIN eq ON eq.model = lower(trim(r.machine_model))
    GROUP BY r.part_id
  ),
  hist AS (
    SELECT i.part_id, sum(i.quantity) * p_coverage_days::numeric / 365 AS qty
    FROM equipment_maintenance_items i
    JOIN equipment_maintenances m ON m.id = i.maintenance_id
    JOIN cid ON m.customer_id = cid.id
    WHERE i.part_id IS NOT NULL AND m.performed_at >= CURRENT_DATE - 365
    GROUP BY i.part_id
  ),
  stock AS (
    SELECT s.part_id, s.quantity FROM customer_stock s JOIN cid ON s.customer_id = cid.id
  ),
  parts_set AS (
    SELECT part_id FROM expected UNION SELECT part_id FROM hist UNION SELECT part_id FROM stock
  )
  SELECT p.id, p.name, p.sku, p.part_number, p.brand,
         coalesce(e.n, 0),
         round(coalesce(e.qty, 0), 2),
         round(coalesce(h.qty, 0), 2),
         coalesce(s.quantity, 0),
         greatest(ceil(greatest(coalesce(e.qty, 0), coalesce(h.qty, 0)) - coalesce(s.quantity, 0)), 0),
         CASE
           WHEN coalesce(e.qty, 0) = 0 AND coalesce(h.qty, 0) = 0 THEN 'estoque'
           WHEN coalesce(h.qty, 0) > coalesce(e.qty, 0) THEN 'historico'
           ELSE 'recomendacao'
         END
  FROM parts_set ps
  JOIN parts p ON p.id = ps.part_id
  LEFT JOIN expected e ON e.part_id = ps.part_id
  LEFT JOIN hist h ON h.part_id = ps.part_id
  LEFT JOIN stock s ON s.part_id = ps.part_id
  WHERE (SELECT id FROM cid) IS NOT NULL
  ORDER BY 10 DESC, p.name;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'portal_me()', 'portal_my_purchases()', 'portal_parts(uuid[], text)', 'portal_stock_suggestion(integer)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
