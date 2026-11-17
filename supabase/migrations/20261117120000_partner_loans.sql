-- Empréstimos de sócios (sem juros): conta corrente da empresa com cada sócio.
--   Empréstimo = o sócio pagou algo pela empresa → a empresa passa a dever.
--   Devolução  = a empresa devolveu dinheiro ao sócio → a dívida diminui.
CREATE TABLE IF NOT EXISTS partner_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender text NOT NULL,
  entry_date date NOT NULL DEFAULT current_date,
  kind text NOT NULL CHECK (kind IN ('Empréstimo', 'Devolução')),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  description text,
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_loans_lender_date ON partner_loans (lender, entry_date);

ALTER TABLE partner_loans ENABLE ROW LEVEL SECURITY;

-- Só administradores e o financeiro veem e lançam.
CREATE POLICY partner_loans_fin_select ON partner_loans FOR SELECT TO authenticated
  USING (current_user_role() IN ('admin', 'financeiro'));
CREATE POLICY partner_loans_fin_insert ON partner_loans FOR INSERT TO authenticated
  WITH CHECK (current_user_role() IN ('admin', 'financeiro'));
CREATE POLICY partner_loans_fin_update ON partner_loans FOR UPDATE TO authenticated
  USING (current_user_role() IN ('admin', 'financeiro'))
  WITH CHECK (current_user_role() IN ('admin', 'financeiro'));
CREATE POLICY partner_loans_fin_delete ON partner_loans FOR DELETE TO authenticated
  USING (current_user_role() IN ('admin', 'financeiro'));

GRANT SELECT, INSERT, UPDATE, DELETE ON partner_loans TO authenticated;
