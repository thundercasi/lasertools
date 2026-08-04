import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Wrench, Search } from 'lucide-react';
import { supabase, type Maintenance, type Part, BRL, formatDate } from '../lib/supabase';
import { Modal, Field, Badge, EmptyState, PageHeader, ConfirmDelete } from './ui';

const inputCls = 'input';

const empty = {
  part_id: '', maintenance_date: new Date().toISOString().slice(0, 10),
  cost: 0, description: '', provider: '',
};

export default function MaintenanceScreen() {
  const [items, setItems] = useState<Maintenance[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [conditionFilter, setConditionFilter] = useState<'Todas' | 'Novo' | 'Usado'>('Todas');
  const [editing, setEditing] = useState<Maintenance | null>(null);
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [mRes, pRes] = await Promise.all([
      supabase.from('maintenances').select('*, part:part_id(*)').order('maintenance_date', { ascending: false }),
      supabase.from('parts').select('*').order('name'),
    ]);
    setItems((mRes.data as Maintenance[]) ?? []);
    setParts((pRes.data as Part[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      if (conditionFilter !== 'Todas') {
        const cond = m.part?.condition === 'Novo' ? 'Novo' : 'Usado';
        if (cond !== conditionFilter) return false;
      }
      if (!q) return true;
      return (
        (m.part?.name ?? '').toLowerCase().includes(q) ||
        (m.part?.brand ?? '').toLowerCase().includes(q) ||
        (m.provider ?? '').toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
      );
    });
  }, [items, query, conditionFilter]);

  const totalCost = filtered.reduce((s, m) => s + Number(m.cost), 0);

  const openNew = () => {
    setEditing(null);
    setForm({ ...empty, maintenance_date: new Date().toISOString().slice(0, 10) });
    setError('');
    setOpen(true);
  };

  const openEdit = (m: Maintenance) => {
    setEditing(m);
    setForm({
      part_id: m.part_id,
      maintenance_date: m.maintenance_date,
      cost: Number(m.cost) || 0,
      description: m.description ?? '',
      provider: m.provider ?? '',
    });
    setError('');
    setOpen(true);
  };

  const save = async () => {
    if (!form.part_id) { setError('Selecione a peça.'); return; }
    if (!form.description.trim()) { setError('Descreva o que foi feito na manutenção.'); return; }
    setSaving(true);
    const payload = {
      part_id: form.part_id,
      maintenance_date: form.maintenance_date,
      cost: Number(form.cost) || 0,
      description: form.description.trim(),
      provider: form.provider.trim() || null,
    };
    // part_id is intentionally never changed on edit — the trigger that
    // rolls the cost into the part's average cost assumes the same part.
    const { error: err } = editing
      ? await supabase.from('maintenances').update({ ...payload, part_id: editing.part_id }).eq('id', editing.id)
      : await supabase.from('maintenances').insert(payload);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setOpen(false);
    load();
  };

  const remove = async () => {
    if (!deleteId) return;
    await supabase.from('maintenances').delete().eq('id', deleteId);
    setDeleteId(null);
    load();
  };

  return (
    <div>
      <PageHeader
        title="Manutenções"
        subtitle={`${items.length} manutenções registradas · ${BRL(items.reduce((s, m) => s + Number(m.cost), 0))} em custos`}
        action={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Nova manutenção</button>}
      />

      <div className="card p-4 mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input className="input pl-10" placeholder="Buscar por peça, marca, prestador ou descrição..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {(['Todas', 'Novo', 'Usado'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setConditionFilter(c)}
              className={`px-3.5 py-1.5 rounded-xl text-sm font-medium transition ${
                conditionFilter === c ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {c === 'Todas' ? 'Todas' : c === 'Novo' ? 'Novas' : 'Usadas'}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Wrench} title="Nenhuma manutenção encontrada" subtitle="Registre manutenções para acompanhar custos de reparo das peças." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Peça</th>
                  <th className="th">Condição</th>
                  <th className="th">Data</th>
                  <th className="th">Descrição</th>
                  <th className="th">Prestador</th>
                  <th className="th text-right">Custo</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/50 transition">
                    <td className="td">
                      <div className="font-medium text-slate-900">{m.part?.name ?? '—'}</div>
                      {m.part?.brand && <div className="text-xs text-slate-400">{m.part.brand}</div>}
                    </td>
                    <td className="td"><Badge tone={m.part?.condition === 'Novo' ? 'green' : 'amber'}>{m.part?.condition === 'Novo' ? 'Novo' : 'Usado'}</Badge></td>
                    <td className="td text-slate-500">{formatDate(m.maintenance_date)}</td>
                    <td className="td text-slate-600 max-w-xs truncate">{m.description}</td>
                    <td className="td text-slate-500">{m.provider || '—'}</td>
                    <td className="td text-right font-semibold text-slate-900">{BRL(m.cost)}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button className="icon-btn" onClick={() => openEdit(m)}><Pencil size={15} /></button>
                        <button className="icon-btn hover:text-red-600" onClick={() => setDeleteId(m.id)}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                  <td className="td" colSpan={5}>TOTAL {query || conditionFilter !== 'Todas' ? '(filtrado)' : ''}</td>
                  <td className="td text-right">{BRL(totalCost)}</td>
                  <td className="td"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {open && (
        <Modal title={editing ? 'Editar manutenção' : 'Nova manutenção'} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            <Field label="Peça">
              <select
                className={inputCls}
                value={form.part_id}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, part_id: e.target.value })}
              >
                <option value="">— Selecione —</option>
                <optgroup label="Novas">
                  {parts.filter((p) => p.condition === 'Novo').map((p) => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}
                </optgroup>
                <optgroup label="Usadas">
                  {parts.filter((p) => p.condition !== 'Novo').map((p) => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}
                </optgroup>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Data"><input type="date" className={inputCls} value={form.maintenance_date} onChange={(e) => setForm({ ...form, maintenance_date: e.target.value })} /></Field>
              <Field label="Custo (R$)"><input type="number" step="0.01" className={inputCls} value={form.cost} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} /></Field>
            </div>
            <Field label="Prestador / Técnico" hint="opcional"><input className={inputCls} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></Field>
            <Field label="Descrição"><textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="O que foi feito na manutenção" /></Field>
            <p className="text-xs text-slate-400">O custo é somado ao custo médio da peça no estoque e gera automaticamente um lançamento em Contas a Pagar.</p>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Confirmar exclusão" onClose={() => setDeleteId(null)}>
          <ConfirmDelete message="Excluir esta manutenção? O custo será removido do custo médio da peça e o lançamento em Contas a Pagar também será excluído." onConfirm={remove} onCancel={() => setDeleteId(null)} />
        </Modal>
      )}
    </div>
  );
}
