/*
  # Optional financial sync on edit

  ## Problem
  Editing a purchase, sale, or maintenance — even just to change a status
  field — always regenerates its installments (Contas a Receber/Pagar),
  because the triggers fire on UPDATE of several columns. Sometimes the
  user only wants to tweak something small without touching the
  financial records at all.

  ## Approach
  Each of the three installment-generating trigger functions now checks
  a Postgres session setting, `app.sync_financial`. If it's explicitly
  set to 'false', the function returns immediately without touching
  `installments` — the row itself still gets updated normally, only the
  installment sync is skipped.

  Because Supabase/PostgREST typically pools connections (each REST call
  can land on a different underlying session), a plain "set this flag,
  then call .update() separately" wouldn't reliably work across two HTTP
  requests. So the flag and the actual row update must happen in the
  SAME database call. `apply_update_skip_financial(...)` does exactly
  that: it sets `app.sync_financial = 'false'` for the current
  transaction only (`set_config(..., true)` = LOCAL), then performs the
  UPDATE, all inside one function invocation/transaction. The setting
  automatically reverts after the transaction commits, so it never
  leaks into any other request.

  A plain `.update()` call (not going through this function) is
  unaffected and continues to sync the financial records as before —
  that remains the default when the user chooses "Sim, atualizar o
  financeiro".
*/

-- ===== Purchases: skip financial sync when requested =====
CREATE OR REPLACE FUNCTION generate_purchase_installments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF COALESCE(current_setting('app.sync_financial', true), 'true') = 'false' THEN
    RETURN NEW;
  END IF;

  DELETE FROM installments WHERE reference_id = NEW.id AND reference_type = 'purchase';

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

-- ===== Sales: skip financial sync when requested =====
CREATE OR REPLACE FUNCTION generate_sale_installments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF COALESCE(current_setting('app.sync_financial', true), 'true') = 'false' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'Cancelada' THEN
    DELETE FROM installments WHERE reference_id = NEW.id AND reference_type = 'sale';
    RETURN NEW;
  END IF;

  DELETE FROM installments WHERE reference_id = NEW.id AND reference_type = 'sale';

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

-- ===== Maintenances: skip financial sync when requested =====
CREATE OR REPLACE FUNCTION sync_maintenance_installment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF COALESCE(current_setting('app.sync_financial', true), 'true') = 'false' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO installments (
      reference_type, reference_id, maintenance_id,
      installment_number, due_date, amount, paid, paid_amount,
      currency, collection_status
    ) VALUES (
      'maintenance', NEW.id, NEW.id,
      1, NEW.maintenance_date, NEW.cost, false, 0,
      'BRL', 'Não Cobrado'
    );

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE installments
    SET amount = NEW.cost, due_date = NEW.maintenance_date
    WHERE maintenance_id = NEW.id AND paid = false;

    IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM installments WHERE maintenance_id = NEW.id) THEN
      INSERT INTO installments (
        reference_type, reference_id, maintenance_id,
        installment_number, due_date, amount, paid, paid_amount,
        currency, collection_status
      ) VALUES (
        'maintenance', NEW.id, NEW.id,
        1, NEW.maintenance_date, NEW.cost, false, 0,
        'BRL', 'Não Cobrado'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ===== Generic "update without financial sync" RPC =====
-- p_table is restricted to the three known entities on purpose (this
-- builds dynamic SQL — the allow-list keeps it safe). p_payload is the
-- same JSON object the app would otherwise pass to .update() directly.
CREATE OR REPLACE FUNCTION apply_update_skip_financial(p_table text, p_id uuid, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  set_clause text;
BEGIN
  IF p_table NOT IN ('purchases', 'sales', 'maintenances') THEN
    RAISE EXCEPTION 'apply_update_skip_financial: table % is not allowed', p_table;
  END IF;

  PERFORM set_config('app.sync_financial', 'false', true); -- LOCAL: this transaction only

  SELECT string_agg(format('%I = %L', key, value), ', ')
  INTO set_clause
  FROM jsonb_each_text(p_payload);

  IF set_clause IS NULL THEN
    RETURN; -- empty payload, nothing to update
  END IF;

  EXECUTE format('UPDATE %I SET %s WHERE id = %L', p_table, set_clause, p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION apply_update_skip_financial(text, uuid, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
