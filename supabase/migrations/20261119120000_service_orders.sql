-- Ordens de Serviço (ex.: reparo de fontes do cliente). Uma OS tem vários
-- itens (as peças do cliente); ao faturar, gera uma venda sem itens de
-- estoque — o custo do reparo vai em sales.service_cost.

CREATE TABLE IF NOT EXISTS service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  received_date date NOT NULL DEFAULT current_date,
  expected_date date,
  delivered_date date,
  status text NOT NULL DEFAULT 'Recebido' CHECK (status IN (
    'Recebido', 'Em análise', 'Aguardando aprovação', 'Aprovado', 'Em reparo', 'Pronto', 'Entregue', 'Cancelado'
  )),
  notes text,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  description text NOT NULL,
  part_id uuid REFERENCES parts(id) ON DELETE SET NULL,      -- modelo de referência (opcional)
  serial_number text,
  reported_defect text,
  diagnosis text,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL, -- técnico/fornecedor do reparo
  item_status text NOT NULL DEFAULT 'Pendente' CHECK (item_status IN ('Pendente', 'Reparado', 'Sem conserto')),
  cost numeric(14, 2) NOT NULL DEFAULT 0,
  price numeric(14, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_order_items_order ON service_order_items (service_order_id, position);

-- Venda gerada por uma OS: sem itens de estoque, custo do serviço à parte.
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS service_order_id uuid REFERENCES service_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_cost numeric(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_orders_staff_all ON service_orders FOR ALL TO authenticated
  USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY service_order_items_staff_all ON service_order_items FOR ALL TO authenticated
  USING (is_staff()) WITH CHECK (is_staff());

GRANT SELECT, INSERT, UPDATE, DELETE ON service_orders, service_order_items TO authenticated;
