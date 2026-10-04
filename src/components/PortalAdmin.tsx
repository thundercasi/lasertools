import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, AlertTriangle, CalendarClock, Boxes, Inbox } from 'lucide-react';
import { supabase, type Part, formatDate } from '../lib/supabase';
import { Modal, Field, EmptyState, PageHeader, ConfirmDelete, Badge } from './ui';

// Staff side of the customer portal: the reference data customers read
// (error codes, preventive templates, part consumption per model) and the
// quote requests they send from "Estoque sugerido".

type Tab = 'quotes' | 'errors' | 'templates' | 'recommendations';

type ErrorCode = {
  id: string; brand: string | null; machine_model: string | null; code: string; title: string;
  description: string | null; causes: string | null; solution: string | null;
  severity: 'baixa' | 'media' | 'alta'; related_part_ids: string[];
};
type Template = {
  id: string; brand: string | null; machine_model: string; title: string; description: string | null;
  interval_days: number; part_ids: string[];
};
type Recommendation = {
  id: string; machine_model: string; part_id: string; qty_per_equipment: number; period_days: number; notes: string | null;
};
type QuoteRequest = {
  id: string; customer_id: string; items: { part_name: string; part_number: string | null; sku: string; quantity: number }[];
  notes: string | null; status: string; created_at: string; customer?: { name: string } | null;
};

const QUOTE_STATUS = ['Nova', 'Em análise', 'Orçamento enviado', 'Fechada', 'Cancelada'];
const SEVERITY_TONE = { baixa: 'slate', media: 'amber', alta: 'red' } as const;

function PartPicker({ parts, value, onChange }: { parts: Part[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState('');
  const list = parts.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.part_number ?? '').toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="rounded-xl border border-slate-200">
      <input className="input !border-0 !rounded-b-none border-b" placeholder="Filtrar peças…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-40 overflow-y-auto p-2 space-y-1 border-t border-slate-100">
        {list.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={value.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
            {p.name}{p.part_number ? <span className="text-xs text-slate-400">· {p.part_number}</span> : null}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function PortalAdmin() {
  const [tab, setTab] = useState<Tab>('quotes');
  const [parts, setParts] = useState<Part[]>([]);
  const [codes, setCodes] = useState<ErrorCode[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ kind: Exclude<Tab, 'quotes'>; row: Record<string, any> } | null>(null);
  const [deleting, setDeleting] = useState<{ table: string; id: string } | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    const [p, c, t, r, q] = await Promise.all([
      supabase.from('parts').select('*').order('name'),
      supabase.from('error_codes').select('*').order('code'),
      supabase.from('maintenance_plan_templates').select('*').order('machine_model'),
      supabase.from('model_part_recommendations').select('*').order('machine_model'),
      supabase.from('quote_requests').select('*, customer:customer_id(name)').order('created_at', { ascending: false }),
    ]);
    setParts((p.data as Part[]) ?? []);
    setCodes((c.data as ErrorCode[]) ?? []);
    setTemplates((t.data as Template[]) ?? []);
    setRecs((r.data as Recommendation[]) ?? []);
    setQuotes((q.data as QuoteRequest[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const partName = useMemo(() => new Map(parts.map((p) => [p.id, p.name])), [parts]);
  const models = useMemo(() => {
    const s = new Set<string>();
    parts.forEach((p) => p.machine_model && s.add(p.machine_model));
    templates.forEach((t) => s.add(t.machine_model));
    codes.forEach((c) => c.machine_model && s.add(c.machine_model));
    return [...s].sort();
  }, [parts, templates, codes]);

  const TABLE: Record<Exclude<Tab, 'quotes'>, string> = {
    errors: 'error_codes', templates: 'maintenance_plan_templates', recommendations: 'model_part_recommendations',
  };

  const save = async () => {
    if (!editing) return;
    setError('');
    const { id, ...row } = editing.row;
    for (const k of Object.keys(row)) if (row[k] === '') row[k] = null;
    const table = TABLE[editing.kind];
    const res = id ? await supabase.from(table).update(row).eq('id', id) : await supabase.from(table).insert(row);
    if (res.error) { setError(res.error.message); return; }
    setEditing(null);
    load();
  };

  const remove = async () => {
    if (!deleting) return;
    await supabase.from(deleting.table).delete().eq('id', deleting.id);
    setDeleting(null);
    load();
  };

  const setQuoteStatus = async (id: string, status: string) => {
    setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, status } : q)));
    await supabase.from('quote_requests').update({ status }).eq('id', id);
  };

  const newRow = (kind: Exclude<Tab, 'quotes'>) => {
    const defaults = {
      errors: { code: '', title: '', brand: '', machine_model: '', description: '', causes: '', solution: '', severity: 'media', related_part_ids: [] },
      templates: { title: '', brand: '', machine_model: '', description: '', interval_days: 90, part_ids: [] },
      recommendations: { machine_model: '', part_id: '', qty_per_equipment: 1, period_days: 365, notes: '' },
    }[kind];
    setError('');
    setEditing({ kind, row: defaults });
  };

  const set = (k: string, v: unknown) => editing && setEditing({ ...editing, row: { ...editing.row, [k]: v } });
  const r = editing?.row ?? {};
  const openQuotes = quotes.filter((q) => q.status === 'Nova' || q.status === 'Em análise').length;

  const tabs: { id: Tab; label: string; icon: typeof Inbox; count: number }[] = [
    { id: 'quotes', label: 'Orçamentos', icon: Inbox, count: openQuotes },
    { id: 'errors', label: 'Códigos de erro', icon: AlertTriangle, count: codes.length },
    { id: 'templates', label: 'Planos padrão', icon: CalendarClock, count: templates.length },
    { id: 'recommendations', label: 'Consumo por modelo', icon: Boxes, count: recs.length },
  ];

  return (
    <div>
      <PageHeader
        title="Portal do Cliente"
        subtitle="Base de conhecimento e recomendações que os clientes veem no portal"
        action={tab !== 'quotes' && <button className="btn-primary" onClick={() => newRow(tab)}><Plus size={16} /> Novo</button>}
      />

      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto mb-4 w-fit max-w-full">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            <t.icon size={15} /> {t.label} <span className="text-xs text-slate-400">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : tab === 'quotes' ? (
          quotes.length === 0 ? <EmptyState icon={Inbox} title="Nenhuma solicitação" subtitle="Clientes pedem orçamento a partir do Estoque sugerido no portal." /> : (
            <div className="divide-y divide-slate-100">
              {quotes.map((q) => (
                <div key={q.id} className="p-5">
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <span className="font-semibold text-slate-900">{q.customer?.name ?? '—'}</span>
                    <span className="text-xs text-slate-400">{formatDate(q.created_at)}</span>
                    <select className="input !w-auto !py-1.5 ml-auto text-xs" value={q.status} onChange={(e) => setQuoteStatus(q.id, e.target.value)}>
                      {QUOTE_STATUS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <ul className="text-sm text-slate-700 space-y-0.5">
                    {q.items.map((i, idx) => <li key={idx}>{i.quantity}× {i.part_name} <span className="text-xs text-slate-400">{i.part_number ?? i.sku}</span></li>)}
                  </ul>
                  {q.notes && <p className="text-xs text-slate-500 mt-2">Obs.: {q.notes}</p>}
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                {tab === 'errors' && <tr><th className="th">Código</th><th className="th">Título</th><th className="th">Modelo</th><th className="th">Gravidade</th><th className="th" /></tr>}
                {tab === 'templates' && <tr><th className="th">Plano</th><th className="th">Modelo</th><th className="th">Intervalo</th><th className="th">Peças</th><th className="th" /></tr>}
                {tab === 'recommendations' && <tr><th className="th">Modelo</th><th className="th">Peça</th><th className="th">Qtd / equipamento</th><th className="th">A cada</th><th className="th" /></tr>}
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tab === 'errors' && codes.map((c) => (
                  <tr key={c.id}>
                    <td className="td font-mono font-semibold">{c.code}</td>
                    <td className="td">{c.title}</td>
                    <td className="td text-slate-500">{c.machine_model || 'Todos'}</td>
                    <td className="td"><Badge tone={SEVERITY_TONE[c.severity]}>{c.severity}</Badge></td>
                    <Actions onEdit={() => setEditing({ kind: 'errors', row: { ...c } })} onDelete={() => setDeleting({ table: 'error_codes', id: c.id })} />
                  </tr>
                ))}
                {tab === 'templates' && templates.map((t) => (
                  <tr key={t.id}>
                    <td className="td font-medium">{t.title}</td>
                    <td className="td text-slate-500">{t.machine_model}</td>
                    <td className="td">{t.interval_days} dias</td>
                    <td className="td text-xs text-slate-500">{t.part_ids.map((id) => partName.get(id)).filter(Boolean).join(', ') || '—'}</td>
                    <Actions onEdit={() => setEditing({ kind: 'templates', row: { ...t } })} onDelete={() => setDeleting({ table: 'maintenance_plan_templates', id: t.id })} />
                  </tr>
                ))}
                {tab === 'recommendations' && recs.map((x) => (
                  <tr key={x.id}>
                    <td className="td">{x.machine_model}</td>
                    <td className="td font-medium">{partName.get(x.part_id) ?? '—'}</td>
                    <td className="td">{Number(x.qty_per_equipment)}</td>
                    <td className="td">{x.period_days} dias</td>
                    <Actions onEdit={() => setEditing({ kind: 'recommendations', row: { ...x } })} onDelete={() => setDeleting({ table: 'model_part_recommendations', id: x.id })} />
                  </tr>
                ))}
              </tbody>
            </table>
            {((tab === 'errors' && !codes.length) || (tab === 'templates' && !templates.length) || (tab === 'recommendations' && !recs.length)) && (
              <EmptyState icon={Boxes} title="Nada cadastrado ainda" subtitle={
                tab === 'recommendations'
                  ? 'Ex.: modelo X consome 2 lentes de proteção por equipamento a cada 90 dias. Isso gera a sugestão de estoque dos clientes.'
                  : tab === 'templates' ? 'Planos preventivos que o cliente aplica com um clique no equipamento do mesmo modelo.' : 'Códigos de erro com causa e solução, consultados pelos clientes.'
              } />
            )}
          </div>
        )}
      </div>

      <datalist id="portal-models">{models.map((m) => <option key={m} value={m} />)}</datalist>

      {editing && (
        <Modal title={r.id ? 'Editar' : 'Novo'} onClose={() => setEditing(null)} wide>
          <div className="space-y-4">
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            {editing.kind === 'errors' && (
              <>
                <div className="grid sm:grid-cols-3 gap-4">
                  <Field label="Código"><input className="input" value={r.code ?? ''} onChange={(e) => set('code', e.target.value)} /></Field>
                  <Field label="Modelo" hint="(vazio = todos)"><input className="input" list="portal-models" value={r.machine_model ?? ''} onChange={(e) => set('machine_model', e.target.value)} /></Field>
                  <Field label="Gravidade">
                    <select className="input" value={r.severity} onChange={(e) => set('severity', e.target.value)}>
                      <option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option>
                    </select>
                  </Field>
                </div>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2"><Field label="Título"><input className="input" value={r.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field></div>
                  <Field label="Marca"><input className="input" value={r.brand ?? ''} onChange={(e) => set('brand', e.target.value)} /></Field>
                </div>
                <Field label="Descrição"><textarea className="input" rows={2} value={r.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
                <Field label="Causas prováveis"><textarea className="input" rows={3} value={r.causes ?? ''} onChange={(e) => set('causes', e.target.value)} /></Field>
                <Field label="Como resolver"><textarea className="input" rows={3} value={r.solution ?? ''} onChange={(e) => set('solution', e.target.value)} /></Field>
                <Field label="Peças relacionadas"><PartPicker parts={parts} value={r.related_part_ids ?? []} onChange={(v) => set('related_part_ids', v)} /></Field>
              </>
            )}
            {editing.kind === 'templates' && (
              <>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2"><Field label="Nome do plano"><input className="input" value={r.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field></div>
                  <Field label="Intervalo (dias)"><input type="number" min={1} className="input" value={r.interval_days} onChange={(e) => set('interval_days', Number(e.target.value))} /></Field>
                  <Field label="Modelo"><input className="input" list="portal-models" value={r.machine_model ?? ''} onChange={(e) => set('machine_model', e.target.value)} /></Field>
                  <Field label="Marca"><input className="input" value={r.brand ?? ''} onChange={(e) => set('brand', e.target.value)} /></Field>
                </div>
                <Field label="Descrição / checklist"><textarea className="input" rows={3} value={r.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
                <Field label="Peças normalmente trocadas"><PartPicker parts={parts} value={r.part_ids ?? []} onChange={(v) => set('part_ids', v)} /></Field>
              </>
            )}
            {editing.kind === 'recommendations' && (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Modelo do equipamento"><input className="input" list="portal-models" value={r.machine_model ?? ''} onChange={(e) => set('machine_model', e.target.value)} /></Field>
                <Field label="Peça">
                  <select className="input" value={r.part_id ?? ''} onChange={(e) => set('part_id', e.target.value)}>
                    <option value="">Selecione…</option>
                    {parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
                <Field label="Qtd por equipamento"><input type="number" min={0.001} step="0.5" className="input" value={r.qty_per_equipment} onChange={(e) => set('qty_per_equipment', Number(e.target.value))} /></Field>
                <Field label="A cada (dias)"><input type="number" min={1} className="input" value={r.period_days} onChange={(e) => set('period_days', Number(e.target.value))} /></Field>
                <div className="sm:col-span-2"><Field label="Observações"><input className="input" value={r.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field></div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn-primary" onClick={save}>Salvar</button>
            </div>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal title="Excluir" onClose={() => setDeleting(null)}>
          <ConfirmDelete message="Excluir este registro? Os clientes deixam de vê-lo no portal." onConfirm={remove} onCancel={() => setDeleting(null)} />
        </Modal>
      )}
    </div>
  );
}

function Actions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <td className="td">
      <div className="flex justify-end gap-1">
        <button className="icon-btn" onClick={onEdit}><Pencil size={15} /></button>
        <button className="icon-btn hover:text-red-600" onClick={onDelete}><Trash2 size={15} /></button>
      </div>
    </td>
  );
}
