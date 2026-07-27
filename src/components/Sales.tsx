import { useEffect, useMemo, useState, useRef } from 'react';
import { Plus, Pencil, Trash2, Receipt, Search, Paperclip, FileText, X, ExternalLink } from 'lucide-react';
import { supabase, type Sale, type Customer, type SaleFile, type SaleItem, type Part, BRL, formatDate } from '../lib/supabase';
import { Modal, Field, Badge, EmptyState, PageHeader, ConfirmDelete, statusTone } from './ui';
import { useSessionState } from '../lib/useSessionState';

const SALE_STATUS = ['Pendente', 'Em andamento', 'Concluída', 'Cancelada'] as const;

const emptyForm = {
  code: '', customer_id: '', status: 'Pendente',
  sale_date: new Date().toISOString().slice(0, 10),
  currency: 'BRL', total_amount: 0, installment_count: 1, installment_interval_days: 30,
  first_installment_date: new Date().toISOString().slice(0, 10),
  nf_tax: 0, nf_fee: 0, salesperson_commission: 0,
  delivery_fee: 0, delivery_cost: 0, notes: '',
};

type SaleRow = { part_id: string; quantity: number; unit_price: number; serial_number: string };

const inputCls = 'input';

export default function Sales() {
  const [items, setItems] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stockParts, setStockParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [files, setFiles] = useState<SaleFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useSessionState<SaleRow[]>('sale:rows', [{ part_id: '', quantity: 1, unit_price: 0, serial_number: '' }]);
  const [serialsByPart, setSerialsByPart] = useState<Map<string, string[]>>(new Map());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [cRes, pRes, piRes] = await Promise.all([
        supabase.from('customers').select('*').order('name'),
        supabase.from('parts').select('*').order('name'),
        supabase.from('purchase_items').select('part_id, serial_number').not('serial_number', 'is', null).neq('serial_number', ''),
      ]);
      setCustomers((cRes.data as Customer[]) ?? []);
      setStockParts(((pRes.data as Part[]) ?? []).filter((p) => Number(p.stock_quantity) > 0));

      const serialMap = new Map<string, string[]>();
      for (const pi of (piRes.data as any[]) ?? []) {
        if (pi.serial_number && pi.part_id) {
          const arr = serialMap.get(pi.part_id) ?? [];
          if (!arr.includes(pi.serial_number)) arr.push(pi.serial_number);
          serialMap.set(pi.part_id, arr);
        }
      }
      setSerialsByPart(serialMap);

      let sRes = await supabase.from('sales').select('*, customer(*)').order('sale_date', { ascending: false });
      if (sRes.error && /relationship.*schema cache/i.test(sRes.error.message)) {
        sRes = await supabase.from('sales').select('*').order('sale_date', { ascending: false });
      }
      if (sRes.error) setError(sRes.error.message);
      const sales = (sRes.data as Sale[]) ?? [];
      if (sales.length && !sales[0].customer && (cRes.data as Customer[])) {
        const custMap = new Map((cRes.data as Customer[]).map((c) => [c.id, c]));
        sales.forEach((s) => { s.customer = (s.customer_id && custMap.get(s.customer_id)) || null; });
      }
      setItems(sales);
    } catch (err: any) {
      setError(err?.message ?? 'Falha ao carregar vendas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) =>
      s.customer?.name.toLowerCase().includes(q) ||
      s.status.toLowerCase().includes(q)
    );
  }, [items, query]);

  const computedTotal = useMemo(
    () => rows.reduce((sum, r) => sum + (r.part_id ? r.quantity * r.unit_price : 0), 0),
    [rows]
  );

  const updateRow = (i: number, patch: Partial<SaleRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, { part_id: '', quantity: 1, unit_price: 0, serial_number: '' }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const openNew = () => {
    setEditing(null);
    const today = new Date().toISOString().slice(0, 10);
    setForm({ ...emptyForm, sale_date: today, first_installment_date: today });
    setRows([{ part_id: '', quantity: 1, unit_price: 0, serial_number: '' }]);
    setFiles([]);
    setError(''); setOpen(true);
  };

  const openEdit = async (s: Sale) => {
    setEditing(s);
    setForm({
      code: s.code, customer_id: s.customer_id ?? '', status: s.status,
      sale_date: s.sale_date, currency: s.currency, total_amount: Number(s.total_amount) || 0,
      installment_count: s.installment_count, installment_interval_days: s.installment_interval_days,
      first_installment_date: s.first_installment_date ?? s.sale_date,
      nf_tax: Number(s.nf_tax) || 0, nf_fee: Number(s.nf_fee) || 0,
      salesperson_commission: Number(s.salesperson_commission) || 0,
      delivery_fee: Number(s.delivery_fee) || 0, delivery_cost: Number(s.delivery_cost) || 0,
      notes: s.notes ?? '',
    });
    const { data: fileData } = await supabase.from('sale_files').select('*').eq('sale_id', s.id).order('created_at');
    setFiles((fileData as SaleFile[]) ?? []);
    const { data: si } = await supabase.from('sale_items').select('*').eq('sale_id', s.id);
    const itemRows = ((si as SaleItem[]) ?? []).map((r) => ({
      part_id: r.part_id, quantity: Number(r.quantity), unit_price: Number(r.unit_price),
      serial_number: r.serial_number ?? '',
    }));
    setRows(itemRows.length > 0 ? itemRows : [{ part_id: '', quantity: 1, unit_price: 0, serial_number: '' }]);
    setError(''); setOpen(true);
  };

  const uploadFile = async (file: File) => {
    if (!editing) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${editing.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('sale-files').upload(path, file);
      if (upErr) { setError(upErr.message); return; }
      const { data: pubData } = supabase.storage.from('sale-files').getPublicUrl(path);
      const { data: rec, error: dbErr } = await supabase.from('sale_files').insert({
        sale_id: editing.id,
        file_name: file.name,
        file_url: pubData.publicUrl,
        content_type: file.type,
        file_size: file.size,
      }).select('*').single();
      if (dbErr) { setError(dbErr.message); return; }
      setFiles((prev) => [...prev, rec as SaleFile]);
    } catch (err: any) {
      setError(err?.message ?? 'Falha ao enviar arquivo.');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (f: SaleFile) => {
    const path = f.file_url.split('/sale-files/')[1];
    if (path) await supabase.storage.from('sale-files').remove([path]);
    await supabase.from('sale_files').delete().eq('id', f.id);
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
  };

  const save = async () => {
    setError('');
    const validRows = rows.filter((r) => r.part_id);
    if (validRows.length === 0) { setError('Adicione ao menos uma peça à venda.'); return; }
    if (!form.customer_id) { setError('Selecione um cliente.'); return; }
    setSaving(true);
    try {
      const total = validRows.reduce((s, r) => s + r.quantity * r.unit_price, 0);
      const payload = {
        customer_id: form.customer_id || null,
        status: form.status,
        sale_date: form.sale_date,
        currency: form.currency,
        total_amount: total,
        installment_count: Number(form.installment_count),
        installment_interval_days: Number(form.installment_interval_days),
        first_installment_date: form.installment_count > 1 ? (form.first_installment_date || null) : null,
        nf_tax: Number(form.nf_tax),
        nf_fee: Number(form.nf_fee),
        salesperson_commission: Number(form.salesperson_commission),
        delivery_fee: Number(form.delivery_fee),
        delivery_cost: Number(form.delivery_cost),
        notes: form.notes || null,
      };
      let saleId = editing?.id;
      let err;
      if (editing) {
        ({ error: err } = await supabase.from('sales').update(payload).eq('id', editing.id));
      } else {
        const { data: existing } = await supabase.from('sales').select('code');
        const maxNum = (existing ?? []).reduce((max, s: any) => {
          const m = (s.code as string).match(/(\d+)$/);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        const finalCode = `VEND-${String(maxNum + 1).padStart(4, '0')}`;
        const { data: ins, error: ie } = await supabase.from('sales').insert({ ...payload, code: finalCode }).select('id').single();
        err = ie;
        if (ins) saleId = (ins as any).id;
      }
      if (err) { setError(err.message); return; }

      // Save sale items + decrement stock
      if (saleId) {
        await supabase.from('sale_items').delete().eq('sale_id', saleId);
        for (const r of validRows) {
          const part = stockParts.find((p) => p.id === r.part_id);
          const unitCost = part ? Number(part.unit_cost) : 0;
          const { error: ie2 } = await supabase.from('sale_items').insert({
            sale_id: saleId, part_id: r.part_id, quantity: r.quantity,
            unit_price: r.unit_price, unit_cost: unitCost,
            serial_number: r.serial_number || null,
          });
          if (ie2) { setError(ie2.message); return; }
          // Decrement stock
          if (part) {
            const newStock = Math.max(0, Number(part.stock_quantity) - r.quantity);
            await supabase.from('parts').update({ stock_quantity: newStock }).eq('id', r.part_id);
          }
        }
      }
      setOpen(false);
    } catch (err: any) {
      setError(err?.message ?? 'Falha ao salvar a venda.');
      return;
    } finally {
      setSaving(false);
      await load();
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    await supabase.from('sales').delete().eq('id', deleteId);
    setDeleteId(null); load();
  };

  const statusLabel = (s: string) => s;

  const netCalc = () => {
    const t = computedTotal;
    const fee = Number(form.delivery_fee) || 0;
    const cost = Number(form.delivery_cost) || 0;
    const ded = t * (Number(form.nf_tax) + Number(form.nf_fee) + Number(form.salesperson_commission)) / 100;
    return { gross: t + fee, ded, cost, net: t + fee - ded - cost };
  };

  return (
    <div>
      <PageHeader
        title="Vendas"
        subtitle={`${items.length} vendas registradas`}
        action={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Nova venda</button>}
      />

      <div className="card p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input className="input pl-10" placeholder="Buscar por cliente ou status..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{error}</div>}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Receipt} title="Nenhuma venda encontrada" subtitle="Registre vendas para acompanhar a receita." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Cliente</th>
                  <th className="th">Data</th>
                  <th className="th">Parcelas</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Líquido</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => {
                  const t = Number(s.total_amount) + Number(s.delivery_fee || 0);
                  const ded = t * (Number(s.nf_tax) + Number(s.nf_fee) + Number(s.salesperson_commission)) / 100;
                  const net = t - ded - Number(s.delivery_cost || 0);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/50 transition">
                      <td className="td font-medium text-slate-900">{s.customer?.name ?? '—'}</td>
                      <td className="td text-slate-500">{formatDate(s.sale_date)}</td>
                      <td className="td text-slate-600">{s.installment_count}x</td>
                      <td className="td"><Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge></td>
                      <td className="td text-right font-semibold text-slate-900">{BRL(t)}</td>
                      <td className="td text-right text-slate-600">{BRL(net)}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button className="icon-btn" onClick={() => openEdit(s)}><Pencil size={15} /></button>
                          <button className="icon-btn hover:text-red-600" onClick={() => setDeleteId(s.id)}><Trash2 size={15} /></button>
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
        <Modal title={editing ? 'Editar venda' : 'Nova venda'} onClose={() => setOpen(false)} wide>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Cliente">
                <select className={inputCls} value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                  <option value="">— Selecione —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Data"><input type="date" className={inputCls} value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} /></Field>
              <Field label="Status">
                <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {SALE_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>

            {/* Peças */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="label mb-0">Peças vendidas</span>
                <button type="button" className="btn-ghost text-xs px-2 py-1" onClick={addRow}><Plus size={14} /> Adicionar peça</button>
              </div>
              <div className="space-y-2">
                {rows.map((r, i) => {
                  const part = stockParts.find((p) => p.id === r.part_id);
                  const available = part ? Number(part.stock_quantity) : 0;
                  const partSerials = part ? (serialsByPart.get(part.id) ?? []) : [];
                  return (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <select
                        className={`${inputCls} col-span-4`}
                        value={r.part_id}
                        onChange={(e) => {
                          const p = stockParts.find((x) => x.id === e.target.value);
                          updateRow(i, { part_id: e.target.value, unit_price: p ? Number(p.unit_price) : 0, serial_number: '' });
                        }}
                      >
                        <option value="">— Selecione —</option>
                        {stockParts.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({Number(p.stock_quantity)} em estoque)</option>
                        ))}
                      </select>
                      <input
                        type="number" min={1} max={available || undefined} placeholder="Qtd"
                        className={`${inputCls} col-span-1 text-center`}
                        value={r.quantity}
                        onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })}
                      />
                      <input
                        type="number" step="0.01" placeholder="Preço unit."
                        className={`${inputCls} col-span-2 text-right`}
                        value={r.unit_price}
                        onChange={(e) => updateRow(i, { unit_price: Number(e.target.value) })}
                      />
                      <input
                        type="text" list={`serials-${i}`} placeholder="Nº Série/Lote (opc.)"
                        className={`${inputCls} col-span-4 text-xs`}
                        value={r.serial_number}
                        onChange={(e) => updateRow(i, { serial_number: e.target.value })}
                      />
                      <datalist id={`serials-${i}`}>
                        {partSerials.map((s) => <option key={s} value={s} />)}
                      </datalist>
                      <button type="button" className="col-span-1 icon-btn hover:text-red-600 justify-self-center" onClick={() => removeRow(i)}>
                        <X size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {stockParts.length === 0 && (
                <p className="text-xs text-amber-600 mt-2">Nenhuma peça em estoque. Registre compras para ter peças disponíveis.</p>
              )}
              {computedTotal > 0 && (() => {
                const totalCost = rows.reduce((s, r) => {
                  const p = stockParts.find((x) => x.id === r.part_id);
                  return s + (p ? Number(p.unit_cost) * r.quantity : 0);
                }, 0);
                const revenue = computedTotal;
                const margin = revenue - totalCost;
                const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
                return (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-sm">
                      <div className="text-xs text-slate-400 font-semibold uppercase">Custo total</div>
                      <div className="font-semibold text-slate-700">{BRL(totalCost)}</div>
                    </div>
                    <div className="bg-slate-50 rounded-xl px-4 py-2.5 text-sm">
                      <div className="text-xs text-slate-400 font-semibold uppercase">Receita total</div>
                      <div className="font-semibold text-slate-900">{BRL(revenue)}</div>
                    </div>
                    <div className="bg-emerald-50 rounded-xl px-4 py-2.5 text-sm">
                      <div className="text-xs text-emerald-500 font-semibold uppercase">Margem</div>
                      <div className="font-semibold text-emerald-700">{BRL(margin)} ({marginPct.toFixed(1)}%)</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Taxa entrega (R$)" hint="cliente paga">
                <input type="number" step="0.01" className={inputCls} value={form.delivery_fee} onChange={(e) => setForm({ ...form, delivery_fee: Number(e.target.value) })} />
              </Field>
              <Field label="Custo entrega (R$)" hint="nós pagamos">
                <input type="number" step="0.01" className={inputCls} value={form.delivery_cost} onChange={(e) => setForm({ ...form, delivery_cost: Number(e.target.value) })} />
              </Field>
            </div>

            {/* Parcelamento */}
            <div className="border-t border-slate-200 pt-4">
              <span className="label">Parcelamento</span>
              <div className="grid sm:grid-cols-3 gap-4 mt-1">
                <Field label="Nº de parcelas"><input type="number" min={1} className={inputCls} value={form.installment_count} onChange={(e) => setForm({ ...form, installment_count: Number(e.target.value) })} /></Field>
                <Field label="Intervalo (dias)"><input type="number" min={1} className={inputCls} value={form.installment_interval_days} onChange={(e) => setForm({ ...form, installment_interval_days: Number(e.target.value) })} /></Field>
                <Field label="Primeira parcela" hint={form.installment_count > 1 ? 'vencimento' : 'avista'}>
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

            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Imposto NF (%)"><input type="number" step="0.01" className={inputCls} value={form.nf_tax} onChange={(e) => setForm({ ...form, nf_tax: Number(e.target.value) })} /></Field>
              <Field label="Taxa NF (%)"><input type="number" step="0.01" className={inputCls} value={form.nf_fee} onChange={(e) => setForm({ ...form, nf_fee: Number(e.target.value) })} /></Field>
              <Field label="Comissão Vendedor (%)"><input type="number" step="0.01" className={inputCls} value={form.salesperson_commission} onChange={(e) => setForm({ ...form, salesperson_commission: Number(e.target.value) })} /></Field>
            </div>
            {(() => {
              const { gross, ded, cost, net } = netCalc();
              return computedTotal > 0 ? (
                <div className="bg-slate-50 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><div className="text-xs text-slate-400 font-semibold uppercase">Bruto c/ entrega</div><div className="font-semibold text-slate-900">{BRL(gross)}</div></div>
                  <div><div className="text-xs text-slate-400 font-semibold uppercase">Deduções</div><div className="font-semibold text-red-600">- {BRL(ded)}</div></div>
                  <div><div className="text-xs text-slate-400 font-semibold uppercase">Custo entrega</div><div className="font-semibold text-red-600">- {BRL(cost)}</div></div>
                  <div><div className="text-xs text-slate-400 font-semibold uppercase">Líquido</div><div className="font-semibold text-emerald-600">{BRL(net)}</div></div>
                </div>
              ) : null;
            })()}

            {/* File attachments */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Anexos (NFs, comprovantes)</span>
                {editing && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700 disabled:opacity-50"
                  >
                    <Paperclip size={14} /> {uploading ? 'Enviando...' : 'Anexar arquivo'}
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const selected = Array.from(e.target.files ?? []);
                  selected.forEach(uploadFile);
                  e.target.value = '';
                }}
              />
              {!editing && (
                <p className="text-xs text-slate-400">Salve a venda primeiro para poder anexar arquivos.</p>
              )}
              {files.length > 0 ? (
                <div className="space-y-2">
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                      <FileText size={16} className="text-slate-400 shrink-0" />
                      <a href={f.file_url} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-700 hover:text-sky-600 hover:underline truncate flex items-center gap-1">
                        {f.file_name} <ExternalLink size={11} className="inline" />
                      </a>
                      <span className="text-xs text-slate-400 ml-auto shrink-0">
                        {f.file_size ? `${(f.file_size / 1024).toFixed(0)} KB` : ''}
                      </span>
                      <button type="button" onClick={() => removeFile(f)} className="text-slate-400 hover:text-red-600 shrink-0">
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : editing ? (
                <p className="text-xs text-slate-400">Nenhum arquivo anexado.</p>
              ) : null}
            </div>

            <Field label="Observações"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Excluir venda" onClose={() => setDeleteId(null)}>
          <ConfirmDelete message="Excluir esta venda?" onConfirm={remove} onCancel={() => setDeleteId(null)} />
        </Modal>
      )}
    </div>
  );
}
