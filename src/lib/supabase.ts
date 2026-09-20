import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  active: boolean;
  created_at: string;
};

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  vendedor: 'Vendedor',
  estoque_compras: 'Estoque/Compras',
  financeiro: 'Financeiro',
  sem_papel: 'Sem papel (aguardando liberação)',
};

export type Part = {
  id: string;
  sku: string;
  part_number: string | null;
  name: string;
  description: string | null;
  category: string | null;
  machine_model: string | null;
  condition: string;
  brand: string | null;
  stock_quantity: number;
  in_maintenance: number;
  tracked_by_unit: boolean;
  photo_url: string | null;
  warranty_months: number | null;
  unit_cost: number;
  unit_price: number;
  min_stock: number;
  purchase_date: string | null;
  created_at: string;
  updated_at: string;
};

export type Supplier = {
  id: string;
  name: string;
  country: string;
  is_international: boolean;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  document: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
};

export type Customer = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  document: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  created_at: string;
};

export type PurchaseItem = {
  id: string;
  purchase_id: string;
  part_id: string;
  condition: string;
  quantity: number;
  unit_cost: number;
  unit_cost_total: number;
  serial_number: string | null;
  created_at: string;
  part?: Part | null;
};

export type Purchase = {
  id: string;
  code: string;
  supplier_id: string | null;
  is_import: boolean;
  currency: string;
  exchange_rate: number;
  iof: number;
  iof_type: string;
  rate_confirmed: boolean;
  status: string;
  purchase_date: string;
  total_amount: number;
  freight: number;
  other_expenses: number;
  import_tax: number;
  payment_method: string;
  payment_status: string;
  installment_count: number;
  installment_interval_days: number;
  first_installment_date: string | null;
  related_sale_id: string | null;
  notes: string | null;
  created_at: string;
  supplier?: Supplier | null;
  purchase_items?: PurchaseItem[];
  related_sale?: Sale | null;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  part_id: string;
  condition: string;
  part_unit_id: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  serial_number: string | null;
  created_at: string;
  part?: Part | null;
};

export type SaleFile = {
  id: string;
  sale_id: string;
  file_name: string;
  file_url: string;
  content_type: string | null;
  file_size: number | null;
  created_at: string;
};

export type Sale = {
  id: string;
  code: string;
  customer_id: string | null;
  status: string;
  payment_status: string;
  sale_date: string;
  total_amount: number;
  currency: string;
  installment_count: number;
  installment_interval_days: number;
  nf_tax: number;
  nf_fee: number;
  salesperson_commission: number;
  card_fee_percent: number;
  delivery_fee: number;
  delivery_cost: number;
  first_installment_date: string | null;
  notes: string | null;
  created_at: string;
  customer?: Customer | null;
  sale_items?: SaleItem[];
  sale_files?: SaleFile[];
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  position: number;
  description: string;
  qty: number;
  is_import: boolean;
  cost_usd: number;
  cost_brl: number;
};

export type Order = {
  id: string;
  code: string;
  status: string;
  proposal_date: string;
  seller: string | null;
  client_name: string | null;
  client_doc: string | null;
  address: string | null;
  city_uf: string | null;
  cep: string | null;
  exchange_rate: number;
  freight_usd: number;
  iof_percent: number;
  import_tax_percent: number;
  invoice_tax_percent: number;
  seller_commission_percent: number;
  card_fee_percent: number;
  issuer_commission_percent: number;
  profit_margin_percent: number;
  delivery_time: string | null;
  payment_terms: string | null;
  warranty: string | null;
  proposal_validity: string | null;
  final_discount: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  order_items?: OrderItemRow[];
};

export type Boleto = {
  id: string;
  installment_id: string;
  customer_id: string | null;
  valor: number;
  vencimento: string;
  status: string;
  seu_numero: string | null;
  nosso_numero: string | null;
  linha_digitavel: string | null;
  codigo_barras: string | null;
  pix_copia_cola: string | null;
  codigo_solicitacao: string | null;
  erro_mensagem: string | null;
  created_at: string;
};

export type Installment = {
  id: string;
  reference_id: string;
  reference_type: string;
  sale_id: string | null;
  purchase_id: string | null;
  maintenance_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  installment_number: number;
  amount: number;
  due_date: string;
  paid: boolean;
  paid_date: string | null;
  paid_amount: number;
  currency: string;
  collection_status: string;
  notified_at: string | null;
  created_at: string;
  customer?: Customer | null;
  supplier?: Supplier | null;
  sale?: Sale | null;
  purchase?: Purchase | null;
  maintenance?: Maintenance | null;
};

export type AppSettings = {
  id: string;
  usd_spread_percent: number;
  usd_base_rate: number | null;
  usd_rate_updated_at: string | null;
  order_defaults: Record<string, number> | null;
  updated_at: string;
};

export type Maintenance = {
  id: string;
  part_id: string;
  maintenance_date: string;
  cost: number;
  description: string;
  provider: string | null;
  status: string;
  condition: string;
  part_unit_id: string | null;
  created_at: string;
  part?: Part | null;
};

export type PartUnit = {
  id: string;
  code: string | null;
  part_id: string;
  serial_number: string | null;
  condition: string;
  unit_cost: number;
  status: string;
  purchase_item_id: string | null;
  sale_item_id: string | null;
  notes: string | null;
  created_at: string;
  part?: Part | null;
};

export type PartStock = {
  part_id: string;
  condition: string;
  comprado: number;
  vendido: number;
  em_manutencao: number;
  disponivel: number;
};

export type Competitor = {
  id: string;
  name: string;
  website: string | null;
  notes: string | null;
  created_at: string;
};

export type CompetitionPrice = {
  id: string;
  part_id: string;
  competitor_id: string | null;
  competitor: string;
  price: number;
  currency: string;
  condition: string;
  observed_at: string;
  notes: string | null;
  created_at: string;
  part?: Part | null;
  competitor_ref?: Competitor | null;
};

export const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);

export const USD = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v) || 0);

export const money = (v: number, currency: string) =>
  currency === 'USD' ? USD(v) : BRL(v);

export const formatDate = (d: string | null) => {
  if (!d) return '—';
  // Treat date-only strings (YYYY-MM-DD) as local, not UTC, to avoid timezone shifts.
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('pt-BR');
};
