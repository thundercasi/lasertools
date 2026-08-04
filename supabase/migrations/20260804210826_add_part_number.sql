/*
  # Add part_number to parts

  `part_number` is the manufacturer/market identifier for the part
  (distinct from `sku`, which is our own internal code, e.g. PEC-0001).
*/

ALTER TABLE parts ADD COLUMN IF NOT EXISTS part_number text;

NOTIFY pgrst, 'reload schema';
