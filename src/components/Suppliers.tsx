import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Truck, Search, Globe, ExternalLink, Building2 } from 'lucide-react';
import { supabase, type Supplier } from '../lib/supabase';
import { Modal, Field, Badge, EmptyState, PageHeader, ConfirmDelete } from './ui';

const empty = {
  name: '', country: 'Brasil', is_international: false,
  contact_name: '', email: '', phone: '', document: '', website: '', notes: '',
};

const inputCls = 'input';

export default function Suppliers() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('suppliers').select('*').order('name');
    if (error) { setError(error.message); } else { setItems(data as Supplier[]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.contact_name ?? '').toLowerCase().includes(q) ||
      (s.email ?? '').toLowerCase().includes(q)
    );
  }, [items, query]);

  const openNew = () => { setEditing(null); setForm(empty); setError(''); setOpen(true); };
  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name, country: s.country, is_international: s.is_international,
      contact_name: s.contact_name ?? '', email: s.email ?? '', phone: s.phone ?? '',
      document: s.document ?? '', website: s.website ?? '', notes: s.notes ?? '',
    });
    setError(''); setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.name.trim()) { setError('Nome é obrigatório.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      country: form.country.trim(),
      is_international: form.is_international,
      contact_name: form.contact_name || null,
      email: form.email || null,
      phone: form.phone || null,
      document: form.document || null,
      website: form.website || null,
      notes: form.notes || null,
    };
    let err;
    if (editing) {
      ({ error: err } = await supabase.from('suppliers').update(payload).eq('id', editing.id));
    } else {
      ({ error: err } = await supabase.from('suppliers').insert(payload));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    setOpen(false); load();
  };

  const remove = async () => {
    if (!deleteId) return;
    await supabase.from('suppliers').delete().eq('id', deleteId);
    setDeleteId(null); load();
  };

  const hostOf = (url: string | null) => {
    if (!url) return null;
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  };

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        subtitle={`${items.length} fornecedores cadastrados`}
        action={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Novo fornecedor</button>}
      />

      <div className="card p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input className="input pl-10" placeholder="Buscar fornecedor..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Truck} title="Nenhum fornecedor encontrado" subtitle="Cadastre fornecedores para gerenciar suas compras." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Nome</th>
                  <th className="th">Origem</th>
                  <th className="th">Contato</th>
                  <th className="th">E-mail</th>
                  <th className="th">Telefone</th>
                  <th className="th">Site</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition">
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Building2 size={16} className="text-slate-500" />
                        </div>
                        <span className="font-medium text-slate-900">{s.name}</span>
                      </div>
                    </td>
                    <td className="td">
                      <Badge tone={s.is_international ? 'blue' : 'slate'}>
                        {s.is_international && <Globe size={11} />}
                        {s.country}
                      </Badge>
                    </td>
                    <td className="td text-slate-600">{s.contact_name || '—'}</td>
                    <td className="td text-slate-600">{s.email || '—'}</td>
                    <td className="td text-slate-500">{s.phone || '—'}</td>
                    <td className="td">
                      {s.website ? (
                        <a href={s.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-700 hover:underline">
                          <ExternalLink size={13} /> {hostOf(s.website)}
                        </a>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button className="icon-btn" onClick={() => openEdit(s)}><Pencil size={15} /></button>
                        <button className="icon-btn hover:text-red-600" onClick={() => setDeleteId(s.id)}><Trash2 size={15} /></button>
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
        <Modal title={editing ? 'Editar fornecedor' : 'Novo fornecedor'} onClose={() => setOpen(false)} wide>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Nome"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="País"><input className={inputCls} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
              <Field label="Contato"><input className={inputCls} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></Field>
              <Field label="Documento (CNPJ/tax)"><input className={inputCls} value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} /></Field>
              <Field label="E-mail"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Telefone"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <div className="sm:col-span-2">
                <Field label="Site" hint="Ex: https://exemplo.com"><input className={inputCls} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" /></Field>
              </div>
            </div>
            <Field label="Observações"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={form.is_international} onChange={(e) => setForm({ ...form, is_international: e.target.checked })} className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500" />
              <span className="text-sm text-slate-700">Fornecedor internacional (importação)</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setOpen(false)}>Cancelar</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Excluir fornecedor" onClose={() => setDeleteId(null)}>
          <ConfirmDelete
            message="Tem certeza que deseja excluir este fornecedor?"
            onConfirm={remove} onCancel={() => setDeleteId(null)}
          />
        </Modal>
      )}
    </div>
  );
}
