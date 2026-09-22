import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Search, ExternalLink, Users, Building2 } from 'lucide-react';
import { supabase, type Supplier } from '../lib/supabase';
import { Modal, Field, EmptyState, PageHeader, ConfirmDelete, Badge } from './ui';

const empty = { name: '', website: '', notes: '', is_international: false };
const inputCls = 'input';

// Concorrentes agora vivem na mesma tabela de Fornecedores (is_competitor
// = true) — evita ter a mesma empresa cadastrada duas vezes quando ela é
// tanto uma fonte de preço quanto um lugar de onde você já compra.
export default function Competition() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('suppliers').select('*').eq('is_competitor', true).order('name');
    if (error) setError(error.message); else setItems(data as Supplier[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.name.toLowerCase().includes(q));
  }, [items, query]);

  const openNew = () => { setEditing(null); setForm(empty); setError(''); setOpen(true); };
  const openEdit = (c: Supplier) => {
    setEditing(c);
    setForm({ name: c.name, website: c.website ?? '', notes: c.notes ?? '', is_international: c.is_international });
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
      is_international: form.is_international,
      is_competitor: true,
    };
    let err;
    if (editing) {
      ({ error: err } = await supabase.from('suppliers').update(payload).eq('id', editing.id));
    } else {
      ({ error: err } = await supabase.from('suppliers').insert({ ...payload, country: form.is_international ? 'Internacional' : 'Brasil' }));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    setOpen(false); load();
  };

  // "Remover" aqui só tira a marcação de concorrente — nunca apaga o
  // fornecedor de verdade, porque ele pode ter compras reais vinculadas.
  const remove = async () => {
    if (!removeId) return;
    await supabase.from('suppliers').update({ is_competitor: false }).eq('id', removeId);
    setRemoveId(null); load();
  };

  return (
    <div>
      <PageHeader
        title="Concorrentes"
        subtitle={`${items.length} concorrentes cadastrados — compartilha o cadastro com Fornecedores`}
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
                    <td className="td font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        {c.name}
                        <Badge tone="slate"><Building2 size={11} /> também fornecedor</Badge>
                      </div>
                    </td>
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
                        <button className="icon-btn hover:text-red-600" title="Remover da lista de concorrentes" onClick={() => setRemoveId(c.id)}><Trash2 size={15} /></button>
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
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.is_international} onChange={(e) => setForm({ ...form, is_international: e.target.checked })} className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500" />
              <span className="text-sm text-slate-700">Empresa internacional</span>
            </label>
            <p className="text-xs text-slate-400">
              Esse cadastro é compartilhado com Fornecedores — se um dia você comprar dessa empresa, é só usar o mesmo nome lá, sem duplicar.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </Modal>
      )}

      {removeId && (
        <Modal title="Remover concorrente" onClose={() => setRemoveId(null)}>
          <ConfirmDelete
            message="Remover da lista de concorrentes? O cadastro de fornecedor (se houver histórico de compras) continua existindo — só deixa de aparecer aqui."
            onConfirm={remove}
            onCancel={() => setRemoveId(null)}
          />
        </Modal>
      )}
    </div>
  );
}
