import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Boxes, Search, AlertTriangle, TrendingUp, BarChart3, Wrench, Copy, Image as ImageIcon } from 'lucide-react';
import { supabase, type Part, type Competitor, type CompetitionPrice, type Maintenance, type PartUnit, type PartStock, BRL, USD, formatDate } from '../lib/supabase';
import { useUsdRate } from '../lib/useUsdRate';
import { Modal, Field, Badge, EmptyState, PageHeader, ConfirmDelete, statusTone } from './ui';

const empty = {
  name: '', part_number: '', description: '', category: '', machine_model: '',
  brand: '', min_stock: 0, tracked_by_unit: false, photo_url: '', warranty_months: 0,
};

// Catalog pricing is per condition now — the same part can be sold new
// or used at different prices.
const CONDITIONS = ['Novo', 'Usado'] as const;
type CondPrices = Record<string, number>;

const emptyPrice = {
  competitor_id: '', competitor: '', price: 0, currency: 'BRL', condition: 'Novo',
  observed_at: new Date().toISOString().slice(0, 10), notes: '',
};

const NEW_COMPETITOR = '__new__';

const inputCls = 'input';

type PriceRow = CompetitionPrice;

export default function Parts() {
  const usd = useUsdRate();
  const [parts, setParts] = useState<Part[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [editing, setEditing] = useState<Part | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [priceRows, setPriceRows] = useState<PriceRow[]>([]);
  const [maintenanceRows, setMaintenanceRows] = useState<Maintenance[]>([]);
  const [stock, setStock] = useState<PartStock[]>([]);
  const [unitRows, setUnitRows] = useState<PartUnit[]>([]);
  const [condPrices, setCondPrices] = useState<CondPrices>({ Novo: 0, Usado: 0 });
  const [photoUploading, setPhotoUploading] = useState(false);
  const [zoomPhoto, setZoomPhoto] = useState<{ url: string; name: string } | null>(null);

  const uploadPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Selecione um arquivo de imagem.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Imagem muito grande (máx. 5MB).'); return; }
    setPhotoUploading(true);
    setError('');
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('part-photos').upload(path, file, { upsert: false });
    setPhotoUploading(false);
    if (upErr) { setError('Falha ao enviar a foto: ' + upErr.message); return; }
    const { data } = supabase.storage.from('part-photos').getPublicUrl(path);
    setForm((f) => ({ ...f, photo_url: data.publicUrl }));
  };
  const [editingPrice, setEditingPrice] = useState<PriceRow | null>(null);
  const [priceForm, setPriceForm] = useState(emptyPrice);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceDeleteId, setPriceDeleteId] = useState<string | null>(null);
  const [priceSaving, setPriceSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: compData }, { data: stockData }] = await Promise.all([
      supabase.from('parts').select('*').order('name'),
      supabase.from('competitors').select('*').order('name'),
      supabase.from('part_stock').select('*'),
    ]);
    if (error) { setError(error.message); } else { setParts(data as Part[]); }
    setCompetitors((compData as Competitor[]) ?? []);
    setStock((stockData as PartStock[]) ?? []);
    setLoading(false);
  };

  // Available balance per part, split by condition — e.g. { Novo: 3, Usado: 1 }
  const stockOf = (partId: string) => {
    const rows = stock.filter((s) => s.part_id === partId);
    const byCond: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const n = Number(r.disponivel) || 0;
      if (n !== 0) byCond[r.condition] = n;
      total += n;
    }
    return { byCond, total };
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parts;
    return parts.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.part_number ?? '').toLowerCase().includes(q) ||
      (p.brand ?? '').toLowerCase().includes(q) ||
      (p.category ?? '').toLowerCase().includes(q)
    );
  }, [parts, query]);

  const openNew = () => {
    setEditing(null);
    setDuplicating(false);
    setForm({ ...empty });
    setPriceRows([]);
    setMaintenanceRows([]);
    setUnitRows([]);
    setCondPrices({ Novo: 0, Usado: 0 });
    setError('');
    setOpen(true);
  };

  // Opens the form pre-filled from an existing part, but as a NEW record:
  // catalog data (name, brand, part number, category, prices) is copied,
  // while everything specific to the original unit is left out — stock and
  // unit_cost are derived from that part's own purchases/sales, and the
  // competitor-price and maintenance histories belong to it alone.
  const openDuplicate = (p: Part) => {
    setEditing(null);
    setDuplicating(true);
    setForm({
      name: p.name, part_number: p.part_number ?? '', description: p.description ?? '',
      category: p.category ?? '', machine_model: p.machine_model ?? '',
      brand: p.brand ?? '',
      min_stock: Number(p.min_stock) || 0,
      tracked_by_unit: !!p.tracked_by_unit,
      photo_url: '',
      warranty_months: Number(p.warranty_months) || 0,
    });
    setPriceRows([]);
    setMaintenanceRows([]);
    setUnitRows([]);
    setCondPrices({ Novo: 0, Usado: 0 });
    setError('');
    setOpen(true);
  };

  const openEdit = async (p: Part) => {
    setEditing(p);
    setDuplicating(false);
    setForm({
      name: p.name, part_number: p.part_number ?? '', description: p.description ?? '',
      category: p.category ?? '', machine_model: p.machine_model ?? '',
      brand: p.brand ?? '',
      min_stock: Number(p.min_stock) || 0,
      tracked_by_unit: !!p.tracked_by_unit,
      photo_url: p.photo_url ?? '',
      warranty_months: Number(p.warranty_months) || 0,
    });
    const { data: cp } = await supabase.from('part_condition_prices').select('*').eq('part_id', p.id);
    const cpMap: CondPrices = { Novo: 0, Usado: 0 };
    for (const row of ((cp as any[]) ?? [])) cpMap[row.condition] = Number(row.unit_price) || 0;
    setCondPrices(cpMap);
    const { data: units } = await supabase.from('part_units').select('*').eq('part_id', p.id).order('code');
    setUnitRows((units as PartUnit[]) ?? []);
    const { data: prices } = await supabase
      .from('competition_prices')
      .select('*, competitor_ref:competitor_id(*)')
      .eq('part_id', p.id)
      .order('observed_at', { ascending: false });
    setPriceRows((prices as PriceRow[]) ?? []);
    const { data: maints } = await supabase
      .from('maintenances')
      .select('*')
      .eq('part_id', p.id)
      .order('maintenance_date', { ascending: false });
    setMaintenanceRows((maints as Maintenance[]) ?? []);
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
      part_number: form.part_number.trim() || null,
      description: form.description || null,
      category: form.category || null,
      machine_model: form.machine_model || null,
      brand: form.brand || null,
      min_stock: Number(form.min_stock),
      tracked_by_unit: !!form.tracked_by_unit,
      photo_url: form.photo_url || null,
      warranty_months: Number(form.warranty_months) || null,
      // Kept in sync as a convenience/legacy value: the highest
      // per-condition price. Real pricing lives in part_condition_prices.
      unit_price: Math.max(...CONDITIONS.map((c) => Number(condPrices[c]) || 0), 0),
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
          condition: r.condition ?? 'Novo',
          observed_at: r.observed_at,
          notes: r.notes || null,
        }));
        await supabase.from('competition_prices').insert(pending);
      }
    }
    // Persist per-condition pricing.
    if (!err && partId) {
      for (const c of CONDITIONS) {
        const v = Number(condPrices[c]) || 0;
        const { data: existing } = await supabase
          .from('part_condition_prices').select('id').eq('part_id', partId).eq('condition', c).maybeSingle();
        if (existing) {
          await supabase.from('part_condition_prices').update({ unit_price: v }).eq('id', (existing as any).id);
        } else if (v > 0) {
          await supabase.from('part_condition_prices').insert({ part_id: partId, condition: c, unit_price: v });
        }
      }
    }

    setSaving(false);
    if (err) { setError(err.message); return; }
    setOpen(false);
    load();
  };

  const updateUnitSerial = async (unitId: string, serial: string) => {
    await supabase.from('part_units').update({ serial_number: serial.trim() || null }).eq('id', unitId);
    setUnitRows((prev) => prev.map((u) => (u.id === unitId ? { ...u, serial_number: serial.trim() || null } : u)));
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
      condition: pr.condition ?? 'Novo',
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
      const localRow = {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        part_id: '',
        competitor_id: competitorId || null,
        competitor: compName,
        price: Number(priceForm.price),
        currency: priceForm.currency,
        condition: priceForm.condition,
        observed_at: priceForm.observed_at,
        notes: priceForm.notes || null,
        created_at: new Date().toISOString(),
        competitor_ref: competitors.find((c) => c.id === competitorId) ?? null,
      } as PriceRow;
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
      condition: priceForm.condition,
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
            placeholder="Buscar por nome, part number, marca ou categoria..."
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
                  <th className="th">Controle</th>
                  <th className="th text-right">Disponível</th>
                  <th className="th text-right">Em manut.</th>
                  <th className="th text-right">Custo</th>
                  <th className="th text-right">Preço</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => {
                  const st = stockOf(p.id);
                  const low = st.total <= Number(p.min_stock);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/50 transition">
                      <td className="td font-medium text-slate-900">
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0 border border-slate-200 ${p.photo_url ? 'cursor-zoom-in hover:ring-2 hover:ring-sky-300 transition' : ''}`}
                            onClick={(e) => { if (p.photo_url) { e.stopPropagation(); setZoomPhoto({ url: p.photo_url, name: p.name }); } }}
                          >
                            {p.photo_url ? (
                              <img src={p.photo_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <ImageIcon size={14} className="text-slate-300" />
                            )}
                          </div>
                          <div>
                            {p.name}
                            {p.part_number && <div className="text-xs font-normal text-slate-400">P/N: {p.part_number}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="td text-slate-600">{p.brand || '—'}</td>
                      <td className="td text-slate-600">{p.category || '—'}</td>
                      <td className="td">
                        {p.tracked_by_unit
                          ? <Badge tone="blue">Por unidade</Badge>
                          : <span className="text-xs text-slate-400">Por quantidade</span>}
                      </td>
                      <td className="td text-right">
                        <span className={`inline-flex items-center gap-1 ${low ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>
                          {low && <AlertTriangle size={13} />}
                          {st.total}
                        </span>
                        {Object.keys(st.byCond).length > 0 && (
                          <div className="text-xs font-normal text-slate-400">
                            {Object.entries(st.byCond).map(([c, n]) => `${n} ${c.toLowerCase()}`).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="td text-right">
                        {Number(p.in_maintenance) > 0
                          ? <span className="inline-flex items-center gap-1 text-amber-600 font-medium"><Wrench size={12} />{p.in_maintenance}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="td text-right text-slate-600">{BRL(p.unit_cost)}</td>
                      <td className="td text-right font-semibold text-slate-900">{BRL(p.unit_price)}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          <button className="icon-btn" title="Editar" onClick={() => openEdit(p)}><Pencil size={15} /></button>
                          <button className="icon-btn" title="Replicar" onClick={() => openDuplicate(p)}><Copy size={15} /></button>
                          <button className="icon-btn hover:text-red-600" title="Excluir" onClick={() => setDeleteId(p.id)}><Trash2 size={15} /></button>
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
        <Modal title={editing ? 'Editar peça' : duplicating ? 'Replicar peça' : 'Nova peça'} onClose={() => setOpen(false)} wide>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            {duplicating && (
              <div className="text-xs text-sky-700 bg-sky-50 rounded-lg p-3">
                Replicando os dados de cadastro. Estoque, custo, preços de concorrentes e histórico de manutenções não são copiados — eles pertencem à peça original. Ajuste o que precisar e salve como uma peça nova.
              </div>
            )}

            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden shrink-0 border border-slate-200">
                {form.photo_url ? (
                  <img src={form.photo_url} alt="Foto da peça" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon size={28} className="text-slate-300" />
                )}
              </div>
              <div>
                <label className="btn-secondary cursor-pointer inline-flex">
                  {photoUploading ? 'Enviando...' : form.photo_url ? 'Trocar foto' : 'Adicionar foto'}
                  <input
                    type="file" accept="image/*" className="hidden" disabled={photoUploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ''; }}
                  />
                </label>
                {form.photo_url && (
                  <button type="button" className="ml-2 text-xs text-slate-400 hover:text-red-600" onClick={() => setForm({ ...form, photo_url: '' })}>
                    Remover
                  </button>
                )}
                <p className="text-xs text-slate-400 mt-1">Foto ilustrativa da peça (opcional). JPG, PNG — até 5MB.</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Nome"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Part Number" hint="identificador da peça no mercado"><input className={inputCls} value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} /></Field>
              <Field label="Marca"><input className={inputCls} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
              <Field label="Categoria"><input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
              <Field label="Modelo da máquina"><input className={inputCls} value={form.machine_model} onChange={(e) => setForm({ ...form, machine_model: e.target.value })} /></Field>
              <Field label="Estoque mín."><input type="number" className={inputCls} value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) })} /></Field>
              <Field label="Tempo de garantia (meses)"><input type="number" min={0} className={inputCls} value={form.warranty_months} onChange={(e) => setForm({ ...form, warranty_months: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Descrição"><textarea className={inputCls} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>

            <label className="flex items-start gap-2.5 cursor-pointer select-none bg-slate-50 rounded-xl p-3">
              <input
                type="checkbox"
                className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 mt-0.5"
                checked={form.tracked_by_unit}
                onChange={(e) => setForm({ ...form, tracked_by_unit: e.target.checked })}
              />
              <span>
                <span className="text-sm font-medium text-slate-800">Controlar por unidade</span>
                <span className="block text-xs text-slate-400">
                  Cada exemplar vira um registro próprio, com número de série (opcional), custo real e histórico de manutenção.
                  Indicado para peças de maior valor. Sem isso, a peça é controlada apenas por quantidade.
                </span>
              </span>
            </label>

            {/* Per-condition pricing */}
            <div className="border-t border-slate-200 pt-4">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Preço de venda por condição</span>
              <div className="grid sm:grid-cols-2 gap-4 mt-3">
                {CONDITIONS.map((c) => {
                  const st = editing ? stockOf(editing.id).byCond[c] ?? 0 : 0;
                  return (
                    <Field key={c} label={`${c} (R$)`} hint={editing ? `${st} em estoque` : undefined}>
                      <input
                        type="number" step="0.01" className={inputCls}
                        value={condPrices[c] ?? 0}
                        onChange={(e) => setCondPrices({ ...condPrices, [c]: Number(e.target.value) })}
                      />
                    </Field>
                  );
                })}
              </div>
            </div>

            {/* Units of this part */}
            {editing && form.tracked_by_unit && (
              <div className="border-t border-slate-200 pt-4">
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Unidades ({unitRows.length})</span>
                {unitRows.length === 0 ? (
                  <p className="text-xs text-slate-400 mt-2">Nenhuma unidade ainda. Elas são criadas automaticamente ao registrar uma compra desta peça.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {unitRows.map((u) => (
                      <div key={u.id} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2.5">
                        <span className="text-xs font-mono text-slate-500 w-16 shrink-0">{u.code}</span>
                        <Badge tone={u.condition === 'Novo' ? 'green' : 'amber'}>{u.condition}</Badge>
                        <input
                          className={`${inputCls} text-xs flex-1`}
                          placeholder="Nº de série (opcional)"
                          defaultValue={u.serial_number ?? ''}
                          onBlur={(e) => updateUnitSerial(u.id, e.target.value)}
                        />
                        <span className="text-xs text-slate-500 w-20 text-right shrink-0">{BRL(u.unit_cost)}</span>
                        <Badge tone={u.status === 'Disponível' ? 'green' : u.status === 'Vendida' ? 'slate' : 'amber'}>{u.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
                  {priceRows.map((pr) => {
                    const rate = usd.baseRate ?? usd.effectiveRate;
                    const usdValue = pr.currency === 'USD' ? Number(pr.price) : (rate ? Number(pr.price) / rate : null);
                    const brlValue = pr.currency === 'BRL' ? Number(pr.price) : (rate ? Number(pr.price) * rate : null);
                    return (
                      <div key={pr.id} className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-900 truncate flex items-center gap-1.5">
                            {pr.competitor_ref?.name ?? pr.competitor}
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pr.condition === 'Usado' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {pr.condition}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400">{formatDate(pr.observed_at)}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-semibold ${pr.currency === 'USD' ? 'text-slate-900' : 'text-slate-500'}`}>{usdValue != null ? USD(usdValue) : '—'}</div>
                          <div className={`text-sm font-semibold ${pr.currency === 'BRL' ? 'text-slate-900' : 'text-slate-500'}`}>{brlValue != null ? BRL(brlValue) : '—'}</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button type="button" className="icon-btn" onClick={() => openEditPrice(pr)}><Pencil size={13} /></button>
                          <button type="button" className="icon-btn hover:text-red-600" onClick={() => setPriceDeleteId(pr.id)}><Trash2 size={13} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Maintenance history (read-only here — manage in the Manutenções module) */}
            {editing && (
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Wrench size={16} className="text-slate-400" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Histórico de manutenções</span>
                  </div>
                  {maintenanceRows.length > 0 && (
                    <span className="text-xs font-semibold text-slate-500">Total: {BRL(maintenanceRows.reduce((s, m) => s + Number(m.cost), 0))}</span>
                  )}
                </div>
                {maintenanceRows.length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhuma manutenção registrada para esta peça.</p>
                ) : (
                  <div className="space-y-2">
                    {maintenanceRows.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 bg-slate-50 rounded-lg p-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-900 truncate">{m.description}</div>
                          <div className="text-xs text-slate-400">{formatDate(m.maintenance_date)}{m.provider ? ` · ${m.provider}` : ''}</div>
                        </div>
                        <div className="text-sm font-semibold text-slate-900 shrink-0">{BRL(m.cost)}</div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-2">Para adicionar ou editar, use o módulo "Manutenções".</p>
              </div>
            )}

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field label="Preço"><input type="number" step="0.01" className={inputCls} value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: Number(e.target.value) })} /></Field>
              <Field label="Moeda">
                <select className={inputCls} value={priceForm.currency} onChange={(e) => setPriceForm({ ...priceForm, currency: e.target.value })}>
                  <option value="BRL">BRL (R$)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </Field>
              <Field label="Condição">
                <select className={inputCls} value={priceForm.condition} onChange={(e) => setPriceForm({ ...priceForm, condition: e.target.value })}>
                  <option value="Novo">Novo</option>
                  <option value="Usado">Usado</option>
                </select>
              </Field>
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

      {zoomPhoto && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setZoomPhoto(null)}
        >
          <div className="max-w-2xl max-h-[85vh] flex flex-col items-center gap-3">
            <img
              src={zoomPhoto.url}
              alt={zoomPhoto.name}
              className="max-w-full max-h-[75vh] object-contain rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <span className="text-white text-sm font-medium">{zoomPhoto.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}
