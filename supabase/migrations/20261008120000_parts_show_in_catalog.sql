-- Peças marcadas como internas (ex.: códigos de upgrade) não aparecem no
-- portfólio enviado aos clientes nem na busca do Portal do Cliente.
ALTER TABLE parts ADD COLUMN IF NOT EXISTS show_in_catalog boolean NOT NULL DEFAULT true;

-- Portal: itens internos só aparecem quando o cliente já os comprou
-- (consulta por p_ids, vinda do histórico de compras dele), nunca na busca.
CREATE OR REPLACE FUNCTION portal_parts(p_ids uuid[] DEFAULT NULL, p_search text DEFAULT NULL)
RETURNS TABLE (id uuid, sku text, part_number text, name text, brand text, machine_model text, category text, photo_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.sku, p.part_number, p.name, p.brand, p.machine_model, p.category, p.photo_url
  FROM parts p
  WHERE my_customer_id() IS NOT NULL
    AND (p_ids IS NULL OR p.id = ANY (p_ids))
    AND (p.show_in_catalog OR p_ids IS NOT NULL)
    AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%'
         OR p.sku ILIKE '%' || p_search || '%' OR p.part_number ILIKE '%' || p_search || '%')
  ORDER BY p.name
  LIMIT 200;
$$;
