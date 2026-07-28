import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Boxes, Search, AlertTriangle, TrendingUp, BarChart3 } from 'lucide-react';
import { supabase, type Part, type Competitor, type CompetitionPrice, BRL, formatDate } from '../lib/supabase';
import { Modal, Field, Badge, EmptyState, PageHeader, ConfirmDelete, statusTone } from './ui';

const empty = {
  name: '', description: '', category: '', machine_model: '',
  condition: 'Novo', brand: '', stock_quantity: 0, unit_cost: 0,
  unit_price: 0, min_stock: 0,
};

const emptyPrice = {
  competitor_id: '', competitor: '', price: 0, currency: 'BRL',
  observed_at: new Date().toISOString().slice(0, 10), notes: '',
};

const NEW_COMPETITOR = '__new__';

const inputCls = 'input';

type PriceRow = CompetitionPrice & { competitor_ref?: Competitor | null };

export default function Parts() {
  const [parts, setParts] = useState<Part[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Part | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [priceRows, setPriceRows] = useState<PriceRow[]>([]);
  const [editingPrice, setEditingPrice] = useState<PriceRow | null>(null);
  const [priceForm, setPriceForm] = useState(emptyPrice);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceDeleteId, setPriceDeleteId] = useState<string | null>(null);
  const [priceSaving, setPriceSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: compData }] = await Promise.all([
      supabase.from('parts').select('*').order('name'),
      supabase.from('competitors').select('*').order('name'),
    ]);
    if (error) { setError(error.message); } else { setParts(data as Part[]); }
    setCompetitors((compData as Competitor[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.brand ?? '').toLowerCase().includes(q) ||
      (p.category ?? '').toLowerCase().includes(q)
    );
  }, [parts, query]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...empty });
    setPriceRows([]);
    setError('');
    setOpen(true);
  };

  const openEdit = async (p: Part) => {
    setEditing(p);
    setForm({
      name: p.name, description: p.description ?? '',
      category: p.category ?? '', machine_model: p.machine_model ?? '',
      condition: p.condition ?? 'Novo', brand: p.brand ?? '',
      stock_quantity: Number(p.stock_quantity) || 0,
      unit_cost: Number(p.unit_cost) || 0,
      unit_price: Number(p.unit_price) || 0,
      min_stock: Number(p.min_stock) || 0,
    });
    const { data: prices } = await supabase
      .from('competition_prices')
      .select('*, competitor_ref:competitor_id(*)')
      .eq('part_id', p.id)
      .order('observed_at', { ascending: false });
    setPriceRows((prices as PriceRow[]) ?? []);
    setError('');
    setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.name.trim()) {
      setError('Nome é obrigatório.');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      category: form.category || null,
      machine_model: form.machine_model || null,
      condition: form.condition || 'Novo',
      brand: form.brand || null,
      stock_quantity: Number(form.stock_quantity),
      unit_cost: Number(form.unit_cost),
      unit_price: Number(form.unit_price),
      min_stock: Number(form.min_stock),
    };
    let partId = editing?.id;
    let err;
    if (editing) {
      ({ error: err } = await supabase.from('parts').update(payload).eq('id', editing.id));
    } else {
      const maxNum = parts.reduce((max, p) => {
        const m = p.sku.match(/(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      const sku = `PEC-${String(maxNum + 1).padStart(4, '0')}`;
      const { data, error: e2 } = await supabase.from('parts').insert({ ...payload, sku }).select('id').single();
      err = e2;
      if (data) partId = (data as any).id;
      if (!e2 && partId && priceRows.length > 0) {
        const pending = priceRows.map((r) => ({
          part_id: partId,
          competitor_id: r.competitor_id || null,
          competitor: r.competitor,
          price: Number(r.price),
          currency: r.currency,
          observed_at: r.observed_at,
          notes: r.notes || null,
        }));
        await supabase.from('competition_prices').insert(pending);
      }
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    setOpen(false);
    load();
  };

  const remove = async () => {
    if (!deleteId) return;
    await supabase.from('parts').delete().eq('id', deleteId);
    setDeleteId(null);
    load();
  };

  // ===== Competitor prices within part =====
  const openNewPrice = () => {
    setEditingPrice(null);
    setPriceForm({ ...emptyPrice, observed_at: new Date().toISOString().slice(0, 10) });
    setError('');
    setPriceOpen(true);
  };

  const openEditPrice = (pr: PriceRow) => {
    setEditingPrice(pr);
    setPriceForm({
      competitor_id: pr.competitor_id ?? '',
      competitor: pr.competitor ?? '',
      price: Number(pr.price) || 0,
      currency: pr.currency,
      observed_at: pr.observed_at,
      notes: pr.notes ?? '',
    });
    setPriceOpen(true);
  };

  const savePrice = async () => {
    let competitorId = priceForm.competitor_id === NEW_COMPETITOR ? '' : priceForm.competitor_id;
    let compName = competitors.find((c) => c.id === competitorId)?.name ?? '';

    if (priceForm.competitor_id === NEW_COMPETITOR) {
      const newName = priceForm.competitor.trim();
      if (!newName) { setError('Digite o nome do novo concorrente.'); return; }
      setPriceSaving(true);
      const { data: created, error: cErr } = await supabase.from('competitors').insert({ name: newName }).select('*').single();
      if (cErr) { setPriceSaving(false); setError(cErr.message); return; }
      competitorId = created.id;
      compName = created.name;
      setCompetitors((prev) => [...prev, created as Competitor].sort((a, b) => a.name.localeCompare(b.name)));
    }

    if (!compName) { setError('Selecione ou cadastre um concorrente.'); return; }
    setPriceSaving(true);

    if (!editing) {
      // Part doesn't exist yet — keep this price locally; it's persisted
      // together with the part when the main "Salvar" is clicked.
      const localRow: PriceRow = {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        part_id: '',
        competitor_id: competitorId || null,
        competitor: compName,
        price: Number(priceForm.price),
        currency: priceForm.currency,
        observed_at: priceForm.observed_at,
        notes: priceForm.notes || null,
        created_at: new Date().toISOString(),
        competitor_ref: competitors.find((c) => c.id === competitorId) ?? null,
      };
      setPriceRows((prev) => editingPrice ? prev.map((r) => (r.id === editingPrice.id ? { ...localRow, id: editingPrice.id } : r)) : [localRow, ...prev]);
      setPriceSaving(false);
      setPriceOpen(false);
      return;
    }

    const payload = {
      part_id: editing.id,
      competitor_id: competitorId || null,
      competitor: compName,
      price: Number(priceForm.price),
      currency: priceForm.currency,
      observed_at: priceForm.observed_at,
      notes: priceForm.notes || null,
    };
    let err;
    if (editingPrice) {
      ({ error: err } = await supabase.from('competition_prices').update(payload).eq('id', editingPrice.id));
    } else {
      ({ error: err } = await supabase.from('competition_prices').insert(payload));
    }
    setPriceSaving(false);
    if (err) { setError(err.message); return; }
    setPriceOpen(false);
    const { data: prices } = await supabase
      .from('competition_prices')
      .select('*, competitor_ref:competitor_id(*)')
      .eq('part_id', editing.id)
      .order('observed_at', { ascending: false });
    setPriceRows((prices as PriceRow[]) ?? []);
  };

  const removePrice = async () => {
    if (!priceDeleteId) return;
    if (!editing) {
      // Local-only row (part not saved yet)
      setPriceRows((prev) => prev.filter((r) => r.id !== priceDeleteId));
      setPriceDeleteId(null);
      return;
    }
    await supabase.from('competition_prices').delete().eq('id', priceDeleteId);
    setPriceDeleteId(null);
    const { data: prices } = await supabase
      .from('competition_prices')
      .select('*, competitor_ref:competitor_id(*)')
      .eq('part_id', editing.id)
      .order('observed_at', { ascending: false });
    setPriceRows((prices as PriceRow[]) ?? []);
  };

  const lowStock = parts.filter((p) => p.stock_quantity <= p.min_stock).length;

  return (
    <div>
      <PageHeader
        title="Peças"
        subtitle={`${parts.length} peças cadastradas${lowStock > 0 ? ` · ${lowStock} com estoque baixo` : ''}`}
        action={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Nova peça</button>}
      />

      <div className="card p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            className="input pl-10"
            placeholder="Buscar por nome, marca ou categoria..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Boxes} title="Nenhuma peça encontrada" subtitle="Cadastre sua primeira peça para começar a gerenciar o estoque." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Nome</th>
                  <th className="th">Marca</th>
                  <th className="th">Categoria</th>
                  <th className="th">Estado</th>
                  <th className="th text-right">Estoque</th>
                  <th className="th text-right">Custo</th>
                  <th className="th text-right">Preço</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const low = p.stock_quantity <= p.min_stock;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/50 transition">
                      <td className="td font-medium text-slate-900">{p.name}</td>
                      <td className="td text-slate-600">{p.brand || '—'}</td>
                      <td className="td text-slate-600">{p.category || '—'}</td>
                      <td className="td">
                        <Badge tone={p.condition === 'Novo' ? 'green' : 'amber'}>{p.condition}</Badge>
                      </td>
                      <td className="td text-right">
                        <span className={`inline-flex items-center gap-1 ${low ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
                          {low && <AlertTriangle size={13} />}
                          {p.stock_quantity}
                        </span>
                      </td>
                      <td className="td text-right text-slate-600">{BRL(p.unit_cost)}</td>
                      <td className="td text-right font-semibold text-slate-900">{BRL(p.unit_price)}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button className="icon-btn" onClick={() => openEdit(p)}><Pencil size={15} /></button>
                          <button className="icon-btn hover:text-red-600" onClick={() => setDeleteId(p.id)}><Trash2 size={15} /></button>
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
        <Modal title={editing ? 'Editar peça' : 'Nova peça'} onClose={() => setOpen(false)} wide>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Nome"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Marca"><input className={inputCls} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
              <Field label="Categoria"><input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
              <Field label="Modelo da máquina"><input className={inputCls} value={form.machine_model} onChange={(e) => setForm({ ...form, machine_model: e.target.value })} /></Field>
              <Field label="Estado">
                <select className={inputCls} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                  <option value="Novo">Novo</option>
                  <option value="Usado">Usado</option>
                </select>
              </Field>
            </div>
            <Field label="Descrição"><textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid sm:grid-cols-4 gap-4">
              <Field label="Estoque"><input type="number" className={inputCls} value={form.stock_quantity} onChange={(e) => setForm({ ...form, stock_quantity: Number(e.target.value) })} /></Field>
              <Field label="Estoque mín."><input type="number" className={inputCls} value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) })} /></Field>
              <Field label="Custo unit. (R$)"><input type="number" step="0.01" className={inputCls} value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })} /></Field>
              <Field label="Preço unit. (R$)"><input type="number" step="0.01" className={inputCls} value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) })} /></Field>
            </div>
            {form.unit_cost > 0 && form.unit_price > 0 && (() => {
              const margin = form.unit_price - form.unit_cost;
              const marginPct = (margin / form.unit_price) * 100;
              return (
                <div className="bg-emerald-50 rounded-xl px-4 py-2.5 text-sm flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-500 uppercase tracking-wide">Margem projetada</span>
                  <span className="font-semibold text-emerald-700">{BRL(margin)} ({marginPct.toFixed(1)}%)</span>
                </div>
              );
            })()}
            {/* Competitor prices */}
            <div className="border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 size={16} className="text-slate-400" />
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Preços da concorrência</span>
                </div>
                <button type="button" onClick={openNewPrice} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-600 hover:text-sky-700">
                  <Plus size={14} /> Adicionar preço
                </button>
              </div>
              {priceRows.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum preço de concorrente cadastrado.</p>
              ) : (
                <div className="space-y-2">
                  {priceRows.map((pr) => (
                    <div key={pr.id} className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-900 truncate">{pr.competitor_ref?.name ?? pr.competitor}</div>
                        <div className="text-xs text-slate-400">{formatDate(pr.observed_at)}</div>
                      </div>
                      <div className="text-sm font-semibold text-slate-900 shrink-0">{BRL(pr.price)}</div>
                      <div className="flex gap-1 shrink-0">
                        <button type="button" className="icon-btn" onClick={() => openEditPrice(pr)}><Pencil size={13} /></button>
                        <button type="button" className="icon-btn hover:text-red-600" onClick={() => setPriceDeleteId(pr.id)}><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Price modal */}
      {priceOpen && (
        <Modal title={editingPrice ? 'Editar preço concorrente' : 'Novo preço concorrente'} onClose={() => setPriceOpen(false)}>
          <div className="space-y-4">
            <Field label="Concorrente">
              <select
                className={inputCls}
                value={priceForm.competitor_id}
                onChange={(e) => setPriceForm({ ...priceForm, competitor_id: e.target.value, competitor: e.target.value === NEW_COMPETITOR ? priceForm.competitor : '' })}
              >
                <option value="">— Selecione —</option>
                {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={NEW_COMPETITOR}>+ Novo concorrente...</option>
              </select>
            </Field>
            {priceForm.competitor_id === NEW_COMPETITOR && (
              <Field label="Nome do novo concorrente">
                <input className={inputCls} value={priceForm.competitor} onChange={(e) => setPriceForm({ ...priceForm, competitor: e.target.value })} placeholder="Ex: Concorrente XYZ" autoFocus />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Preço"><input type="number" step="0.01" className={inputCls} value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: Number(e.target.value) })} /></Field>
              <Field label="Data"><input type="date" className={inputCls} value={priceForm.observed_at} onChange={(e) => setPriceForm({ ...priceForm, observed_at: e.target.value })} /></Field>
            </div>
            <Field label="Observações"><textarea className={inputCls} rows={2} value={priceForm.notes} onChange={(e) => setPriceForm({ ...priceForm, notes: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setPriceOpen(false)}>Cancelar</button>
              <button className="btn-primary" disabled={priceSaving} onClick={savePrice}>{priceSaving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Excluir peça" onClose={() => setDeleteId(null)}>
          <ConfirmDelete
            message="Tem certeza que deseja excluir esta peça? Esta ação não pode ser desfeita."
            onConfirm={remove} onCancel={() => setDeleteId(null)}
          />
        </Modal>
      )}

      {priceDeleteId && (
        <Modal title="Excluir preço" onClose={() => setPriceDeleteId(null)}>
          <ConfirmDelete message="Excluir este preço de concorrente?" onConfirm={removePrice} onCancel={() => setPriceDeleteId(null)} />
        </Modal>
      )}
    </div>
  );
}
