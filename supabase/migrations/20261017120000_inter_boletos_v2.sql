-- Integração Banco Inter (cobrança v3) — segunda etapa.

-- Endereço do pagador: o Inter exige endereço, cidade, UF e CEP.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS cep text;

-- Conta corrente (header x-conta-corrente), só necessário quando a
-- integração tem acesso a mais de uma conta.
ALTER TABLE bank_credentials ADD COLUMN IF NOT EXISTS conta_corrente text;

-- Situação devolvida pelo Inter (A_RECEBER, RECEBIDO, CANCELADO, EXPIRADO...).
ALTER TABLE boletos ADD COLUMN IF NOT EXISTS situacao text;

-- No máximo um boleto ativo por parcela — evita cobrança em dobro em
-- duplo clique ou duas abas abertas.
CREATE UNIQUE INDEX IF NOT EXISTS boletos_one_active_per_installment
  ON boletos (installment_id) WHERE status IN ('Emitido', 'Processando');

-- Salvar credenciais: agora com ambiente (sandbox/produção) e conta
-- corrente. Campos deixados em branco mantêm o valor já salvo, para dar
-- para trocar só o ambiente sem recolar certificado e chave.
DROP FUNCTION IF EXISTS admin_save_inter_credentials(text, text, text, text);
CREATE FUNCTION admin_save_inter_credentials(
  p_client_id text, p_client_secret text, p_cert_pem text, p_key_pem text,
  p_environment text DEFAULT 'producao', p_conta_corrente text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem configurar credenciais bancárias';
  END IF;
  IF p_environment NOT IN ('sandbox', 'producao') THEN
    RAISE EXCEPTION 'Ambiente inválido: %', p_environment;
  END IF;

  UPDATE bank_credentials
  SET client_id      = COALESCE(NULLIF(trim(p_client_id), ''), client_id),
      client_secret  = COALESCE(NULLIF(trim(p_client_secret), ''), client_secret),
      cert_pem       = COALESCE(NULLIF(trim(p_cert_pem), ''), cert_pem),
      key_pem        = COALESCE(NULLIF(trim(p_key_pem), ''), key_pem),
      conta_corrente = NULLIF(regexp_replace(coalesce(p_conta_corrente, ''), '\D', '', 'g'), ''),
      updated_at     = now()
  WHERE id = 'inter';

  UPDATE bank_credentials
  SET environment = CASE
        WHEN client_id IS NOT NULL AND client_secret IS NOT NULL
             AND cert_pem IS NOT NULL AND key_pem IS NOT NULL
        THEN p_environment ELSE 'simulado' END
  WHERE id = 'inter';
END;
$$;

REVOKE ALL ON FUNCTION admin_save_inter_credentials(text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_save_inter_credentials(text, text, text, text, text, text) TO authenticated;

-- Status para a tela: inclui a conta corrente (não é segredo).
DROP FUNCTION IF EXISTS get_inter_status();
CREATE FUNCTION get_inter_status()
RETURNS TABLE (environment text, configured boolean, updated_at timestamptz, conta_corrente text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT bc.environment, (bc.client_id IS NOT NULL), bc.updated_at, bc.conta_corrente
  FROM bank_credentials bc
  WHERE bc.id = 'inter' AND public.is_staff();
$$;

REVOKE ALL ON FUNCTION get_inter_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_inter_status() TO authenticated;
