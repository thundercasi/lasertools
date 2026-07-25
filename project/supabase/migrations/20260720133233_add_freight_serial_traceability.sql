/*
# Add freight, other expenses, serial/lot traceability, and sale unit_cost

## 1. Purchases — freight & other expenses
- `freight` (numeric, NOT NULL, default 0) — valor do frete da compra.
- `other_expenses` (numeric, NOT NULL, default 0) — outras despesas (taxas, etc.).
  These are apportioned proportionally across purchase items and added to unit cost.

## 2. Purchase items — serial/lot
- `serial_number` (text, nullable) — número de série ou lote da peça (rastreabilidade).

## 3. Sale items — serial/lot + unit_cost
- `serial_number` (text, nullable) — número de série/lote entregue ao cliente.
- `unit_cost` (numeric, NOT NULL, default 0) — custo unitário da peça no momento da venda,
  used to calculate the real profit margin (COGS).

## 4. Parts — average cost
- The existing `unit_cost` column will now store the weighted average cost,
  recalculated on each purchase: new_avg = (old_stock * old_cost + new_qty * new_cost) / (old_stock + new_qty).
  No schema change needed — just updated logic in the app.

## Notes
- All changes are additive. No data is lost.
*/

-- Purchases: freight + other_expenses
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = 'freight') THEN
    ALTER TABLE purchases ADD COLUMN freight numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = 'other_expenses') THEN
    ALTER TABLE purchases ADD COLUMN other_expenses numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Purchase items: serial_number
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_items' AND column_name = 'serial_number') THEN
    ALTER TABLE purchase_items ADD COLUMN serial_number text;
  END IF;
END $$;

-- Sale items: serial_number + unit_cost
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sale_items' AND column_name = 'serial_number') THEN
    ALTER TABLE sale_items ADD COLUMN serial_number text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sale_items' AND column_name = 'unit_cost') THEN
    ALTER TABLE sale_items ADD COLUMN unit_cost numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
