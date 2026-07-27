/*
# Update sales, competition, and add file attachments

## 1. Sales — delivery fees + file attachments
- Add `delivery_fee` (numeric, default 0) — taxa de entrega que o cliente paga (somada à venda).
- Add `delivery_cost` (numeric, default 0) — custo de entrega que pagamos (descontado do líquido).
- New table `sale_files` to store anexos (NFs, comprovantes, etc.):
  - id (uuid PK)
  - sale_id (uuid FK → sales, ON DELETE CASCADE)
  - file_name (text) — nome original do arquivo
  - file_url (text) — URL pública do arquivo no bucket storage
  - content_type (text) — tipo MIME
  - file_size (bigint) — tamanho em bytes
  - created_at (timestamptz)
  - RLS enabled, anon+authenticated CRUD (single-tenant, no auth).

## 2. Competition — competitors registry
- New table `competitors`:
  - id (uuid PK)
  - name (text, unique) — nome do concorrente
  - website (text, nullable) — site
  - notes (text, nullable)
  - created_at (timestamptz)
  - RLS enabled, anon+authenticated CRUD (single-tenant, no auth).
- `competition_prices` already has a `competitor` text column. We keep it for backward
  compatibility (free-text fallback) but the UI will prefer selecting from the
  `competitors` table. We add a nullable `competitor_id` FK to link prices to a
  registered competitor.
  - Add `competitor_id` (uuid, nullable, FK → competitors ON DELETE SET NULL).

## 3. Notes
- No existing data is dropped or altered destructively.
- All new tables get RLS with anon+authenticated access (no-auth single-tenant app).
*/

-- ===== Sales: delivery fees =====
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'delivery_fee') THEN
    ALTER TABLE sales ADD COLUMN delivery_fee numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'delivery_cost') THEN
    ALTER TABLE sales ADD COLUMN delivery_cost numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

-- ===== Competitors registry =====
CREATE TABLE IF NOT EXISTS competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  website text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competitors_crud_select" ON competitors;
CREATE POLICY "competitors_crud_select" ON competitors FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "competitors_crud_insert" ON competitors;
CREATE POLICY "competitors_crud_insert" ON competitors FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "competitors_crud_update" ON competitors;
CREATE POLICY "competitors_crud_update" ON competitors FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "competitors_crud_delete" ON competitors;
CREATE POLICY "competitors_crud_delete" ON competitors FOR DELETE
  TO anon, authenticated USING (true);

-- ===== Competition prices: link to competitors table =====
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'competition_prices' AND column_name = 'competitor_id') THEN
    ALTER TABLE competition_prices ADD COLUMN competitor_id uuid REFERENCES competitors(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ===== Sale files (attachments) =====
CREATE TABLE IF NOT EXISTS sale_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  content_type text,
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sale_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sale_files_crud_select" ON sale_files;
CREATE POLICY "sale_files_crud_select" ON sale_files FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "sale_files_crud_insert" ON sale_files;
CREATE POLICY "sale_files_crud_insert" ON sale_files FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "sale_files_crud_update" ON sale_files;
CREATE POLICY "sale_files_crud_update" ON sale_files FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sale_files_crud_delete" ON sale_files;
CREATE POLICY "sale_files_crud_delete" ON sale_files FOR DELETE
  TO anon, authenticated USING (true);

-- Refresh PostgREST schema cache so new tables/columns are visible immediately
NOTIFY pgrst, 'reload schema';
