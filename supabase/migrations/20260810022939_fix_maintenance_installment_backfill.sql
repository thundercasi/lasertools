/*
  # Fix sync_maintenance_installment — create installment on UPDATE if missing

  ## Problem
  The UPDATE branch of sync_maintenance_installment() only ran an
  UPDATE against installments WHERE maintenance_id = NEW.id AND paid =
  false. For maintenance records that never had an installment created
  in the first place — e.g. rows inserted before this trigger existed,
  later touched by an UPDATE (including the backfill script) — that
  UPDATE simply matches zero rows and silently does nothing. The
  maintenance itself saves fine, but no Contas a Pagar entry ever
  appears.

  ## Fix
  On UPDATE, if the UPDATE affects no rows (no installment exists yet
  for this maintenance) AND there isn't already a paid installment for
  it either, insert one now — same as the INSERT branch does.
*/

CREATE OR REPLACE FUNCTION sync_maintenance_installment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
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

    -- No unpaid installment was found to sync. If this maintenance has
    -- NO installment at all yet (legacy record, or one that was somehow
    -- never created), create it now. If it already has a PAID
    -- installment, leave it alone — don't create a duplicate.
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

-- Re-run the backfill now that the fixed function is in place.
UPDATE maintenances SET cost = cost;

NOTIFY pgrst, 'reload schema';
