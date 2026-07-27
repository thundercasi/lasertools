import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Users, Search, Building } from 'lucide-react';
import { supabase, type Customer } from '../lib/supabase';
import { Modal, Field, EmptyState, PageHeader, ConfirmDelete } from './ui';

const empty = {
  name: '', contact_name: '', email: '', phone: '', document: '',
  city: '', state: '', notes: '',
};

const inputCls = 'input';

export default function Customers() {
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('customers').select('*').order('name');
    if (error) { setError(error.message); } else { setItems(data as Customer[]); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.contact_name ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.city ?? '').toLowerCase().includes(q)
    );
  }, [items, query]);

  const openNew = () => { setEditing(null); setForm(empty); setError(''); setOpen(true); };
  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      name: c.name, contact_name: c.contact_name ?? '', email: c.email ?? '',
      phone: c.phone ?? '', document: c.document ?? '', city: c.city ?? '',
      state: c.state ?? '', notes: c.notes ?? '',
    });
    setError(''); setOpen(true);
  };

  const save = async () => {
    setError('');
    if (!form.name.trim()) { setError('Nome é obrigatório.'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name || null,
      email: form.email || null,
      phone: form.phone || null,
      document: form.document || null,
      city: form.city || null,
      state: form.state || null,
      notes: form.notes || null,
    };
    let err;
    if (editing) {
      ({ error: err } = await supabase.from('customers').update(payload).eq('id', editing.id));
    } else {
      ({ error: err } = await supabase.from('customers').insert(payload));
    }
    setSaving(false);
    if (err) { setError(err.message); return; }
    setOpen(false); load();
  };

  const remove = async () => {
    if (!deleteId) return;
    await supabase.from('customers').delete().eq('id', deleteId);
    setDeleteId(null); load();
  };

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle={`${items.length} clientes cadastrados`}
        action={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Novo cliente</button>}
      />

      <div className="card p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input className="input pl-10" placeholder="Buscar cliente..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum cliente encontrado" subtitle="Cadastre clientes para registrar vendas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Nome</th>
                  <th className="th">Contato</th>
                  <th className="th">E-mail</th>
                  <th className="th">Telefone</th>
                  <th className="th">Localização</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition">
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Building size={16} className="text-slate-500" />
                        </div>
                        <span className="font-medium text-slate-900">{c.name}</span>
                      </div>
                    </td>
                    <td className="td text-slate-600">{c.contact_name || '—'}</td>
                    <td className="td text-slate-600">{c.email || '—'}</td>
                    <td className="td text-slate-500">{c.phone || '—'}</td>
                    <td className="td text-slate-600">
                      {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                    </td>
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
        <Modal title={editing ? 'Editar cliente' : 'Novo cliente'} onClose={() => setOpen(false)} wide>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Nome"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Contato"><input className={inputCls} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></Field>
              <Field label="E-mail"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Telefone"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Documento (CPF/CNPJ)"><input className={inputCls} value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} /></Field>
              <div />
              <Field label="Cidade"><input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
              <Field label="Estado"><input className={inputCls} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
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
        <Modal title="Excluir cliente" onClose={() => setDeleteId(null)}>
          <ConfirmDelete
            message="Tem certeza que deseja excluir este cliente?"
            onConfirm={remove} onCancel={() => setDeleteId(null)}
          />
        </Modal>
      )}
    </div>
  );
}
