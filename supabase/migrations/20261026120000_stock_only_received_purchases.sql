-- Estoque passa a contar só compras "Concluída" (recebidas). Compras em
-- outro status aparecem à parte como "a caminho".

-- 1. Visão de estoque por peça/condição, agora com a coluna a_caminho.
CREATE OR REPLACE VIEW part_stock WITH (security_invoker = true) AS
WITH movements AS (
  SELECT pi.part_id,
         pi.condition,
         COALESCE(sum(pi.quantity) FILTER (WHERE p.status = 'Concluída'), 0)  AS qty,
         COALESCE(sum(pi.quantity) FILTER (WHERE p.status <> 'Concluída'), 0) AS incoming,
         0::numeric AS sold
  FROM purchase_items pi
  JOIN purchases p ON p.id = pi.purchase_id
  GROUP BY pi.part_id, pi.condition
  UNION ALL
  SELECT sale_items.part_id, sale_items.condition, 0, 0, sum(sale_items.quantity)
  FROM sale_items
  GROUP BY sale_items.part_id, sale_items.condition
), agg AS (
  SELECT part_id, condition,
         sum(qty) AS comprado,
         sum(sold) AS vendido,
         sum(incoming) AS a_caminho
  FROM movements
  GROUP BY part_id, condition
), maint AS (
  SELECT m.part_id,
         COALESCE(u.condition, m.condition) AS condition,
         count(*) AS em_manutencao
  FROM maintenances m
  LEFT JOIN part_units u ON u.id = m.part_unit_id
  WHERE m.status <> 'Concluída'
  GROUP BY m.part_id, COALESCE(u.condition, m.condition)
)
SELECT a.part_id,
       a.condition,
       a.comprado,
       a.vendido,
       COALESCE(mt.em_manutencao, 0::bigint) AS em_manutencao,
       a.comprado - a.vendido - COALESCE(mt.em_manutencao, 0::bigint)::numeric AS disponivel,
       a.a_caminho
FROM agg a
LEFT JOIN maint mt ON mt.part_id = a.part_id AND mt.condition = a.condition;

-- 2. Estoque gravado na peça (Dashboard, Sugestão de Compras, Vendas): mesma regra.
CREATE OR REPLACE FUNCTION recompute_part_stock(p_part_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open numeric;
BEGIN
  IF p_part_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(COUNT(*), 0) INTO v_open
  FROM maintenances
  WHERE part_id = p_part_id AND status <> 'Concluída';

  UPDATE parts
  SET in_maintenance = v_open,
      stock_quantity = COALESCE((SELECT SUM(pi.quantity)
                                 FROM purchase_items pi
                                 JOIN purchases p ON p.id = pi.purchase_id
                                 WHERE pi.part_id = p_part_id AND p.status = 'Concluída'), 0)
                     - COALESCE((SELECT SUM(quantity) FROM sale_items WHERE part_id = p_part_id), 0)
                     - v_open
  WHERE id = p_part_id;
END;
$$;

-- 3. Unidades de peças controladas por unidade nascem "A caminho" quando a
--    compra ainda não foi recebida (assim não aparecem para venda).
CREATE OR REPLACE FUNCTION trg_purchase_item_units()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_tracked boolean;
  received boolean;
  n int;
BEGIN
  SELECT tracked_by_unit INTO is_tracked FROM parts WHERE id = NEW.part_id;
  IF NOT COALESCE(is_tracked, false) THEN RETURN NEW; END IF;

  SELECT status = 'Concluída' INTO received FROM purchases WHERE id = NEW.purchase_id;

  FOR n IN 1..GREATEST(NEW.quantity::int, 1) LOOP
    INSERT INTO part_units (code, part_id, serial_number, condition, unit_cost, status, purchase_item_id)
    VALUES (
      next_unit_code(), NEW.part_id,
      CASE WHEN NEW.quantity = 1 THEN NULLIF(NEW.serial_number, '') ELSE NULL END,
      NEW.condition,
      COALESCE(NEW.unit_cost_total, NEW.unit_cost, 0),
      CASE WHEN COALESCE(received, false) THEN 'Disponível' ELSE 'A caminho' END,
      NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- 4. Mudou o status da compra: recalcula o estoque das peças dela e libera
--    (ou segura) as unidades.
CREATE OR REPLACE FUNCTION trg_purchase_status_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'Concluída' THEN
    UPDATE part_units SET status = 'Disponível'
    WHERE status = 'A caminho'
      AND purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id = NEW.id);
  ELSE
    UPDATE part_units SET status = 'A caminho'
    WHERE status = 'Disponível'
      AND purchase_item_id IN (SELECT id FROM purchase_items WHERE purchase_id = NEW.id);
  END IF;

  FOR r IN SELECT DISTINCT part_id FROM purchase_items WHERE purchase_id = NEW.id LOOP
    PERFORM recompute_part_stock(r.part_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_status_stock ON purchases;
CREATE TRIGGER trg_purchase_status_stock
  AFTER UPDATE OF status ON purchases
  FOR EACH ROW EXECUTE FUNCTION trg_purchase_status_stock();

-- 5. Ajusta o que já existe: unidades de compras não recebidas e o estoque gravado.
UPDATE part_units u SET status = 'A caminho'
FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
WHERE u.purchase_item_id = pi.id AND p.status <> 'Concluída' AND u.status = 'Disponível';

SELECT recompute_part_stock(id) FROM parts;
