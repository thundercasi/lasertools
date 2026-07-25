/*
# Storage policy for sale-files bucket

Allow public read and anon+authenticated upload/update/delete for the sale-files bucket.
This is a single-tenant no-auth app, so all access is open.
*/

DROP POLICY IF EXISTS "sale_files_bucket_read" ON storage.objects;
CREATE POLICY "sale_files_bucket_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'sale-files');

DROP POLICY IF EXISTS "sale_files_bucket_insert" ON storage.objects;
CREATE POLICY "sale_files_bucket_insert" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'sale-files');

DROP POLICY IF EXISTS "sale_files_bucket_update" ON storage.objects;
CREATE POLICY "sale_files_bucket_update" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'sale-files') WITH CHECK (bucket_id = 'sale-files');

DROP POLICY IF EXISTS "sale_files_bucket_delete" ON storage.objects;
CREATE POLICY "sale_files_bucket_delete" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'sale-files');
