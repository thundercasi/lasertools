import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Wrench, Search, Copy, X, Receipt, ExternalLink } from 'lucide-react';
import { supabase, BRL, formatDate, type Customer, type Part, type Supplier } from '../lib/supabase';
import CustomerPicker from './CustomerPicker';
import { Modal, Field, Badge, EmptyState, PageHeader, ConfirmDelete, ViewEditFooter } from './ui';

// Ordens de Serviço: peças do cliente que entram para reparo. Cada OS tem
// vários itens; ao ficar pronta, "Faturar" gera a venda (sem baixar estoque —
// a peça é do cliente) e daí saem parcelas, boleto etc.

const OS_STATUS = ['Recebido', 'Em análise', 'Aguardando aprovação', 'Aprovado', 'Em reparo', 'Pronto', 'Entregue', 'Cancelado'] as const;
type OsStatus = typeof OS_STATUS[number];
const ITEM_STATUS = ['Pendente', 'Reparado', 'Sem conserto'] as const;
const SALE_PAYMENT_METHODS = ['PIX', 'Cartão de crédito', 'Cartão de débito', 'Boleto', 'Transferência', 'Dinheiro', 'Troca/Permuta'] as const;

const statusTone = (s: string): 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet' => {
  switch (s) {
    case 'Recebido': return 'slate';
    case 'Em análise': return 'blue';
    case 'Aguardando aprovação': return 'amber';
    case 'Aprovado': return 'violet';
    case 'Em reparo': return 'blue';
    case 'Pronto': return 'green';
    case 'Entregue': return 'green';
    case 'Cancelado': return 'red';
    default: return 'slate';
  }
};

type OsItem = {
  id?: string;
  description: string;
  part_id: string;
  serial_number: string;
  reported_defect: string;
  diagnosis: string;
  supplier_id: string;
  item_status: string;
  cost: number;
  price: number;
};

type ServiceOrder = {
  id: string;
  code: string;
  customer_id: string | null;
  received_date: string;
  expected_date: string | null;
  delivered_date: string | null;
  status: OsStatus;
  notes: string | null;
  sale_id: string | null;
  created_at: string;
  service_order_items?: (OsItem & { id: string; position: number })[];
  sale?: { id: string; code: string } | null;
};

const todayStr = () => new Date().toLocaleDateString('en-CA');
const newItem = (): OsItem => ({
  description: '', part_id: '', serial_number: '', reported_defect: '', diagnosis: '',
  supplier_id: '', item_status: 'Pendente', cost: 0, price: 0,
});
const emptyHeader = {
  customer_id: '', received_date: todayStr(), expected_date: '', delivered_date: '',
  status: 'Recebido' as OsStatus, notes: '',
};
const inputCls = 'input';

export default function ServiceOrders() {
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'abertas' | 'todas' | OsStatus>('abertas');
  const [query, setQuery] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceOrder | null>(null);
  const [viewing, setViewing] = useState(false);
  const [header, setHeader] = useState(emptyHeader);
  const [items, setItems] = useState<OsItem[]>([newItem()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Faturamento
  const [billing, setBilling] = useState<ServiceOrder | null>(null);
  const [bill, setBill] = useState({ sale_date: todayStr(), payment_method: '', installment_count: 1, installment_interval_days: 30, first_installment_date: todayStr() });
  const [billSaving, setBillSaving] = useState(false);
  const [billError, setBillError] = useState('');

  const load = async () => {
    setLoading(true);
    const [{ data: os, error: e }, { data: c }, { data: p }, { data: s }] = await Promise.all([
      supabase.from('service_orders').select('*, service_order_items(*), sale:sale_id(id, code)').order('received_date', { ascending: false }).order('code', { ascending: false }),
      supabase.from('customers').select('*').order('name'),
      supabase.from('parts').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
    ]);
    if (e) setError(e.message);
    setOrders((os as ServiceOrder[]) ?? []);
    setCustomers((c as Customer[]) ?? []);
    setParts((p as Part[]) ?? []);
    setSuppliers((s as Supplier[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const customerName = (id: string | null) => customers.find((c) => c.id === id)?.name ?? '—';
  const totals = (its: { cost: number; price: number }[]) => ({
    cost: its.reduce((s, i) => s + (Number(i.cost) || 0), 0),
    price: its.reduce((s, i) => s + (Number(i.price) || 0), 0),
  });

  const isOpen = (o: ServiceOrder) => o.status !== 'Entregue' && o.status !== 'Cancelado';
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter === 'abertas' && !isOpen(o)) return false;
      if (statusFilter !== 'abertas' && statusFilter !== 'todas' && o.status !== statusFilter) return false;
      if (!q) return true;
      return o.code.toLowerCase().includes(q)
        || customerName(o.customer_id).toLowerCase().includes(q)
        || (o.service_order_items ?? []).some((i) => (i.serial_number ?? '').toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, statusFilter, query, customers]);

  const countBy = (s: OsStatus) => orders.filter((o) => o.status === s).length;

  // ===== Formulário =====
  const openNew = () => {
    setEditing(null);
    setViewing(false);
    setHeader({ ...emptyHeader, received_date: todayStr() });
    setItems([newItem()]);
    setFormError('');
    setOpen(true);
  };

  const openEdit = (o: ServiceOrder, view = false) => {
    setEditing(o);
    setViewing(view);
    setHeader({
      customer_id: o.customer_id ?? '', received_date: o.received_date, expected_date: o.expected_date ?? '',
      delivered_date: o.delivered_date ?? '', status: o.status, notes: o.notes ?? '',
    });
    const its = [...(o.service_order_items ?? [])].sort((a, b) => a.position - b.position).map((i) => ({
      id: i.id, description: i.description, part_id: i.part_id ?? '', serial_number: i.serial_number ?? '',
      reported_defect: i.reported_defect ?? '', diagnosis: i.diagnosis ?? '', supplier_id: i.supplier_id ?? '',
      item_status: i.item_status, cost: Number(i.cost) || 0, price: Number(i.price) || 0,
    }));
    setItems(its.length ? its : [newItem()]);
    setFormError('');
    setOpen(true);
  };

  const updateItem = (idx: number, patch: Partial<OsItem>) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const duplicateItem = (idx: number) => setItems((prev) => {
    const copy = { ...prev[idx], id: undefined, serial_number: '' };
    return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
  });
  const removeItem = (idx: number) => setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : [newItem()]));

  const pickPart = (idx: number, partId: string) => {
    const p = parts.find((x) => x.id === partId);
    updateItem(idx, {
      part_id: partId,
      ...(p && !items[idx].description.trim() ? { description: p.brand?.trim() ? `${p.name} - ${p.brand.trim()}` : p.name } : {}),
    });
  };

  const save = async () => {
    const valid = items.filter((i) => i.description.trim());
    if (!header.customer_id) { setFormError('Selecione o cliente.'); return; }
    if (valid.length === 0) { setFormError('Inclua ao menos um item (descrição da peça).'); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      customer_id: header.customer_id, received_date: header.received_date,
      expected_date: header.expected_date || null,
      delivered_date: header.delivered_date || (header.status === 'Entregue' ? todayStr() : null),
      status: header.status, notes: header.notes.trim() || null, updated_at: new Date().toISOString(),
    };
    let osId = editing?.id;
    if (editing) {
      const { error: e } = await supabase.from('service_orders').update(payload).eq('id', editing.id);
      if (e) { setSaving(false); setFormError(e.message); return; }
    } else {
      const max = orders.reduce((m, o) => { const n = o.code.match(/(\d+)$/); return n ? Math.max(m, parseInt(n[1], 10)) : m; }, 0);
      const { data, error: e } = await supabase.from('service_orders')
        .insert({ ...payload, code: `OS-${String(max + 1).padStart(4, '0')}` }).select('id').single();
      if (e || !data) { setSaving(false); setFormError(e?.message ?? 'Falha ao criar a OS.'); return; }
      osId = data.id;
    }
    // Regrava os itens na ordem da tela.
    await supabase.from('service_order_items').delete().eq('service_order_id', osId!);
    const rows = valid.map((i, idx) => ({
      service_order_id: osId, position: idx, description: i.description.trim(),
      part_id: i.part_id || null, serial_number: i.serial_number.trim() || null,
      reported_defect: i.reported_defect.trim() || null, diagnosis: i.diagnosis.trim() || null,
      supplier_id: i.supplier_id || null, item_status: i.item_status,
      cost: Math.round((Number(i.cost) || 0) * 100) / 100, price: Math.round((Number(i.price) || 0) * 100) / 100,
    }));
    const { error: ie } = await supabase.from('service_order_items').insert(rows);
    setSaving(false);
    if (ie) { setFormError(ie.message); return; }
    setOpen(false);
    load();
  };

  const remove = async () => {
    if (!deleteId) return;
    await supabase.from('service_orders').delete().eq('id', deleteId);
    setDeleteId(null);
    load();
  };

  // ===== Faturar: gera a venda =====
  const openBilling = (o: ServiceOrder) => {
    setBilling(o);
    setBill({ sale_date: todayStr(), payment_method: '', installment_count: 1, installment_interval_days: 30, first_installment_date: todayStr() });
    setBillError('');
  };

  const confirmBilling = async () => {
    if (!billing) return;
    const its = billing.service_order_items ?? [];
    const { cost, price } = totals(its);
    if (price <= 0) { setBillError('A OS não tem valor a cobrar. Preencha o preço dos itens antes de faturar.'); return; }
    if (!bill.payment_method) { setBillError('Selecione a forma de pagamento.'); return; }
    setBillSaving(true);
    setBillError('');
    const { data: codes } = await supabase.from('sales').select('code');
    const max = ((codes as { code: string }[]) ?? []).reduce((m, s) => { const n = s.code.match(/(\d+)$/); return n ? Math.max(m, parseInt(n[1], 10)) : m; }, 0);
    const lista = its.filter((i) => Number(i.price) > 0).map((i) => `${i.description}${i.serial_number ? ` (S/N ${i.serial_number})` : ''}`).join('; ');
    const { data: sale, error: e } = await supabase.from('sales').insert({
      code: `VEND-${String(max + 1).padStart(4, '0')}`,
      customer_id: billing.customer_id,
      status: 'Concluída',
      sale_date: bill.sale_date,
      currency: 'BRL',
      total_amount: Math.round(price * 100) / 100,
      service_cost: Math.round(cost * 100) / 100,
      service_order_id: billing.id,
      payment_method: bill.payment_method,
      installment_count: Math.max(1, Number(bill.installment_count) || 1),
      installment_interval_days: Math.max(0, Number(bill.installment_interval_days) || 0),
      first_installment_date: bill.first_installment_date || bill.sale_date,
      notes: `Serviço ${billing.code}: ${lista}`.slice(0, 1000),
    }).select('id, code').single();
    if (e || !sale) { setBillSaving(false); setBillError(e?.message ?? 'Falha ao gerar a venda.'); return; }
    await supabase.from('service_orders').update({ sale_id: sale.id, updated_at: new Date().toISOString() }).eq('id', billing.id);
    setBillSaving(false);
    setBilling(null);
    load();
  };

  const formTotals = totals(items);

  return (
    <div>
      <PageHeader
        title="Ordens de Serviço"
        subtitle="Peças do cliente em reparo — da entrada à entrega. Ao ficar pronta, fature para gerar a venda e o contas a receber."
        action={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Nova OS</button>}
      />
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{error}</div>}

      <div className="flex flex-col lg:flex-row gap-3 mb-4">
        <div className="flex gap-2 flex-wrap">
          {(['abertas', 'todas'] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-3.5 py-2 rounded-xl text-sm font-medium transition ${statusFilter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
              {f === 'abertas' ? `Em aberto (${orders.filter(isOpen).length})` : `Todas (${orders.length})`}
            </button>
          ))}
          {OS_STATUS.filter((s) => countBy(s) > 0).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3.5 py-2 rounded-xl text-sm font-medium transition ${statusFilter === s ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
              {s} ({countBy(s)})
            </button>
          ))}
        </div>
        <div className="relative lg:ml-auto lg:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input className="input pl-10" placeholder="Cliente, OS ou nº de série..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Wrench} title="Nenhuma ordem de serviço" subtitle="Clique em Nova OS para registrar as peças que o cliente enviou para reparo." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">OS</th>
                  <th className="th">Cliente</th>
                  <th className="th">Entrada</th>
                  <th className="th">Itens</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Valor</th>
                  <th className="th">Venda</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((o) => {
                  const its = o.service_order_items ?? [];
                  const t = totals(its);
                  const done = its.filter((i) => i.item_status !== 'Pendente').length;
                  const canBill = !o.sale_id && (o.status === 'Pronto' || o.status === 'Entregue') && t.price > 0;
                  return (
                    <tr key={o.id} className="hover:bg-slate-50/50 transition cursor-pointer" onClick={() => openEdit(o, true)}>
                      <td className="td font-semibold text-slate-900 whitespace-nowrap">{o.code}</td>
                      <td className="td text-slate-700">{customerName(o.customer_id)}</td>
                      <td className="td text-slate-500 whitespace-nowrap">
                        {formatDate(o.received_date)}
                        {o.expected_date && isOpen(o) && <div className="text-xs text-slate-400">previsão {formatDate(o.expected_date)}</div>}
                      </td>
                      <td className="td text-slate-600">
                        {its.length} {its.length === 1 ? 'peça' : 'peças'}
                        {its.length > 0 && <div className="text-xs text-slate-400">{done}/{its.length} concluídas</div>}
                      </td>
                      <td className="td"><Badge tone={statusTone(o.status)}>{o.status}</Badge></td>
                      <td className="td text-right font-semibold text-slate-900 whitespace-nowrap">{t.price > 0 ? BRL(t.price) : '—'}</td>
                      <td className="td whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {o.sale ? (
                          <span className="text-sm text-emerald-700 font-medium inline-flex items-center gap-1"><ExternalLink size={12} /> {o.sale.code}</span>
                        ) : canBill ? (
                          <button onClick={() => openBilling(o)} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition inline-flex items-center gap-1">
                            <Receipt size={13} /> Faturar
                          </button>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="td" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <button className="icon-btn" title="Editar" onClick={() => openEdit(o)}><Pencil size={15} /></button>
                          <button className="icon-btn hover:text-red-600" title="Excluir" onClick={() => setDeleteId(o.id)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <Modal title={viewing ? `Consultar ${editing?.code}` : editing ? `Editar ${editing.code}` : 'Nova ordem de serviço'} onClose={() => setOpen(false)} wide>
          <div className="space-y-5">
            {formError && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{formError}</div>}
            {editing?.sale && (
              <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">
                Faturada na venda <strong>{editing.sale.code}</strong>. Mudanças de valor aqui não alteram a venda já gerada.
              </div>
            )}
            <fieldset disabled={viewing} className="space-y-5 min-w-0">
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Cliente">
                  <CustomerPicker
                    customers={customers}
                    value={header.customer_id}
                    onChange={(id) => setHeader({ ...header, customer_id: id })}
                  />
                </Field>
                <Field label="Status">
                  <select className={inputCls} value={header.status} onChange={(e) => setHeader({ ...header, status: e.target.value as OsStatus })}>
                    {OS_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Data de entrada">
                  <input type="date" className={inputCls} value={header.received_date} onChange={(e) => setHeader({ ...header, received_date: e.target.value })} />
                </Field>
                <Field label="Previsão de entrega" hint="opcional">
                  <input type="date" className={inputCls} value={header.expected_date} onChange={(e) => setHeader({ ...header, expected_date: e.target.value })} />
                </Field>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="label mb-0">Peças do cliente ({items.length})</span>
                  <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={() => setItems((p) => [...p, newItem()])}><Plus size={14} /> Adicionar peça</button>
                </div>
                <div className="space-y-3">
                  {items.map((it, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/40">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400 w-6">#{idx + 1}</span>
                        <input className={`${inputCls} flex-1`} placeholder="Descrição da peça (ex.: Fonte Excelitas)" value={it.description} onChange={(e) => updateItem(idx, { description: e.target.value })} />
                        <select className={`${inputCls} w-40 text-xs`} value={it.item_status} onChange={(e) => updateItem(idx, { item_status: e.target.value })}>
                          {ITEM_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <button type="button" className="icon-btn" title="Duplicar (mesma peça, outro nº de série)" onClick={() => duplicateItem(idx)}><Copy size={15} /></button>
                        <button type="button" className="icon-btn hover:text-red-600" title="Remover" onClick={() => removeItem(idx)}><X size={15} /></button>
                      </div>
                      <div className="grid sm:grid-cols-3 gap-3">
                        <Field label="Modelo do cadastro" hint="opcional">
                          <select className={`${inputCls} text-xs`} value={it.part_id} onChange={(e) => pickPart(idx, e.target.value)}>
                            <option value="">—</option>
                            {parts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.brand?.trim() ? ` — ${p.brand.trim()}` : ''}</option>)}
                          </select>
                        </Field>
                        <Field label="Nº de série">
                          <input className={inputCls} value={it.serial_number} onChange={(e) => updateItem(idx, { serial_number: e.target.value })} />
                        </Field>
                        <Field label="Técnico / fornecedor do reparo" hint="opcional">
                          <select className={`${inputCls} text-xs`} value={it.supplier_id} onChange={(e) => updateItem(idx, { supplier_id: e.target.value })}>
                            <option value="">Interno / não definido</option>
                            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </Field>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-3">
                        <Field label="Defeito relatado">
                          <input className={inputCls} value={it.reported_defect} onChange={(e) => updateItem(idx, { reported_defect: e.target.value })} />
                        </Field>
                        <Field label="Diagnóstico / serviço feito">
                          <input className={inputCls} value={it.diagnosis} onChange={(e) => updateItem(idx, { diagnosis: e.target.value })} />
                        </Field>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Field label="Custo (R$)" hint="o que pagamos">
                          <input type="number" step="0.01" min={0} className={inputCls} value={it.cost || ''} onChange={(e) => updateItem(idx, { cost: Number(e.target.value) })} />
                        </Field>
                        <Field label="Preço (R$)" hint="cobrado do cliente">
                          <input type="number" step="0.01" min={0} className={inputCls} value={it.price || ''} onChange={(e) => updateItem(idx, { price: Number(e.target.value) })} />
                        </Field>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-sm">
                    <div className="text-xs text-slate-400 font-semibold uppercase">Custo total</div>
                    <div className="font-semibold text-slate-700">{BRL(formTotals.cost)}</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-sm">
                    <div className="text-xs text-slate-400 font-semibold uppercase">Valor a cobrar</div>
                    <div className="font-semibold text-slate-900">{BRL(formTotals.price)}</div>
                  </div>
                  <div className={`rounded-xl px-4 py-2.5 text-sm ${formTotals.price - formTotals.cost < 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                    <div className={`text-xs font-semibold uppercase ${formTotals.price - formTotals.cost < 0 ? 'text-red-600' : 'text-emerald-600'}`}>Margem</div>
                    <div className={`font-semibold ${formTotals.price - formTotals.cost < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {BRL(formTotals.price - formTotals.cost)}
                      {formTotals.price > 0 && <span className="text-xs font-normal"> ({(((formTotals.price - formTotals.cost) / formTotals.price) * 100).toFixed(1)}%)</span>}
                    </div>
                  </div>
                </div>
              </div>

              <Field label="Observações">
                <textarea className={inputCls} rows={2} value={header.notes} onChange={(e) => setHeader({ ...header, notes: e.target.value })} />
              </Field>
            </fieldset>
            <ViewEditFooter viewing={viewing} saving={saving} onEdit={() => setViewing(false)} onClose={() => setOpen(false)} onSave={save} />
          </div>
        </Modal>
      )}

      {billing && (
        <Modal title={`Faturar ${billing.code}`} onClose={() => setBilling(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Gera a venda de <strong>{customerName(billing.customer_id)}</strong> no valor de <strong>{BRL(totals(billing.service_order_items ?? []).price)}</strong>
              {' '}com as parcelas em Contas a Receber. Não baixa estoque — as peças são do cliente.
            </p>
            {billError && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{billError}</div>}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Data da venda">
                <input type="date" className="input" value={bill.sale_date} onChange={(e) => setBill({ ...bill, sale_date: e.target.value, first_installment_date: bill.first_installment_date === bill.sale_date ? e.target.value : bill.first_installment_date })} />
              </Field>
              <Field label="Forma de pagamento">
                <select className="input" value={bill.payment_method} onChange={(e) => setBill({ ...bill, payment_method: e.target.value })}>
                  <option value="">— Selecione —</option>
                  {SALE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <Field label="Nº de parcelas">
                <input type="number" min={1} className="input" value={bill.installment_count} onChange={(e) => setBill({ ...bill, installment_count: Number(e.target.value) })} />
              </Field>
              <Field label="Intervalo (dias)">
                <input type="number" min={0} className="input" value={bill.installment_interval_days} onChange={(e) => setBill({ ...bill, installment_interval_days: Number(e.target.value) })} />
              </Field>
              <Field label="Primeira parcela">
                <input type="date" className="input" value={bill.first_installment_date} onChange={(e) => setBill({ ...bill, first_installment_date: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setBilling(null)}>Cancelar</button>
              <button className="btn-primary" disabled={billSaving} onClick={confirmBilling}>{billSaving ? 'Gerando...' : 'Gerar venda'}</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Excluir ordem de serviço" onClose={() => setDeleteId(null)}>
          <ConfirmDelete
            message={orders.find((o) => o.id === deleteId)?.sale_id
              ? 'Excluir esta OS? A venda já gerada continua existindo (exclua-a em Vendas, se for o caso).'
              : 'Excluir esta OS e todos os seus itens?'}
            onConfirm={remove}
            onCancel={() => setDeleteId(null)}
          />
        </Modal>
      )}
    </div>
  );
}
