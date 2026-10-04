/*
# Staff-only RLS hardening

## Context
The original schema was written for a no-login, single-tenant app, so every
table got `TO anon, authenticated USING (true)` policies. Login + roles were
added later, but those open policies stayed — meaning anyone holding the anon
key (which ships inside the public JS bundle) can read and write the whole ERP
without signing in.

The upcoming customer portal logs customers into this same project, so
"authenticated" can no longer mean "staff" either.

## What this does
1. `is_staff()` — true when the caller has an active `profiles` row with a
   real role (anything but 'sem_papel').
2. Every permissive policy in `public` that is wide open (USING true /
   WITH CHECK true) or granted to `anon` is dropped and replaced by an
   equivalent `TO authenticated` policy gated by `is_staff()`.
   Policies that were already restrictive (e.g. on `profiles`) are left as is.
3. Same for the `sale-files` storage bucket.

Portal tables (created in a later migration) define their own policies.
*/

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND active AND role <> 'sem_papel'
  );
$$;

REVOKE ALL ON FUNCTION public.is_staff() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;

DO $$
DECLARE
  r record;
  v_new text;
BEGIN
  FOR r IN
    SELECT p.schemaname, p.tablename, p.policyname, p.cmd
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename <> 'profiles' -- handled explicitly below
      AND p.permissive = 'PERMISSIVE'
      AND (
        'anon' = ANY (p.roles)
        OR 'public' = ANY (p.roles)
        OR coalesce(trim(p.qual), '') = 'true'
        OR coalesce(trim(p.with_check), '') = 'true'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    v_new := r.tablename || '_staff_' || lower(r.cmd);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', v_new, r.schemaname, r.tablename);

    IF r.cmd = 'SELECT' OR r.cmd = 'DELETE' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s TO authenticated USING (public.is_staff())',
        v_new, r.schemaname, r.tablename, r.cmd);
    ELSIF r.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR INSERT TO authenticated WITH CHECK (public.is_staff())',
        v_new, r.schemaname, r.tablename);
    ELSE -- UPDATE / ALL
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff())',
        v_new, r.schemaname, r.tablename, r.cmd);
    END IF;

    RAISE NOTICE 'hardened %.% (%): % -> %', r.schemaname, r.tablename, r.cmd, r.policyname, v_new;
  END LOOP;
END $$;

-- profiles: everyone used to see every profile (e-mail + role of the whole
-- team). Now: your own row, or all rows if you're staff.
DROP POLICY IF EXISTS profiles_select_authenticated ON profiles;
DROP POLICY IF EXISTS profiles_select_own_or_staff ON profiles;
CREATE POLICY profiles_select_own_or_staff ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_staff());

-- Portal customers are invited with raw_user_meta_data.portal = true and
-- must not get an ERP profile (they'd show up in Usuários as "sem papel").
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.raw_user_meta_data->>'portal', '') = 'true' THEN
    RETURN NEW;
  END IF;
  INSERT INTO profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'sem_papel')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- apply_update_skip_financial is SECURITY DEFINER (bypasses RLS) and had no
-- caller check: any signed-in account could rewrite purchases/sales/
-- maintenances. Same body, now staff-only.
CREATE OR REPLACE FUNCTION public.apply_update_skip_financial(p_table text, p_id uuid, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  set_clause text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF p_table NOT IN ('purchases', 'sales', 'maintenances') THEN
    RAISE EXCEPTION 'apply_update_skip_financial: table % is not allowed', p_table;
  END IF;

  PERFORM set_config('app.sync_financial', 'false', true);

  SELECT string_agg(format('%I = %L', key, value), ', ')
  INTO set_clause
  FROM jsonb_each_text(p_payload);

  IF set_clause IS NULL THEN
    RETURN true;
  END IF;

  EXECUTE format('UPDATE %I SET %s WHERE id = %L', p_table, set_clause, p_id);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inter_status()
RETURNS TABLE(environment text, configured boolean, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bc.environment, (bc.client_id IS NOT NULL), bc.updated_at
  FROM bank_credentials bc
  WHERE bc.id = 'inter' AND public.is_staff();
$$;

-- Internal helpers only ever called from (SECURITY DEFINER) triggers.
REVOKE EXECUTE ON FUNCTION public.recompute_part_stock(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_payment_status(text, uuid) FROM public, anon, authenticated;

-- Views (e.g. part_stock) run with the owner's rights by default, which
-- bypasses RLS on the underlying tables. Make them respect the caller.
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.relname);
  END LOOP;
END $$;

-- Nothing in the ERP runs before sign-in, so anon needs no access at all.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Storage: sale-files bucket (was anon read/write)
DROP POLICY IF EXISTS "sale_files_bucket_read" ON storage.objects;
DROP POLICY IF EXISTS "sale_files_bucket_insert" ON storage.objects;
DROP POLICY IF EXISTS "sale_files_bucket_update" ON storage.objects;
DROP POLICY IF EXISTS "sale_files_bucket_delete" ON storage.objects;

CREATE POLICY "sale_files_bucket_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'sale-files' AND public.is_staff());
CREATE POLICY "sale_files_bucket_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'sale-files' AND public.is_staff());
CREATE POLICY "sale_files_bucket_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'sale-files' AND public.is_staff())
  WITH CHECK (bucket_id = 'sale-files' AND public.is_staff());
CREATE POLICY "sale_files_bucket_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'sale-files' AND public.is_staff());

-- Storage: part-photos bucket. It's a public bucket (photos are shown by
-- public URL, also useful for the portal), so reads stay open; writes were
-- open to anon and are now staff-only.
DROP POLICY IF EXISTS "part_photos_write" ON storage.objects;
DROP POLICY IF EXISTS "part_photos_update" ON storage.objects;
DROP POLICY IF EXISTS "part_photos_delete" ON storage.objects;
CREATE POLICY "part_photos_write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'part-photos' AND public.is_staff());
CREATE POLICY "part_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'part-photos' AND public.is_staff())
  WITH CHECK (bucket_id = 'part-photos' AND public.is_staff());
CREATE POLICY "part_photos_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'part-photos' AND public.is_staff());

NOTIFY pgrst, 'reload schema';
