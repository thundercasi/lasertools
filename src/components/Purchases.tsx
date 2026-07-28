import { Fragment, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ShoppingCart, Search, Plane, CheckCircle2, X as XIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase, type Purchase, type Supplier, type Part, type PurchaseItem, money, BRL, formatDate } from '../lib/supabase';
import { useSessionState } from '../lib/useSessionState';
import { Modal, Field, Badge, EmptyState, PageHeader, ConfirmDelete, statusTone } from './ui';

type ItemRow = { part_id: string; quantity: number; unit_cost: number; serial_number: string };
const inputCls = 'input';

const PAYMENT_METHODS = ['PIX', 'Cartão', 'Boleto'] as const;
type PaymentMethod = typeof PAYMENT_METHODS[number];

const PAYMENT_STATUS = ['Pendente', 'Concluída'] as const;
type PaymentStatus = typeof PAYMENT_STATUS[number];

const PURCHASE_STATUS = ['Pendente', 'Aguardando Entrega', 'Concluída'] as const;
type PurchaseStatus = typeof PURCHASE_STATUS[number];

const emptyForm = {
  code: '', supplier_id: '', is_import: false, currency: 'BRL', exchange_rate: 1,
  iof_percent: 0, iof_value: 0, rate_confirmed: true,
  status: 'Pendente' as PurchaseStatus, payment_status: 'Pendente' as PaymentStatus,
  purchase_date: new Date().toISOString().slice(0, 10), notes: '',
  payment_method: 'PIX' as PaymentMethod, first_installment_date: '',
  installment_count: 1, installment_interval_days: 30,
  freight: 0, other_expenses: 0, import_tax: 0,
};

export default function Purchases() {
  const [items, setItems] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [form, setForm] = useSessionState('purchase:form', emptyForm);
  const [rows, setRows] = useSessionState<ItemRow[]>('purchase:rows', [{ part_id: '', quantity: 1, unit_cost: 0, serial_number: '' }]);
  const [open, setOpen] = useSessionState('purchase:open', false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Record<string, PurchaseItem[]>>({});
  const [expandedLoading, setExpandedLoading] = useState<string | null>(null);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!expandedItems[id]) {
      setExpandedLoading(id);
      const { data } = await supabase.from('purchase_items').select('*, part:part_id(*)').eq('purchase_id', id);
      setExpandedItems((prev) => ({ ...prev, [id]: (data as any) ?? [] }));
      setExpandedLoading(null);
    }
  };

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [sRes, ptRes] = await Promise.all([
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('parts').select('*').order('name'),
      ]);
      setSuppliers((sRes.data as Supplier[]) ?? []);
      setParts((ptRes.data as Part[]) ?? []);

      // Try the nested relation first; fall back to a flat query if the
      // PostgREST schema cache hasn't picked up the foreign key yet.
      let pRes = await supabase.from('purchases').select('*, supplier(*)').order('purchase_date', { ascending: false });
      if (pRes.error && /relationship.*schema cache/i.test(pRes.error.message)) {
        pRes = await supabase.from('purchases').select('*').order('purchase_date', { ascending: false });
      }
      if (pRes.error) setLoadError(pRes.error.message);
      const purchases = (pRes.data as Purchase[]) ?? [];
      // When the nested relation is unavailable, join supplier manually.
      if (purchases.length && !purchases[0].supplier && (sRes.data as Supplier[])) {
        const supMap = new Map((sRes.data as Supplier[]).map((s) => [s.id, s]));
        purchases.forEach((p) => { p.supplier = (p.supplier_id && supMap.get(p.supplier_id)) || null; });
      }
      setItems(purchases);
    } catch (err: any) {
      setLoadError(err?.message ?? 'Falha ao carregar compras.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (open && !editing) {
      const maxNum = items.reduce((max, p) => {
        const m = p.code.match(/(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      setForm((f) => ({ ...f, code: `COMP-${String(maxNum + 1).padStart(4, '0')}` }));
    }
  }, [items, open, editing]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) =>
      (p.supplier?.name ?? '').toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q)
    );
  }, [items, query]);

  const computedTotal = useMemo(
    () => rows.reduce((sum, r) => sum + r.quantity * r.unit_cost, 0),
    [rows]
  );

  const openNew = () => {
    const maxNum = items.reduce((max, p) => {
      const m = p.code.match(/(\d+)$/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    setEditing(null);
    setForm({ ...emptyForm, code: `COMP-${String(maxNum + 1).padStart(4, '0')}`, rate_confirmed: true, first_installment_date: emptyForm.purchase_date });
    setRows([{ part_id: '', quantity: 1, unit_cost: 0, serial_number: '' }]);
    setError(''); setOpen(true);
  };

  const closeForm = () => {
    setOpen(false);
    setForm(emptyForm);
    setRows([{ part_id: '', quantity: 1, unit_cost: 0, serial_number: '' }]);
  };

  const openEdit = async (p: Purchase) => {
    setEditing(p);
    setForm({
      code: p.code, supplier_id: p.supplier_id ?? '', is_import: p.is_import,
      currency: p.currency, exchange_rate: p.currency === 'BRL' ? 1 : (Number(p.exchange_rate) || 1),
      iof_percent: 0, iof_value: Number(p.iof) || 0,
      rate_confirmed: p.rate_confirmed, status: p.status as PurchaseStatus,
      payment_status: (PAYMENT_STATUS.includes(p.payment_status as PaymentStatus) ? p.payment_status : 'Pendente') as PaymentStatus,
      purchase_date: p.purchase_date, notes: p.notes ?? '',
      payment_method: (PAYMENT_METHODS.includes(p.payment_method as PaymentMethod) ? p.payment_method : 'PIX') as PaymentMethod,
      first_installment_date: p.first_installment_date ?? '',
      installment_count: Number(p.installment_count) || 1,
      installment_interval_days: Number(p.installment_interval_days) || 30,
      freight: Number(p.freight) || 0,
      other_expenses: Number(p.other_expenses) || 0,
      import_tax: Number(p.import_tax) || 0,
    });
    const { data: pi } = await supabase.from('purchase_items').select('*').eq('purchase_id', p.id);
    setRows((pi ?? []).map((r: any) => ({
      // unit_cost stays the raw value the user typed, in the purchase's own
      // currency — unit_cost_total (R$, apportioned) is not editable here,
      // it's recomputed on save from the current form values.
      part_id: r.part_id, quantity: Number(r.quantity), unit_cost: Number(r.unit_cost),
      serial_number: r.serial_number ?? '',
    })));
    if (!pi || pi.length === 0) setRows([{ part_id: '', quantity: 1, unit_cost: 0, serial_number: '' }]);
    setError(''); setOpen(true);
  };

  const updateRow = (i: number, patch: Partial<ItemRow>) => {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const addRow = () => setRows((prev) => [...prev, { part_id: '', quantity: 1, unit_cost: 0, serial_number: '' }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const setCurrency = (c: string) => {
    const isBRL = c === 'BRL';
    setForm((f) => ({
      ...f, currency: c,
      exchange_rate: isBRL ? 1 : f.exchange_rate,
      rate_confirmed: isBRL ? true : f.rate_confirmed,
    }));
  };

  const setIsImport = (checked: boolean) => {
    setForm((f) => ({
      ...f,
      is_import: checked,
      rate_confirmed: checked ? f.rate_confirmed : true,
    }));
  };

  const setIofValue = (v: number) => setForm((f) => ({ ...f, iof_value: v }));

  const freight = Number(form.freight) || 0;
  const otherExpenses = Number(form.other_expenses) || 0;
  // Import tax is always entered in R$ and is never converted — it's added
  // at the very end, on top of the BRL-converted subtotal.
  const importTax = !form.is_import ? 0 : (Number(form.import_tax) || 0);
  const exchangeRate = Number(form.exchange_rate) || 1;
  const toBRL = (v: number) => (form.currency === 'USD' ? v * exchangeRate : v);

  const itemsTotal = computedTotal; // in form.currency
  const foreignExtras = freight + otherExpenses; // in form.currency
  const subtotalBRL = toBRL(itemsTotal + foreignExtras);
  // Total geral is always expressed in R$, since the import tax can never
  // be converted and everything else must be brought to the same currency
  // before summing.
  const grandTotal = subtotalBRL + importTax;
  const extraCostsBRL = toBRL(foreignExtras) + importTax;

  const save = async () => {
    setError('');
    const validRows = rows.filter((r) => r.part_id);
    if (validRows.length === 0) { setError('Adicione ao menos uma peça à compra.'); return; }
    setSaving(true);

    try {
      const payload = {
        supplier_id: form.supplier_id || null,
        is_import: form.is_import,
        currency: form.currency,
        exchange_rate: Number(form.exchange_rate),
        iof: Number(form.iof_value),
        rate_confirmed: form.currency === 'BRL' ? true : form.rate_confirmed,
        status: form.status,
        payment_status: form.payment_status,
        purchase_date: form.purchase_date,
        total_amount: grandTotal,
        freight: freight,
        other_expenses: otherExpenses,
        import_tax: importTax,
        payment_method: form.payment_method,
        installment_count: Number(form.installment_count) || 1,
        installment_interval_days: Number(form.installment_interval_days) || 30,
        first_installment_date: Number(form.installment_count) > 1 ? (form.first_installment_date || null) : null,
        notes: form.notes || null,
      };

      // Working snapshot of stock/cost per part, so we can (a) reverse the
      // previous version of this purchase exactly and (b) apply several
      // rows of the same part in one purchase without reading stale data.
      const workingParts = new Map(parts.map((p) => [p.id, { stock: Number(p.stock_quantity), cost: Number(p.unit_cost) }]));

      let purchaseId = editing?.id;
      if (editing) {
        const { error: e } = await supabase.from('purchases').update(payload).eq('id', editing.id);
        if (e) { setError(e.message); return; }

        // Reverse the stock/cost impact of the OLD items of this purchase
        // before deleting them, so editing never double-counts quantity.
        const { data: oldItems } = await supabase.from('purchase_items').select('*').eq('purchase_id', editing.id);
        for (const oi of (oldItems ?? []) as any[]) {
          const w = workingParts.get(oi.part_id);
          if (!w) continue;
          const oldQty = Number(oi.quantity);
          const oldCostTotal = Number(oi.unit_cost_total) || Number(oi.unit_cost) || 0;
          const newStock = w.stock - oldQty;
          let newCost = w.cost;
          if (newStock > 0) {
            const backedOut = (w.stock * w.cost) - (oldQty * oldCostTotal);
            newCost = backedOut > 0 ? backedOut / newStock : w.cost;
          }
          workingParts.set(oi.part_id, { stock: Math.max(newStock, 0), cost: newCost });
        }

        await supabase.from('purchase_items').delete().eq('purchase_id', editing.id);
      } else {
        const { data: existing } = await supabase.from('purchases').select('code');
        const maxNum = (existing ?? []).reduce((max, p: any) => {
          const m = (p.code as string).match(/(\d+)$/);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        const finalCode = `COMP-${String(maxNum + 1).padStart(4, '0')}`;
        const { data, error: e } = await supabase.from('purchases').insert({ ...payload, code: finalCode }).select('id').single();
        if (e) { setError(e.message); return; }
        purchaseId = (data as any).id;
      }

      // Apportion extra costs (freight + other expenses + import tax, all
      // already in BRL) proportionally to each item, based on its BRL value.
      const itemsTotalBRL = toBRL(itemsTotal);
      const itemPayload = validRows.map((r) => {
        const unitCostBRL = toBRL(r.unit_cost);
        const proportion = itemsTotalBRL > 0 ? (r.quantity * unitCostBRL) / itemsTotalBRL : 0;
        const extraPerUnitBRL = r.quantity > 0 ? (extraCostsBRL * proportion) / r.quantity : 0;
        return {
          purchase_id: purchaseId, part_id: r.part_id,
          quantity: Number(r.quantity),
          unit_cost: Number(r.unit_cost),               // raw entered cost, in the purchase currency
          unit_cost_total: unitCostBRL + extraPerUnitBRL, // apportioned cost in R$ — used for avg stock cost
          serial_number: r.serial_number || null,
        };
      });
      const { error: ie } = await supabase.from('purchase_items').insert(itemPayload);
      if (ie) { setError(ie.message); return; }

      // Apply the new items on top of the (already reversed, if editing) stock/cost.
      for (const r of itemPayload) {
        const w = workingParts.get(r.part_id) ?? { stock: 0, cost: 0 };
        const newQty = Number(r.quantity);
        const newCost = Number(r.unit_cost_total); // already in R$
        const totalQty = w.stock + newQty;
        const avgCost = totalQty > 0 ? (w.stock * w.cost + newQty * newCost) / totalQty : newCost;
        workingParts.set(r.part_id, { stock: totalQty, cost: avgCost });
      }

      // Persist only the parts whose stock or cost actually changed.
      for (const [partId, w] of workingParts) {
        const original = parts.find((p) => p.id === partId);
        if (!original) continue;
        if (w.stock !== Number(original.stock_quantity) || w.cost !== Number(original.unit_cost)) {
          await supabase.from('parts').update({
            stock_quantity: w.stock,
            unit_cost: w.cost,
            purchase_date: form.purchase_date,
          }).eq('id', partId);
        }
      }

      closeForm();
    } catch (err: any) {
      setError(err?.message ?? 'Falha ao salvar a compra.');
      return;
    } finally {
      setSaving(false);
      await load();
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    await supabase.from('purchases').delete().eq('id', deleteId);
    setDeleteId(null); load();
  };

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { pending: 'Pendente', 'Aguardando Entrega': 'Aguardando Entrega', completed: 'Concluída', Concluída: 'Concluída', cancelled: 'Cancelada', in_progress: 'Em andamento', Pendente: 'Pendente' };
    return map[s] ?? s;
  };

  return (
    <div>
      <PageHeader
        title="Compras"
        subtitle={`${items.length} compras registradas`}
        action={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Nova compra</button>}
      />

      <div className="card p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input className="input pl-10" placeholder="Buscar por código, fornecedor ou status..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {loadError && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{loadError}</div>}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Nenhuma compra encontrada" subtitle="Registre compras para controlar custos e estoque." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th w-8"></th>
                  <th className="th">Fornecedor</th>
                  <th className="th">Data</th>
                  <th className="th">Pagamento</th>
                  <th className="th">Status Compra</th>
                  <th className="th">Status Pgto</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="hover:bg-slate-50/50 transition cursor-pointer" onClick={() => toggleExpand(p.id)}>
                      <td className="td text-slate-400">
                        {expandedId === p.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          {p.is_import && <Plane size={14} className="text-sky-500" />}
                          <span className="font-medium text-slate-900">{p.supplier?.name ?? '—'}</span>
                        </div>
                      </td>
                      <td className="td text-slate-500">{formatDate(p.purchase_date)}</td>
                      <td className="td text-slate-600">{p.payment_method}</td>
                      <td className="td"><Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge></td>
                      <td className="td">
                        <Badge tone={p.payment_status === 'Concluída' ? 'green' : p.payment_status === 'Aguardando Entrega' ? 'blue' : 'amber'}>{p.payment_status}</Badge>
                        {p.installment_count > 1 && <span className="ml-1.5 text-xs text-slate-400">{p.installment_count}x</span>}
                      </td>
                      <td className="td text-right font-semibold text-slate-900">{BRL(Number(p.total_amount))}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <button className="icon-btn" onClick={() => openEdit(p)}><Pencil size={15} /></button>
                          <button className="icon-btn hover:text-red-600" onClick={() => setDeleteId(p.id)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === p.id && (
                      <tr key={`${p.id}-expanded`} className="bg-slate-50/60">
                        <td></td>
                        <td colSpan={7} className="px-5 py-3">
                          {expandedLoading === p.id ? (
                            <div className="text-xs text-slate-400 py-2">Carregando peças...</div>
                          ) : (expandedItems[p.id]?.length ?? 0) === 0 ? (
                            <div className="text-xs text-slate-400 py-2">Nenhuma peça associada a esta compra.</div>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-slate-400">
                                  <th className="text-left font-medium py-1.5">Peça</th>
                                  <th className="text-left font-medium py-1.5">Marca</th>
                                  <th className="text-right font-medium py-1.5">Qtd</th>
                                  <th className="text-right font-medium py-1.5">Custo Unit.</th>
                                  <th className="text-right font-medium py-1.5">Subtotal</th>
                                  <th className="text-left font-medium py-1.5">Nº Série</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200/70">
                                {expandedItems[p.id].map((it) => (
                                  <tr key={it.id}>
                                    <td className="py-1.5 font-medium text-slate-800">{it.part?.name ?? '—'}</td>
                                    <td className="py-1.5 text-slate-500">{it.part?.brand || '—'}</td>
                                    <td className="py-1.5 text-right text-slate-600">{it.quantity}</td>
                                    <td className="py-1.5 text-right text-slate-600">{money(Number(it.unit_cost), p.currency)}</td>
                                    <td className="py-1.5 text-right font-medium text-slate-800">{money(Number(it.unit_cost) * Number(it.quantity), p.currency)}</td>
                                    <td className="py-1.5 text-slate-500">{it.serial_number || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <Modal title={editing ? 'Editar compra' : 'Nova compra'} onClose={closeForm} wide>
          <div className="space-y-5">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}

            {/* Importação — no topo, pois define moeda/câmbio que ajustam os demais campos */}
            <div className="bg-sky-50 rounded-xl p-4 space-y-4">
              <label htmlFor="is_import_check" className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  id="is_import_check"
                  type="checkbox"
                  checked={form.is_import}
                  onChange={(e) => setIsImport(e.target.checked)}
                  className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 cursor-pointer"
                />
                <span className="text-sm font-semibold text-slate-800 inline-flex items-center gap-1.5">
                  <Plane size={14} className="text-sky-500" /> Compra de importação
                </span>
              </label>
              {form.is_import && (
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-3 gap-4">
                    <Field label="Moeda">
                      <select className={inputCls} value={form.currency} onChange={(e) => setCurrency(e.target.value)}>
                        <option value="BRL">BRL (R$)</option>
                        <option value="USD">USD ($)</option>
                      </select>
                    </Field>
                    <Field label="Taxa de câmbio" hint={form.currency === 'BRL' ? '(não se aplica)' : ''}>
                      <input type="number" step="0.0001" className={inputCls} value={form.exchange_rate} disabled={form.currency === 'BRL'} onChange={(e) => setForm({ ...form, exchange_rate: Number(e.target.value) })} />
                    </Field>
                    <div className="flex items-end">
                      <label className={`flex items-center gap-2.5 ${form.currency === 'BRL' ? 'cursor-default' : 'cursor-pointer'} pb-2.5`}>
                        <input
                          type="checkbox"
                          checked={form.rate_confirmed}
                          disabled={form.currency === 'BRL'}
                          onChange={(e) => setForm({ ...form, rate_confirmed: e.target.checked })}
                          className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                        />
                        <span className="text-sm text-slate-700 inline-flex items-center gap-1">
                          <CheckCircle2 size={14} className={form.rate_confirmed ? 'text-emerald-500' : 'text-slate-400'} />
                          Taxa confirmada{form.currency === 'BRL' && ' (fixa p/ BRL)'}
                        </span>
                      </label>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Valor IOF" hint={form.currency === 'BRL' ? '(rateio sem conversão de câmbio)' : ''}>
                      <input
                        type="number" step="0.01"
                        className={inputCls}
                        value={form.iof_value}
                        onChange={(e) => setIofValue(Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Taxa de importação (valor fixo, R$)" hint="compõe o custo total">
                      <input
                        type="number" step="0.01"
                        className={inputCls}
                        value={form.import_tax}
                        onChange={(e) => setForm({ ...form, import_tax: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Fornecedor">
                <select className={inputCls} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                  <option value="">— Selecione —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Data"><input type="date" className={inputCls} value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></Field>
              <Field label="Status Compra">
                <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PurchaseStatus })}>
                  {PURCHASE_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Status do pagamento">
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_STATUS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({ ...form, payment_status: s })}
                    className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition ${
                      form.payment_status === s
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >{s}</button>
                ))}
              </div>
            </Field>

            {/* Peças */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="label mb-0">Peças</span>
                <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={addRow}><Plus size={14} /> Adicionar peça</button>
              </div>
              {/* Column headers */}
              <div className="grid grid-cols-12 gap-2 mb-1 px-0.5">
                <span className="col-span-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Peça</span>
                <span className="col-span-1 text-xs font-semibold text-slate-400 uppercase tracking-wide text-center">Qtde</span>
                <span className="col-span-2 text-xs font-semibold text-slate-400 uppercase tracking-wide text-right">Valor unit.</span>
                <span className="col-span-4 text-xs font-semibold text-slate-400 uppercase tracking-wide">Nº Série/Lote</span>
              </div>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      className={`${inputCls} col-span-4`}
                      value={r.part_id}
                      onChange={(e) => {
                        const p = parts.find((x) => x.id === e.target.value);
                        updateRow(i, { part_id: e.target.value, unit_cost: p ? Number(p.unit_cost) : 0 });
                      }}
                    >
                      <option value="">— Selecione —</option>
                      {parts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}
                    </select>
                    <input
                      type="number" min={1} placeholder="Qtd"
                      className={`${inputCls} col-span-1 text-center`}
                      value={r.quantity}
                      onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
                    />
                    <input
                      type="number" step="0.01" placeholder="Custo unit."
                      className={`${inputCls} col-span-2 text-right`}
                      value={r.unit_cost}
                      onChange={(e) => updateRow(i, { unit_cost: Number(e.target.value) })}
                    />
                    <input
                      type="text" placeholder="Nº Série/Lote (opc.)"
                      className={`${inputCls} col-span-4 text-xs`}
                      value={r.serial_number}
                      onChange={(e) => updateRow(i, { serial_number: e.target.value })}
                    />
                    <button type="button" className="col-span-1 icon-btn hover:text-red-600 justify-self-center" onClick={() => removeRow(i)}>
                      <XIcon size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Valor do frete">
                    <input type="number" step="0.01" className={inputCls} value={form.freight} onChange={(e) => setForm({ ...form, freight: Number(e.target.value) })} />
                  </Field>
                  <Field label="Outras despesas">
                    <input type="number" step="0.01" className={inputCls} value={form.other_expenses} onChange={(e) => setForm({ ...form, other_expenses: Number(e.target.value) })} />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-sm space-y-1">
                    <div className="flex justify-between gap-6">
                      <span className="text-slate-500">Itens:</span>
                      <span className="font-semibold text-slate-700">{money(computedTotal, form.currency)}</span>
                    </div>
                    {freight > 0 && (
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Frete:</span>
                        <span className="font-semibold text-slate-700">{money(freight, form.currency)}</span>
                      </div>
                    )}
                    {otherExpenses > 0 && (
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Outras despesas:</span>
                        <span className="font-semibold text-slate-700">{money(otherExpenses, form.currency)}</span>
                      </div>
                    )}
                    {form.currency === 'USD' && (
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Subtotal convertido:</span>
                        <span className="font-semibold text-slate-700">{BRL(subtotalBRL)} <span className="text-slate-400 font-normal">(câmbio {exchangeRate})</span></span>
                      </div>
                    )}
                    {importTax > 0 && (
                      <div className="flex justify-between gap-6">
                        <span className="text-slate-500">Taxa de importação (R$):</span>
                        <span className="font-semibold text-slate-700">{BRL(importTax)}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-6 border-t border-slate-200 pt-1">
                      <span className="text-slate-500 font-semibold">Total geral (R$):</span>
                      <span className="font-bold text-slate-900">{BRL(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Pagamento */}
            <div className="border-t border-slate-200 pt-4">
              <span className="label">Pagamento</span>
              <p className="text-xs text-slate-400 mb-1">Qualquer forma de pagamento pode ser parcelada.</p>
              <div className="grid sm:grid-cols-3 gap-4 mt-1">
                <Field label="Forma de pagamento">
                  <select className={inputCls} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value as PaymentMethod })}>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Nº de parcelas">
                  <input type="number" min={1} className={inputCls} value={form.installment_count} onChange={(e) => setForm({ ...form, installment_count: Number(e.target.value) })} />
                </Field>
                <Field label="Intervalo (dias)">
                  <input type="number" min={1} className={inputCls} value={form.installment_interval_days} onChange={(e) => setForm({ ...form, installment_interval_days: Number(e.target.value) })} />
                </Field>
                <Field label="Data da primeira parcela" hint={form.installment_count > 1 ? 'vencimento' : 'à vista'}>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.first_installment_date}
                    disabled={form.installment_count <= 1}
                    onChange={(e) => setForm({ ...form, first_installment_date: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            <Field label="Observações"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={closeForm}>Cancelar</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Excluir compra" onClose={() => setDeleteId(null)}>
          <ConfirmDelete message="Excluir esta compra?" onConfirm={remove} onCancel={() => setDeleteId(null)} />
        </Modal>
      )}
    </div>
  );
}
