import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search, ExternalLink, Users } from 'lucide-react';
import { supabase, type Competitor } from '../lib/supabase';
import { Modal, Field, EmptyState, PageHeader, ConfirmDelete } from './ui';

const empty = { name: '', website: '', notes: '' };
const inputCls = 'input';

export default function Competition() {
  const [items, setItems] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('competitors').select('*').order('name');
    if (error) setError(error.message); else setItems(data as Competitor[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.name.toLowerCase().includes(q));
  }, [items, query]);

  const openNew = () => { setEditing(null); setForm(empty); setError(''); setOpen(true); };
  const openEdit = (c: Competitor) => {
    setEditing(c);
    setForm({ name: c.name, website: c.website ?? '', notes: c.notes ?? '' });
    setError(''); setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.name.trim()) { setError('Nome é obrigatório.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      website: form.website || null,
      notes: form.notes || null,
    };
    let err;
    if (editing) {
      ({ error: err } = await supabase.from('competitors').update(payload).eq('id', editing.id));
    } else {
      ({ error: err } = await supabase.from('competitors').insert(payload));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    setOpen(false); load();
  };

  const remove = async () => {
    if (!deleteId) return;
    await supabase.from('competitors').delete().eq('id', deleteId);
    setDeleteId(null); load();
  };

  return (
    <div>
      <PageHeader
        title="Concorrentes"
        subtitle={`${items.length} concorrentes cadastrados`}
        action={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Novo concorrente</button>}
      />

      <div className="card p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input className="input pl-10" placeholder="Buscar por nome..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum concorrente cadastrado" subtitle="Cadastre seus concorrentes para registrar preços dentro de cada peça." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Nome</th>
                  <th className="th">Website</th>
                  <th className="th">Observações</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition">
                    <td className="td font-medium text-slate-900">{c.name}</td>
                    <td className="td">
                      {c.website ? (
                        <a href={c.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-700 hover:underline">
                          {c.website} <ExternalLink size={13} />
                        </a>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="td text-slate-600 max-w-xs truncate">{c.notes || '—'}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button className="icon-btn" onClick={() => openEdit(c)}><Pencil size={15} /></button>
                        <button className="icon-btn hover:text-red-600" onClick={() => setDeleteId(c.id)}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <Modal title={editing ? 'Editar concorrente' : 'Novo concorrente'} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            <Field label="Nome"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Website"><input className={inputCls} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" /></Field>
            <Field label="Observações"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Excluir concorrente" onClose={() => setDeleteId(null)}>
          <ConfirmDelete message="Excluir este concorrente? Os preços vinculizados ficarão sem vínculo." onConfirm={remove} onCancel={() => setDeleteId(null)} />
        </Modal>
      )}
    </div>
  );
}
