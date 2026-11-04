-- Depósito dos anexos de venda (NFs, comprovantes). Privado: só a equipe
-- acessa, via links temporários (as políticas sale_files_bucket_* já existem).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sale-files', 'sale-files', false, 20971520)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;
