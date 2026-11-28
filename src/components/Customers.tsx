import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Users, Search, Building, KeySquare, Layers, X, Check } from 'lucide-react';
import { supabase, type Customer, type CustomerGroup } from '../lib/supabase';
import { Modal, Field, EmptyState, PageHeader, ConfirmDelete, ViewEditFooter } from './ui';
import PortalAccess from './PortalAccess';
import { invalidateCustomerGroups } from './CustomerPicker';

const empty = {
  name: '', contact_name: '', email: '', phone: '', document: '',
  city: '', state: '', notes: '',
  cep: '', address: '', address_number: '', address_complement: '', neighborhood: '',
  group_id: '',
};

const inputCls = 'input';

export default function Customers({
  autoOpenNew, onAutoOpenNewConsumed,
}: {
  autoOpenNew?: boolean;
  onAutoOpenNewConsumed?: () => void;
} = {}) {
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [portalFor, setPortalFor] = useState<Customer | null>(null);
  // Clique na linha abre em modo consulta (campos travados); o lápis abre já editando.
  const [viewing, setViewing] = useState(false);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState('');
  const [groupsOpen, setGroupsOpen] = useState(false);
  // Criação rápida de grupo direto no formulário do cliente.
  const [newGroupName, setNewGroupName] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    invalidateCustomerGroups();
    const [cRes, gRes] = await Promise.all([
      supabase.from('customers').select('*').order('name'),
      supabase.from('customer_groups').select('*').order('name'),
    ]);
    if (cRes.error) { setError(cRes.error.message); } else { setItems(cRes.data as Customer[]); }
    if (!gRes.error) setGroups(gRes.data as CustomerGroup[]);
    setLoading(false);
  };

  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? '';

  const createGroupInline = async () => {
    const name = (newGroupName ?? '').trim();
    if (!name) return;
    const { data, error: err } = await supabase.from('customer_groups').insert({ name }).select().single();
    if (err) { setError(err.code === '23505' ? 'Já existe um grupo com esse nome.' : err.message); return; }
    invalidateCustomerGroups();
    setGroups((gs) => [...gs, data as CustomerGroup].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((f) => ({ ...f, group_id: (data as CustomerGroup).id }));
    setNewGroupName(null);
  };

  useEffect(() => { load(); }, []);

  // Arrived here via "+ Novo cliente..." from another screen (e.g. Vendas)
  // — open the form right away instead of making the user click again.
  useEffect(() => {
    if (autoOpenNew) {
      openNew();
      onAutoOpenNewConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenNew]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = groupFilter === '__none' ? items.filter((c) => !c.group_id)
      : groupFilter ? items.filter((c) => c.group_id === groupFilter) : items;
    if (!q) return base;
    return base.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      groupName(c.group_id).toLowerCase().includes(q) ||
      (c.contact_name ?? '').toLowerCase().includes(q) ||
      (c.email ?? '').toLowerCase().includes(q) ||
      (c.city ?? '').toLowerCase().includes(q)
    );
  }, [items, query, groupFilter, groups]);

  const [cepLoading, setCepLoading] = useState(false);
  // Busca o endereço pelo CEP (ViaCEP) e preenche só os campos ainda vazios.
  const lookupCep = async (raw: string) => {
    const cep = raw.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (!d.erro) {
        setForm((f) => ({
          ...f,
          address: f.address || d.logradouro || '',
          neighborhood: f.neighborhood || d.bairro || '',
          city: f.city || d.localidade || '',
          state: f.state || d.uf || '',
        }));
      }
    } catch { /* sem internet ou CEP inexistente: o usuário preenche à mão */ }
    setCepLoading(false);
  };

  const openNew = () => { setEditing(null); setViewing(false); setForm({ ...empty, group_id: groupFilter && groupFilter !== '__none' ? groupFilter : '' }); setNewGroupName(null); setError(''); setOpen(true); };
  const openEdit = (c: Customer, view = false) => {
    setEditing(c);
    setViewing(view);
    setForm({
      name: c.name, contact_name: c.contact_name ?? '', email: c.email ?? '',
      phone: c.phone ?? '', document: c.document ?? '', city: c.city ?? '',
      state: c.state ?? '', notes: c.notes ?? '',
      cep: c.cep ?? '', address: c.address ?? '', address_number: c.address_number ?? '',
      address_complement: c.address_complement ?? '', neighborhood: c.neighborhood ?? '',
      group_id: c.group_id ?? '',
    });
    setNewGroupName(null);
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
      state: form.state.trim().toUpperCase() || null,
      cep: form.cep.replace(/\D/g, '') || null,
      address: form.address.trim() || null,
      address_number: form.address_number.trim() || null,
      address_complement: form.address_complement.trim() || null,
      neighborhood: form.neighborhood.trim() || null,
      notes: form.notes || null,
      group_id: form.group_id || null,
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
        action={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setGroupsOpen(true)}><Layers size={16} /> Grupos</button>
            <button className="btn-primary" onClick={openNew}><Plus size={16} /> Novo cliente</button>
          </div>
        }
      />

      <div className="card p-4 mb-4 flex flex-col sm:flex-row gap-3">
        <select className="input sm:w-64" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="">Todos os grupos</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name} ({items.filter((c) => c.group_id === g.id).length})</option>
          ))}
          <option value="__none">Sem grupo ({items.filter((c) => !c.group_id).length})</option>
        </select>
        <div className="relative flex-1">
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
                  <th className="th">Grupo</th>
                  <th className="th">Contato</th>
                  <th className="th">E-mail</th>
                  <th className="th">Telefone</th>
                  <th className="th">Localização</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50 transition cursor-pointer" onClick={() => openEdit(c, true)}>
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Building size={16} className="text-slate-500" />
                        </div>
                        <span className="font-medium text-slate-900">{c.name}</span>
                      </div>
                    </td>
                    <td className="td">{c.group_id ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 text-xs font-medium"><Layers size={12} />{groupName(c.group_id)}</span> : <span className="text-slate-400">—</span>}</td>
                    <td className="td text-slate-600">{c.contact_name || '—'}</td>
                    <td className="td text-slate-600">{c.email || '—'}</td>
                    <td className="td text-slate-500">{c.phone || '—'}</td>
                    <td className="td text-slate-600">
                      {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button className="icon-btn" title="Acesso ao Portal do Cliente" onClick={() => setPortalFor(c)}><KeySquare size={15} /></button>
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
        <Modal title={viewing ? 'Consultar cliente' : editing ? 'Editar cliente' : 'Novo cliente'} onClose={() => setOpen(false)} wide>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            <fieldset disabled={viewing} className="space-y-4 min-w-0">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Nome"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Grupo" hint="agrupa unidades da mesma rede/dono">
                {newGroupName === null ? (
                  <select className={inputCls} value={form.group_id}
                    onChange={(e) => e.target.value === '__new' ? setNewGroupName('') : setForm({ ...form, group_id: e.target.value })}>
                    <option value="">Sem grupo</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    <option value="__new">+ Novo grupo…</option>
                  </select>
                ) : (
                  <div className="flex gap-2">
                    <input className={inputCls} autoFocus placeholder="Nome do grupo" value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createGroupInline(); } if (e.key === 'Escape') setNewGroupName(null); }} />
                    <button type="button" className="icon-btn" title="Criar grupo" onClick={createGroupInline}><Check size={16} /></button>
                    <button type="button" className="icon-btn" title="Cancelar" onClick={() => setNewGroupName(null)}><X size={16} /></button>
                  </div>
                )}
              </Field>
              <Field label="Contato"><input className={inputCls} value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></Field>
              <Field label="E-mail"><input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Telefone"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Documento (CPF/CNPJ)"><input className={inputCls} value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} /></Field>
              <Field label="CEP" hint={cepLoading ? 'buscando endereço…' : 'preenche o endereço automaticamente'}>
                <input className={inputCls} value={form.cep} inputMode="numeric" placeholder="00000-000"
                  onChange={(e) => setForm({ ...form, cep: e.target.value })}
                  onBlur={() => lookupCep(form.cep)} />
              </Field>
            </div>
            <div className="grid sm:grid-cols-6 gap-4">
              <div className="sm:col-span-4"><Field label="Endereço"><input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field></div>
              <div className="sm:col-span-2"><Field label="Número"><input className={inputCls} value={form.address_number} onChange={(e) => setForm({ ...form, address_number: e.target.value })} /></Field></div>
              <div className="sm:col-span-3"><Field label="Complemento"><input className={inputCls} value={form.address_complement} onChange={(e) => setForm({ ...form, address_complement: e.target.value })} /></Field></div>
              <div className="sm:col-span-3"><Field label="Bairro"><input className={inputCls} value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} /></Field></div>
              <div className="sm:col-span-4"><Field label="Cidade"><input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field></div>
              <div className="sm:col-span-2"><Field label="UF"><input className={inputCls} maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} /></Field></div>
            </div>
            <p className="text-xs text-slate-400 -mt-1">Para emitir boleto, o banco exige CPF/CNPJ, endereço, cidade, UF e CEP do cliente.</p>
            <Field label="Observações"><textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </fieldset>
            <ViewEditFooter viewing={viewing} saving={saving} onEdit={() => setViewing(false)} onClose={() => setOpen(false)} onSave={save} />
          </div>
        </Modal>
      )}

      {groupsOpen && (
        <CustomerGroupsManager groups={groups} customers={items} onClose={() => setGroupsOpen(false)} onChanged={load} />
      )}

      {portalFor && <PortalAccess customer={portalFor} onClose={() => setPortalFor(null)} />}

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

function CustomerGroupsManager({ groups, customers, onClose, onChanged }: {
  groups: CustomerGroup[];
  customers: Customer[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteGroup, setDeleteGroup] = useState<CustomerGroup | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const count = (id: string) => customers.filter((c) => c.group_id === id).length;
  const msg = (e: { code?: string; message: string }) => e.code === '23505' ? 'Já existe um grupo com esse nome.' : e.message;

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.from('customer_groups').insert({ name: name.trim() });
    setBusy(false);
    if (err) { setError(msg(err)); return; }
    setName(''); onChanged();
  };

  const rename = async () => {
    if (!editId || !editName.trim()) return;
    setBusy(true); setError('');
    const { error: err } = await supabase.from('customer_groups').update({ name: editName.trim() }).eq('id', editId);
    setBusy(false);
    if (err) { setError(msg(err)); return; }
    setEditId(null); onChanged();
  };

  const remove = async () => {
    if (!deleteGroup) return;
    const { error: err } = await supabase.from('customer_groups').delete().eq('id', deleteGroup.id);
    if (err) setError(err.message);
    setDeleteGroup(null); onChanged();
  };

  return (
    <Modal title="Grupos de clientes" onClose={onClose}>
      <div className="space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
        <div className="flex gap-2">
          <input className="input" placeholder="Novo grupo (ex.: Espaçolaser)" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button className="btn-primary shrink-0" disabled={busy || !name.trim()} onClick={add}><Plus size={16} /> Adicionar</button>
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">Nenhum grupo cadastrado.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center gap-2 px-3 py-2">
                {editId === g.id ? (
                  <>
                    <input className="input" autoFocus value={editName} onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEditId(null); }} />
                    <button className="icon-btn" title="Salvar" onClick={rename}><Check size={15} /></button>
                    <button className="icon-btn" title="Cancelar" onClick={() => setEditId(null)}><X size={15} /></button>
                  </>
                ) : (
                  <>
                    <Layers size={15} className="text-violet-500 shrink-0" />
                    <span className="flex-1 font-medium text-slate-800">{g.name}</span>
                    <span className="text-xs text-slate-500">{count(g.id)} cliente(s)</span>
                    <button className="icon-btn" title="Renomear" onClick={() => { setEditId(g.id); setEditName(g.name); }}><Pencil size={15} /></button>
                    <button className="icon-btn hover:text-red-600" title="Excluir" onClick={() => setDeleteGroup(g)}><Trash2 size={15} /></button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {deleteGroup && (
          <div className="border border-red-200 bg-red-50 rounded-lg p-3 text-sm">
            <p className="text-red-700 mb-2">
              Excluir o grupo <b>{deleteGroup.name}</b>?{count(deleteGroup.id) > 0 && ` Os ${count(deleteGroup.id)} cliente(s) dele ficam sem grupo (não são excluídos).`}
            </p>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost" onClick={() => setDeleteGroup(null)}>Cancelar</button>
              <button className="btn-primary bg-red-600 hover:bg-red-700" onClick={remove}>Excluir</button>
            </div>
          </div>
        )}
        <div className="flex justify-end"><button className="btn-secondary" onClick={onClose}>Fechar</button></div>
      </div>
    </Modal>
  );
}