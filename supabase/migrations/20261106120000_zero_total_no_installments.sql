-- Compra/venda com total R$ 0 não gera parcela (antes gerava uma parcela
-- de R$ 0 que não dava para baixar) e fica com pagamento "Concluída".

CREATE OR REPLACE FUNCTION recompute_payment_status(p_ref_type text, p_ref_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_paid int;
  v_any_progress int;
  v_doc_total numeric;
  v_status text;
BEGIN
  IF p_ref_id IS NULL OR p_ref_type NOT IN ('sale', 'purchase') THEN RETURN; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE paid), COUNT(*) FILTER (WHERE paid OR paid_amount > 0)
  INTO v_total, v_paid, v_any_progress
  FROM installments
  WHERE reference_id = p_ref_id AND reference_type = p_ref_type;

  IF v_total = 0 THEN
    -- Sem parcelas: nada a pagar se o total é zero.
    IF p_ref_type = 'sale' THEN
      SELECT COALESCE(total_amount, 0) + COALESCE(delivery_fee, 0) INTO v_doc_total FROM sales WHERE id = p_ref_id;
    ELSE
      SELECT COALESCE(total_amount, 0) INTO v_doc_total FROM purchases WHERE id = p_ref_id;
    END IF;
    v_status := CASE WHEN COALESCE(v_doc_total, 0) <= 0 THEN 'Concluída' ELSE 'Pendente' END;
  ELSIF v_paid = v_total THEN
    v_status := 'Concluída';
  ELSIF v_any_progress = 0 THEN
    v_status := 'Pendente';
  ELSE
    v_status := 'Parcial';
  END IF;

  IF p_ref_type = 'sale' THEN
    UPDATE sales SET payment_status = v_status WHERE id = p_ref_id;
  ELSE
    UPDATE purchases SET payment_status = v_status WHERE id = p_ref_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION generate_purchase_installments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('app.sync_financial', true), 'true') = 'false' THEN
    RETURN NEW;
  END IF;

  DELETE FROM installments WHERE reference_id = NEW.id AND reference_type = 'purchase';

  IF COALESCE(NEW.total_amount, 0) <= 0 THEN
    PERFORM recompute_payment_status('purchase', NEW.id);
    RETURN NEW;
  END IF;

  FOR i IN 1..GREATEST(NEW.installment_count, 1) LOOP
    INSERT INTO installments (
      reference_type, reference_id, purchase_id, supplier_id,
      installment_number, due_date, amount, paid, paid_amount,
      currency, collection_status
    ) VALUES (
      'purchase', NEW.id, NEW.id, NEW.supplier_id, i,
      (COALESCE(NEW.first_installment_date, NEW.purchase_date)::date + ((i - 1) * NEW.installment_interval_days))::date,
      NEW.total_amount / GREATEST(NEW.installment_count, 1),
      false, 0, 'BRL', 'Não Cobrado'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION generate_sale_installments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  IF COALESCE(NEW.total_amount, 0) + COALESCE(NEW.delivery_fee, 0) <= 0 THEN
    PERFORM recompute_payment_status('sale', NEW.id);
    RETURN NEW;
  END IF;

  FOR i IN 1..GREATEST(NEW.installment_count, 1) LOOP
    INSERT INTO installments (
      reference_type, reference_id, sale_id, customer_id,
      installment_number, due_date, amount, paid, paid_amount,
      currency, collection_status
    ) VALUES (
      'sale', NEW.id, NEW.id, NEW.customer_id, i,
      (COALESCE(NEW.first_installment_date, NEW.sale_date)::date + ((i - 1) * NEW.installment_interval_days))::date,
      (NEW.total_amount + COALESCE(NEW.delivery_fee, 0)) / GREATEST(NEW.installment_count, 1),
      false, 0, NEW.currency, 'Não Cobrado'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- Limpa as parcelas de R$ 0 já criadas (não pagas) e recalcula o status.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT reference_type, reference_id
    FROM installments
    WHERE COALESCE(amount, 0) <= 0 AND NOT paid AND reference_type IN ('purchase', 'sale')
  LOOP
    DELETE FROM installments
    WHERE reference_type = r.reference_type AND reference_id = r.reference_id
      AND COALESCE(amount, 0) <= 0 AND NOT paid;
    PERFORM recompute_payment_status(r.reference_type, r.reference_id);
  END LOOP;
END $$;
