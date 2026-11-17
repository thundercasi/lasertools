import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, HandCoins, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { supabase, BRL, formatDate } from '../lib/supabase';
import { Modal, Field, Badge, EmptyState, PageHeader, ConfirmDelete, ViewEditFooter } from './ui';

// Empréstimos de sócios (sem juros) — conta corrente da empresa com cada sócio.
//   Empréstimo: o sócio pagou algo pela empresa → a empresa passa a dever.
//   Devolução: a empresa devolveu dinheiro ao sócio → a dívida diminui.

type Kind = 'Empréstimo' | 'Devolução';
type Entry = {
  id: string;
  lender: string;
  entry_date: string;
  kind: Kind;
  amount: number;
  description: string | null;
  created_at: string;
};

const today = () => new Date().toLocaleDateString('en-CA');
const empty = { lender: '', entry_date: today(), kind: 'Empréstimo' as Kind, amount: 0, description: '' };
const ALL = '';

export default function Loans() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lenderFilter, setLenderFilter] = useState(ALL);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [viewing, setViewing] = useState(false);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from('partner_loans')
      .select('*')
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true });
    if (e) setError(e.message);
    setEntries(((data as Entry[]) ?? []).map((x) => ({ ...x, amount: Number(x.amount) })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const lenders = useMemo(() => Array.from(new Set(entries.map((e) => e.lender))).sort(), [entries]);

  // Totais por sócio e saldo acumulado linha a linha (em ordem de data).
  const { byLender, running } = useMemo(() => {
    const byLender = new Map<string, { lent: number; returned: number }>();
    const running = new Map<string, number>();
    const acc = new Map<string, number>();
    for (const e of entries) {
      const t = byLender.get(e.lender) ?? { lent: 0, returned: 0 };
      if (e.kind === 'Empréstimo') t.lent += e.amount; else t.returned += e.amount;
      byLender.set(e.lender, t);
      const bal = (acc.get(e.lender) ?? 0) + (e.kind === 'Empréstimo' ? e.amount : -e.amount);
      acc.set(e.lender, bal);
      running.set(e.id, bal);
    }
    return { byLender, running };
  }, [entries]);

  const balanceOf = (lender: string) => {
    const t = byLender.get(lender);
    return t ? t.lent - t.returned : 0;
  };
  const totalOwed = lenders.reduce((s, l) => s + balanceOf(l), 0);

  // Lista mais recente primeiro.
  const visible = useMemo(
    () => entries.filter((e) => !lenderFilter || e.lender === lenderFilter).slice().reverse(),
    [entries, lenderFilter],
  );

  const openNew = () => {
    setEditing(null);
    setViewing(false);
    setForm({ ...empty, entry_date: today(), lender: lenderFilter || (lenders.length === 1 ? lenders[0] : '') });
    setFormError('');
    setOpen(true);
  };

  const openEdit = (e: Entry, view = false) => {
    setEditing(e);
    setViewing(view);
    setForm({ lender: e.lender, entry_date: e.entry_date, kind: e.kind, amount: e.amount, description: e.description ?? '' });
    setFormError('');
    setOpen(true);
  };

  const save = async () => {
    const lender = form.lender.trim();
    const amount = Math.round((Number(form.amount) || 0) * 100) / 100;
    if (!lender) { setFormError('Informe o sócio.'); return; }
    if (amount <= 0) { setFormError('Informe um valor maior que zero.'); return; }
    if (!form.entry_date) { setFormError('Informe a data.'); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      lender, entry_date: form.entry_date, kind: form.kind, amount,
      description: form.description.trim() || null, updated_at: new Date().toISOString(),
    };
    const { error: e } = editing
      ? await supabase.from('partner_loans').update(payload).eq('id', editing.id)
      : await supabase.from('partner_loans').insert(payload);
    setSaving(false);
    if (e) { setFormError(e.message); return; }
    setOpen(false);
    load();
  };

  const remove = async () => {
    if (!deleteId) return;
    await supabase.from('partner_loans').delete().eq('id', deleteId);
    setDeleteId(null);
    load();
  };

  // Aviso (não bloqueia): devolução maior que o saldo devido ao sócio.
  const currentBalance = form.lender.trim() ? balanceOf(form.lender.trim()) + (editing && editing.lender === form.lender.trim()
    ? (editing.kind === 'Devolução' ? editing.amount : -editing.amount) : 0) : 0;
  const overReturn = form.kind === 'Devolução' && Number(form.amount) > currentBalance + 0.01;

  return (
    <div>
      <PageHeader
        title="Empréstimos de Sócios"
        subtitle="Quanto a empresa deve a cada sócio — empréstimos (o sócio pagou pela empresa) e devoluções (a empresa devolveu). Sem juros."
        action={<button className="btn-primary" onClick={openNew}><Plus size={16} /> Novo lançamento</button>}
      />

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{error}</div>}

      {/* Saldos por sócio */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-5">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Total devido aos sócios</div>
          <div className={`mt-2 text-2xl font-bold ${totalOwed > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{BRL(totalOwed)}</div>
          <div className="text-xs text-slate-400 mt-1">{lenders.length} {lenders.length === 1 ? 'sócio' : 'sócios'}</div>
        </div>
        {lenders.map((l) => {
          const t = byLender.get(l)!;
          const bal = t.lent - t.returned;
          const active = lenderFilter === l;
          return (
            <button
              key={l}
              onClick={() => setLenderFilter(active ? ALL : l)}
              className={`card p-5 text-left transition ${active ? 'ring-2 ring-slate-900' : 'hover:ring-2 hover:ring-slate-200'}`}
              title={active ? 'Mostrar todos' : `Ver só ${l}`}
            >
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide truncate">{l}</div>
              <div className={`mt-2 text-2xl font-bold ${bal > 0 ? 'text-amber-700' : bal < 0 ? 'text-sky-700' : 'text-emerald-700'}`}>{BRL(bal)}</div>
              <div className="text-xs text-slate-400 mt-1">
                emprestou {BRL(t.lent)} · devolvido {BRL(t.returned)}
              </div>
              {bal < 0 && <div className="text-xs text-sky-700 mt-1">A empresa devolveu a mais.</div>}
              {bal === 0 && t.lent > 0 && <div className="text-xs text-emerald-700 mt-1">Quitado.</div>}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mb-4">
        <select className="input sm:w-72" value={lenderFilter} onChange={(e) => setLenderFilter(e.target.value)}>
          <option value={ALL}>Todos os sócios</option>
          {lenders.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : visible.length === 0 ? (
          <EmptyState icon={HandCoins} title="Nenhum lançamento" subtitle="Registre aqui quando um sócio pagar algo pela empresa, e quando a empresa devolver." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Data</th>
                  <th className="th">Sócio</th>
                  <th className="th">Tipo</th>
                  <th className="th">Descrição</th>
                  <th className="th text-right">Valor</th>
                  <th className="th text-right">Saldo do sócio</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/50 transition cursor-pointer" onClick={() => openEdit(e, true)}>
                    <td className="td text-slate-500 whitespace-nowrap">{formatDate(e.entry_date)}</td>
                    <td className="td font-medium text-slate-900">{e.lender}</td>
                    <td className="td">
                      {e.kind === 'Empréstimo'
                        ? <Badge tone="amber"><ArrowDownLeft size={12} /> Empréstimo</Badge>
                        : <Badge tone="green"><ArrowUpRight size={12} /> Devolução</Badge>}
                    </td>
                    <td className="td text-slate-600">{e.description || '—'}</td>
                    <td className={`td text-right font-semibold whitespace-nowrap ${e.kind === 'Empréstimo' ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {e.kind === 'Empréstimo' ? '+ ' : '− '}{BRL(e.amount)}
                    </td>
                    <td className="td text-right text-slate-700 whitespace-nowrap">{BRL(running.get(e.id) ?? 0)}</td>
                    <td className="td" onClick={(ev) => ev.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <button className="icon-btn" title="Editar" onClick={() => openEdit(e)}><Pencil size={15} /></button>
                        <button className="icon-btn hover:text-red-600" title="Excluir" onClick={() => setDeleteId(e.id)}><Trash2 size={15} /></button>
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
        <Modal title={viewing ? 'Consultar lançamento' : editing ? 'Editar lançamento' : 'Novo lançamento'} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            {formError && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{formError}</div>}
            <fieldset disabled={viewing} className="space-y-4 min-w-0">
              <div className="grid grid-cols-2 gap-2">
                {(['Empréstimo', 'Devolução'] as Kind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setForm({ ...form, kind: k })}
                    className={`rounded-xl border p-3 text-left transition ${form.kind === k
                      ? (k === 'Empréstimo' ? 'border-amber-400 bg-amber-50' : 'border-emerald-400 bg-emerald-50')
                      : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="text-sm font-semibold text-slate-800">{k}</div>
                    <div className="text-xs text-slate-500">
                      {k === 'Empréstimo' ? 'O sócio pagou algo pela empresa' : 'A empresa devolveu ao sócio'}
                    </div>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Sócio">
                  <input className="input" list="loan-lenders" value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} placeholder="Nome do sócio" />
                  <datalist id="loan-lenders">{lenders.map((l) => <option key={l} value={l} />)}</datalist>
                </Field>
                <Field label="Data">
                  <input type="date" className="input" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
                </Field>
              </div>
              <Field label="Valor (R$)">
                <input type="number" step="0.01" min={0} className="input" value={form.amount || ''} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
              </Field>
              <Field label="Descrição" hint={form.kind === 'Empréstimo' ? 'ex.: pagou COMP-0009 (fornecedor X)' : 'ex.: PIX de devolução'}>
                <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
              {!viewing && form.lender.trim() && (
                <p className={`text-xs ${overReturn ? 'text-amber-700' : 'text-slate-400'}`}>
                  Saldo atual devido a {form.lender.trim()}: {BRL(currentBalance)}
                  {overReturn && ' — esta devolução é maior que o saldo devido.'}
                </p>
              )}
            </fieldset>
            <ViewEditFooter viewing={viewing} saving={saving} onEdit={() => setViewing(false)} onClose={() => setOpen(false)} onSave={save} />
          </div>
        </Modal>
      )}

      {deleteId && (
        <Modal title="Excluir lançamento" onClose={() => setDeleteId(null)}>
          <ConfirmDelete message="Excluir este lançamento? O saldo do sócio será recalculado." onConfirm={remove} onCancel={() => setDeleteId(null)} />
        </Modal>
      )}
    </div>
  );
}
