-- Recebimento em lote / antecipação de cartão: a parcela é quitada com um
-- valor recebido menor que o valor da parcela; a diferença é a taxa
-- (cartão + antecipação), e não uma dívida do cliente.
ALTER TABLE installments
  ADD COLUMN IF NOT EXISTS fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_type text;

COMMENT ON COLUMN installments.fee_amount IS 'Taxa descontada no recebimento (cartão/antecipação). Quitada = paid_amount + fee_amount >= amount.';
COMMENT ON COLUMN installments.settlement_type IS 'Como a parcela foi quitada, ex.: Antecipação.';
