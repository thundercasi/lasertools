/*
# Laser Machine Parts Business Management Schema

## Overview
Complete schema for managing a business that buys and sells parts for specific laser machines.
Covers: parts catalog & stock, suppliers (domestic + international), customers, purchases
(with installments and import tracking), sales (with installment plans), financial installments
(receivable/payable), and competition price tracking.

This is a single-tenant app (no sign-in), so all policies use `TO anon, authenticated` with
`USING (true)` because the data is intentionally shared within the business.

## New Tables
1. `parts` - Catalog of laser machine parts with current stock and cost.
2. `suppliers` - Vendors (domestic or international).
3. `customers` - Buyers.
4. `purchases` - Purchase orders for parts (import flag, currency, installments).
5. `purchase_items` - Line items of a purchase (part, qty, unit cost).
6. `sales` - Sales orders (customer, currency, installments).
7. `sale_items` - Line items of a sale (part, qty, unit price).
8. `installments` - Financial installments for purchases (payable) and sales (receivable).
9. `competition_prices` - Competitor price observations per part.

## Stock Management
- `parts.stock_quantity` is updated by triggers when purchase_items or sale_items are
  inserted/updated/deleted, so stock always reflects posted transactions.
- A trigger on `purchase_items` also updates `parts.unit_cost` to the weighted average
  of the latest purchase cost when new stock arrives.

## Security
- RLS enabled on every table.
- Policies allow anon + authenticated full CRUD (single-tenant, shared business data).
*/

-- ============================================================
-- PARTS
-- ============================================================
CREATE TABLE IF NOT EXISTS parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text,
  machine_model text,
  stock_quantity numeric(14,3) NOT NULL DEFAULT 0,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  min_stock numeric(14,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parts_crud_select" ON parts;
CREATE POLICY "parts_crud_select" ON parts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "parts_crud_insert" ON parts;
CREATE POLICY "parts_crud_insert" ON parts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "parts_crud_update" ON parts;
CREATE POLICY "parts_crud_update" ON parts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "parts_crud_delete" ON parts;
CREATE POLICY "parts_crud_delete" ON parts FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category);
CREATE INDEX IF NOT EXISTS idx_parts_machine_model ON parts(machine_model);

-- ============================================================
-- SUPPLIERS
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text NOT NULL DEFAULT 'Brasil',
  is_international boolean NOT NULL DEFAULT false,
  contact_name text,
  email text,
  phone text,
  document text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suppliers_crud_select" ON suppliers;
CREATE POLICY "suppliers_crud_select" ON suppliers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "suppliers_crud_insert" ON suppliers;
CREATE POLICY "suppliers_crud_insert" ON suppliers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "suppliers_crud_update" ON suppliers;
CREATE POLICY "suppliers_crud_update" ON suppliers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "suppliers_crud_delete" ON suppliers;
CREATE POLICY "suppliers_crud_delete" ON suppliers FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  document text,
  city text,
  state text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers_crud_select" ON customers;
CREATE POLICY "customers_crud_select" ON customers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "customers_crud_insert" ON customers;
CREATE POLICY "customers_crud_insert" ON customers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "customers_crud_update" ON customers;
CREATE POLICY "customers_crud_update" ON customers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "customers_crud_delete" ON customers;
CREATE POLICY "customers_crud_delete" ON customers FOR DELETE TO anon, authenticated USING (true);

-- ============================================================
-- PURCHASES
-- ============================================================
CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  is_import boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'BRL',
  exchange_rate numeric(14,4) NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending', -- pending | received | cancelled
  purchase_date date NOT NULL DEFAULT CURRENT_DATE,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "purchases_crud_select" ON purchases;
CREATE POLICY "purchases_crud_select" ON purchases FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "purchases_crud_insert" ON purchases;
CREATE POLICY "purchases_crud_insert" ON purchases FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "purchases_crud_update" ON purchases;
CREATE POLICY "purchases_crud_update" ON purchases FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "purchases_crud_delete" ON purchases;
CREATE POLICY "purchases_crud_delete" ON purchases FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);

-- ============================================================
-- PURCHASE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL,
  unit_cost numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "purchase_items_crud_select" ON purchase_items;
CREATE POLICY "purchase_items_crud_select" ON purchase_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "purchase_items_crud_insert" ON purchase_items;
CREATE POLICY "purchase_items_crud_insert" ON purchase_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "purchase_items_crud_update" ON purchase_items;
CREATE POLICY "purchase_items_crud_update" ON purchase_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "purchase_items_crud_delete" ON purchase_items;
CREATE POLICY "purchase_items_crud_delete" ON purchase_items FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_part ON purchase_items(part_id);

-- ============================================================
-- SALES
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  currency text NOT NULL DEFAULT 'BRL',
  status text NOT NULL DEFAULT 'pending', -- pending | delivered | cancelled
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  installment_count integer NOT NULL DEFAULT 1,
  installment_interval_days integer NOT NULL DEFAULT 30,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales_crud_select" ON sales;
CREATE POLICY "sales_crud_select" ON sales FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "sales_crud_insert" ON sales;
CREATE POLICY "sales_crud_insert" ON sales FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sales_crud_update" ON sales;
CREATE POLICY "sales_crud_update" ON sales FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sales_crud_delete" ON sales;
CREATE POLICY "sales_crud_delete" ON sales FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

-- ============================================================
-- SALE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL,
  unit_price numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sale_items_crud_select" ON sale_items;
CREATE POLICY "sale_items_crud_select" ON sale_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "sale_items_crud_insert" ON sale_items;
CREATE POLICY "sale_items_crud_insert" ON sale_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sale_items_crud_update" ON sale_items;
CREATE POLICY "sale_items_crud_update" ON sale_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sale_items_crud_delete" ON sale_items;
CREATE POLICY "sale_items_crud_delete" ON sale_items FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_part ON sale_items(part_id);

-- ============================================================
-- INSTALLMENTS (receivable / payable)
-- ============================================================
CREATE TABLE IF NOT EXISTS installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type text NOT NULL, -- 'purchase' | 'sale'
  reference_id uuid NOT NULL,
  installment_number integer NOT NULL,
  due_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  paid_date date,
  paid_amount numeric(14,2),
  currency text NOT NULL DEFAULT 'BRL',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE installments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "installments_crud_select" ON installments;
CREATE POLICY "installments_crud_select" ON installments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "installments_crud_insert" ON installments;
CREATE POLICY "installments_crud_insert" ON installments FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "installments_crud_update" ON installments;
CREATE POLICY "installments_crud_update" ON installments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "installments_crud_delete" ON installments;
CREATE POLICY "installments_crud_delete" ON installments FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_installments_ref ON installments(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_installments_due ON installments(due_date);
CREATE INDEX IF NOT EXISTS idx_installments_paid ON installments(paid);

-- ============================================================
-- COMPETITION PRICES
-- ============================================================
CREATE TABLE IF NOT EXISTS competition_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  competitor text NOT NULL,
  price numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  url text,
  observed_at date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE competition_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "competition_prices_crud_select" ON competition_prices;
CREATE POLICY "competition_prices_crud_select" ON competition_prices FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "competition_prices_crud_insert" ON competition_prices;
CREATE POLICY "competition_prices_crud_insert" ON competition_prices FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "competition_prices_crud_update" ON competition_prices;
CREATE POLICY "competition_prices_crud_update" ON competition_prices FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "competition_prices_crud_delete" ON competition_prices;
CREATE POLICY "competition_prices_crud_delete" ON competition_prices FOR DELETE TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_competition_prices_part ON competition_prices(part_id);

-- ============================================================
-- TRIGGERS: keep parts.updated_at fresh
-- ============================================================
CREATE OR REPLACE FUNCTION touch_parts_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_parts_touch ON parts;
CREATE TRIGGER trg_parts_touch BEFORE UPDATE ON parts
FOR EACH ROW EXECUTE FUNCTION touch_parts_updated_at();

-- ============================================================
-- TRIGGER: stock + cost update on purchase_items
--   - Only affects stock when the parent purchase status = 'received'.
--   - Weighted-average unit cost on new received stock.
-- ============================================================
CREATE OR REPLACE FUNCTION adjust_stock_on_purchase_items()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_old_qty numeric;
  v_new_qty numeric;
  v_old_cost numeric;
  v_new_cost numeric;
  v_current_stock numeric;
  v_current_cost numeric;
BEGIN
  SELECT status INTO v_status FROM purchases WHERE id = COALESCE(NEW.purchase_id, OLD.purchase_id);
  IF v_status IS NULL OR v_status <> 'received' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF (TG_OP = 'INSERT') THEN
    SELECT stock_quantity, unit_cost INTO v_current_stock, v_current_cost
      FROM parts WHERE id = NEW.part_id;
    UPDATE parts SET
      stock_quantity = v_current_stock + NEW.quantity,
      unit_cost = CASE
        WHEN v_current_stock + NEW.quantity <= 0 THEN NEW.unit_cost
        ELSE ((v_current_stock * v_current_cost) + (NEW.quantity * NEW.unit_cost))
             / (v_current_stock + NEW.quantity)
      END
    WHERE id = NEW.part_id;
  ELSIF (TG_OP = 'UPDATE') THEN
    SELECT stock_quantity, unit_cost INTO v_current_stock, v_current_cost
      FROM parts WHERE id = OLD.part_id;
    IF OLD.part_id <> NEW.part_id THEN
      UPDATE parts SET stock_quantity = v_current_stock - OLD.quantity WHERE id = OLD.part_id;
      SELECT stock_quantity, unit_cost INTO v_current_stock, v_current_cost
        FROM parts WHERE id = NEW.part_id;
      UPDATE parts SET
        stock_quantity = v_current_stock + NEW.quantity,
        unit_cost = CASE
          WHEN v_current_stock + NEW.quantity <= 0 THEN NEW.unit_cost
          ELSE ((v_current_stock * v_current_cost) + (NEW.quantity * NEW.unit_cost))
               / (v_current_stock + NEW.quantity)
        END
      WHERE id = NEW.part_id;
    ELSE
      UPDATE parts SET stock_quantity = v_current_stock - OLD.quantity + NEW.quantity
        WHERE id = NEW.part_id;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    SELECT stock_quantity INTO v_current_stock FROM parts WHERE id = OLD.part_id;
    UPDATE parts SET stock_quantity = v_current_stock - OLD.quantity WHERE id = OLD.part_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_purchase_items_stock ON purchase_items;
CREATE TRIGGER trg_purchase_items_stock
AFTER INSERT OR UPDATE OR DELETE ON purchase_items
FOR EACH ROW EXECUTE FUNCTION adjust_stock_on_purchase_items();

-- ============================================================
-- TRIGGER: stock decrement on sale_items
--   - Only affects stock when the parent sale status = 'delivered'.
-- ============================================================
CREATE OR REPLACE FUNCTION adjust_stock_on_sale_items()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_current_stock numeric;
BEGIN
  SELECT status INTO v_status FROM sales WHERE id = COALESCE(NEW.sale_id, OLD.sale_id);
  IF v_status IS NULL OR v_status <> 'delivered' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF (TG_OP = 'INSERT') THEN
    SELECT stock_quantity INTO v_current_stock FROM parts WHERE id = NEW.part_id;
    UPDATE parts SET stock_quantity = v_current_stock - NEW.quantity WHERE id = NEW.part_id;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.part_id <> NEW.part_id THEN
      SELECT stock_quantity INTO v_current_stock FROM parts WHERE id = OLD.part_id;
      UPDATE parts SET stock_quantity = v_current_stock + OLD.quantity WHERE id = OLD.part_id;
      SELECT stock_quantity INTO v_current_stock FROM parts WHERE id = NEW.part_id;
      UPDATE parts SET stock_quantity = v_current_stock - NEW.quantity WHERE id = NEW.part_id;
    ELSE
      SELECT stock_quantity INTO v_current_stock FROM parts WHERE id = NEW.part_id;
      UPDATE parts SET stock_quantity = v_current_stock + OLD.quantity - NEW.quantity WHERE id = NEW.part_id;
    END IF;
  ELSIF (TG_OP = 'DELETE') THEN
    SELECT stock_quantity INTO v_current_stock FROM parts WHERE id = OLD.part_id;
    UPDATE parts SET stock_quantity = v_current_stock + OLD.quantity WHERE id = OLD.part_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sale_items_stock ON sale_items;
CREATE TRIGGER trg_sale_items_stock
AFTER INSERT OR UPDATE OR DELETE ON sale_items
FOR EACH ROW EXECUTE FUNCTION adjust_stock_on_sale_items();

-- ============================================================
-- FUNCTION: regenerate installments for a purchase or sale
--   Called from app after creating/updating a transaction.
-- ============================================================
CREATE OR REPLACE FUNCTION regenerate_installments(
  p_reference_type text,
  p_reference_id uuid,
  p_total numeric,
  p_count integer,
  p_interval_days integer,
  p_start_date date,
  p_currency text DEFAULT 'BRL'
) RETURNS void AS $$
DECLARE
  v_per numeric(14,2);
  v_last numeric(14,2);
  v_date date;
  i integer;
BEGIN
  DELETE FROM installments
    WHERE reference_type = p_reference_type AND reference_id = p_reference_id;

  IF p_count <= 0 OR p_total = 0 THEN
    RETURN;
  END IF;

  v_per := trunc(p_total / p_count, 2);
  v_last := p_total - (v_per * (p_count - 1));

  FOR i IN 1..p_count LOOP
    IF i = 1 THEN
      v_date := p_start_date;
    ELSE
      v_date := p_start_date + ((i - 1) * p_interval_days || ' days')::interval;
    END IF;
    INSERT INTO installments
      (reference_type, reference_id, installment_number, due_date, amount, currency)
    VALUES
      (p_reference_type, p_reference_id, i, v_date,
       CASE WHEN i = p_count THEN v_last ELSE v_per END,
       p_currency);
  END LOOP;
END;
$$ LANGUAGE plpgsql;
