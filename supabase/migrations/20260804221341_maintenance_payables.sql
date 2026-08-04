/*
  # Maintenance -> Contas a Pagar

  ## Context
  Every maintenance logged should also show up in Contas a Pagar (the
  installments table), mirroring the pattern already used for purchases
  and sales — but a maintenance is always a single payment (no
  installment count), so exactly one installment row is generated per
  maintenance record.

  ## 1. installments — new column
  `maintenance_id` (uuid, FK -> maintenances ON DELETE CASCADE) — mirrors
  `purchase_id`/`sale_id`. Using a real FK means deleting a maintenance
  automatically removes its installment too, no extra trigger needed for
  that direction.

  ## 2. Trigger
  On INSERT, creates the single installment (due date = maintenance_date,
  amount = cost, unpaid). On UPDATE of cost/maintenance_date, keeps the
  installment in sync — but only while it's still unpaid, so a payment
  that was already settled is never silently altered.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'installments' AND column_name = 'maintenance_id') THEN
    ALTER TABLE installments ADD COLUMN maintenance_id uuid REFERENCES maintenances(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_installments_maintenance ON installments(maintenance_id);

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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_maintenance_installment ON maintenances;
CREATE TRIGGER trg_sync_maintenance_installment
  AFTER INSERT OR UPDATE OF cost, maintenance_date ON maintenances
  FOR EACH ROW
  EXECUTE FUNCTION sync_maintenance_installment();

NOTIFY pgrst, 'reload schema';
