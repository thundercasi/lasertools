import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});

export type Part = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  machine_model: string | null;
  condition: string;
  brand: string | null;
  stock_quantity: number;
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
  notes: string | null;
  created_at: string;
  supplier?: Supplier | null;
  purchase_items?: PurchaseItem[];
};

export type SaleItem = {
  id: string;
  sale_id: string;
  part_id: string;
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
  sale_date: string;
  total_amount: number;
  currency: string;
  installment_count: number;
  installment_interval_days: number;
  nf_tax: number;
  nf_fee: number;
  salesperson_commission: number;
  delivery_fee: number;
  delivery_cost: number;
  first_installment_date: string | null;
  notes: string | null;
  created_at: string;
  customer?: Customer | null;
  sale_items?: SaleItem[];
  sale_files?: SaleFile[];
};

export type Installment = {
  id: string;
  reference_id: string;
  reference_type: string;
  sale_id: string | null;
  purchase_id: string | null;
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
