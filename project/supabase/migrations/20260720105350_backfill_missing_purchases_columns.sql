/*
  # Backfill missing purchases columns

  ## Problem
  The columns `iof` and `rate_confirmed` on `purchases` are used
  throughout the application (Purchases.tsx, the Purchase type in
  lib/supabase.ts) and are referenced by later migrations
  (fix_iof_precision_add_import_tax.sql alters `iof`), but neither was
  ever created by a migration — they were added directly in the Supabase
  dashboard at some point and the change was never captured as SQL.
  Rebuilding the schema from the migrations alone therefore fails with
  "column does not exist".

  ## Changes
  Add the two missing columns, matching the types the app expects.
*/

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS iof numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS rate_confirmed boolean NOT NULL DEFAULT true;
