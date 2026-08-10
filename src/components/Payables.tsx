import { useEffect, useMemo, useState } from 'react';
import { Wallet, CheckCircle2, Clock, AlertCircle, Bell, Search, Undo2 } from 'lucide-react';
import { supabase, type Installment, BRL, formatDate } from '../lib/supabase';
import { Modal, Field, Badge, EmptyState, PageHeader } from './ui';

export default function Payables() {
  const [items, setItems] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'paid' | 'today'>('all');
  const [query, setQuery] = useState('');
  const [baixa, setBaixa] = useState<Installment | null>(null);
  const [baixaDate, setBaixaDate] = useState(new Date().toISOString().slice(0, 10));
  const [baixaAmount, setBaixaAmount] = useState(0);
  const [baixaSaving, setBaixaSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    let res = await supabase
      .from('installments')
      .select('*, supplier:supplier_id(*), purchase:purchase_id(*), maintenance:maintenance_id(*, part:part_id(*))')
      .in('reference_type', ['purchase', 'maintenance'])
      .order('due_date', { ascending: true });
    if (res.error && /relationship.*schema cache/i.test(res.error.message)) {
      res = await supabase.from('installments').select('*').in('reference_type', ['purchase', 'maintenance']).order('due_date', { ascending: true });
    }
    setItems((res.data as Installment[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (i: Installment) => !i.paid && i.due_date < today;
  const isDueToday = (i: Installment) => !i.paid && i.due_date === today;

  const filtered = useMemo(() => {
    let list = items;
    if (filter === 'paid') list = list.filter((i) => i.paid);
    else if (filter === 'pending') list = list.filter((i) => !i.paid && !isOverdue(i) && !isDueToday(i));
    else if (filter === 'overdue') list = list.filter(isOverdue);
    else if (filter === 'today') list = list.filter(isDueToday);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        (i.supplier?.name ?? '').toLowerCase().includes(q) ||
        (i.maintenance?.part?.name ?? '').toLowerCase().includes(q) ||
        (i.maintenance?.provider ?? '').toLowerCase().includes(q) ||
        String(i.installment_number).includes(q)
      );
    }
    return list;
  }, [items, filter, query, today]);

  const totalPaid = items.filter((i) => i.paid).reduce((s, i) => s + Number(i.paid_amount), 0);
  const totalPending = items.filter((i) => !i.paid && !isOverdue(i)).reduce((s, i) => s + Number(i.amount), 0);
  const totalOverdue = items.filter(isOverdue).reduce((s, i) => s + Number(i.amount), 0);
  const dueTodayCount = items.filter(isDueToday).length;
  const overdueCount = items.filter(isOverdue).length;

  const openBaixa = (i: Installment) => {
    setBaixa(i);
    setBaixaDate(today);
    setBaixaAmount(Number(i.amount));
    setError('');
  };

  const confirmBaixa = async () => {
    if (!baixa) return;
    if (baixaAmount <= 0) { setError('Informe um valor maior que zero.'); return; }
    setBaixaSaving(true);
    const { error } = await supabase.from('installments').update({
      paid: true,
      paid_date: baixaDate,
      paid_amount: baixaAmount,
    }).eq('id', baixa.id);
    setBaixaSaving(false);
    if (error) { setError(error.message); return; }
    setBaixa(null);
    load();
  };

  const estornar = async (i: Installment) => {
    await supabase.from('installments').update({
      paid: false,
      paid_date: null,
      paid_amount: 0,
    }).eq('id', i.id);
    load();
  };

  const filters = [
    { id: 'all' as const, label: 'Todas', count: items.length },
    { id: 'today' as const, label: 'Vencem hoje', count: dueTodayCount },
    { id: 'overdue' as const, label: 'Atrasadas', count: overdueCount },
    { id: 'pending' as const, label: 'Pendentes', count: items.filter((i) => !i.paid && !isOverdue(i) && !isDueToday(i)).length },
    { id: 'paid' as const, label: 'Pagas', count: items.filter((i) => i.paid).length },
  ];

  return (
    <div>
      <PageHeader title="Contas a Pagar" subtitle="Gestão de parcelas de compras e vencimentos." />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Pago</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center"><CheckCircle2 size={18} className="text-emerald-600" /></div>
          </div>
          <div className="mt-3 text-2xl font-bold text-slate-900">{BRL(totalPaid)}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">A pagar</span>
            <div className="w-9 h-9 rounded-xl bg-sky-100 flex items-center justify-center"><Clock size={18} className="text-sky-600" /></div>
          </div>
          <div className="mt-3 text-2xl font-bold text-slate-900">{BRL(totalPending)}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Atrasado</span>
            <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center"><AlertCircle size={18} className="text-red-600" /></div>
          </div>
          <div className="mt-3 text-2xl font-bold text-slate-900">{BRL(totalOverdue)}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Vencem hoje</span>
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center"><Bell size={18} className="text-amber-600" /></div>
          </div>
          <div className="mt-3 text-2xl font-bold text-slate-900">{dueTodayCount}</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex gap-2 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3.5 py-2 rounded-xl text-sm font-medium transition ${
                filter === f.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label} <span className={filter === f.id ? 'text-slate-300' : 'text-slate-400'}>({f.count})</span>
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input className="input pl-10" placeholder="Buscar fornecedor, peça ou prestador..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Wallet} title="Nenhuma parcela encontrada" subtitle="As parcelas aparecem aqui quando compras (à vista ou parceladas) são registradas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Origem</th>
                  <th className="th">Vencimento</th>
                  <th className="th">Parcela</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Valor</th>
                  <th className="th text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((i) => {
                  const overdue = isOverdue(i);
                  const dueToday = isDueToday(i);
                  return (
                    <tr key={i.id} className="hover:bg-slate-50/50 transition">
                      <td className="td font-medium text-slate-900">
                        {i.reference_type === 'maintenance' ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              🔧 {i.maintenance?.part?.name ?? 'Manutenção'}
                              {i.maintenance?.part?.brand && <span className="text-xs font-normal text-slate-400">— {i.maintenance.part.brand}</span>}
                            </div>
                            {i.maintenance?.provider && <div className="text-xs font-normal text-slate-400">{i.maintenance.provider}</div>}
                          </>
                        ) : (
                          i.supplier?.name ?? '—'
                        )}
                      </td>
                      <td className="td text-slate-500">
                        <div className="flex items-center gap-1.5">
                          {formatDate(i.due_date)}
                          {dueToday && <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">hoje</span>}
                          {overdue && <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">atrasada</span>}
                        </div>
                      </td>
                      <td className="td text-slate-600">#{i.installment_number}</td>
                      <td className="td">
                        {i.paid ? <Badge tone="green">Pago</Badge> : overdue ? <Badge tone="red">Atrasado</Badge> : dueToday ? <Badge tone="amber">Vence hoje</Badge> : <Badge tone="blue">Pendente</Badge>}
                      </td>
                      <td className="td text-right font-semibold text-slate-900">{BRL(i.paid ? i.paid_amount : i.amount)}</td>
                      <td className="td text-right">
                        {i.paid ? (
                          <button
                            onClick={() => estornar(i)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition inline-flex items-center gap-1"
                          >
                            <Undo2 size={13} /> Estornar
                          </button>
                        ) : (
                          <button
                            onClick={() => openBaixa(i)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition"
                          >
                            Dar baixa
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {baixa && (
        <Modal title="Dar baixa na parcela" onClose={() => setBaixa(null)}>
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-xl p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">{baixa.reference_type === 'maintenance' ? 'Manutenção' : 'Fornecedor'}</span>
                <span className="font-medium text-slate-900 inline-flex items-center gap-1.5">
                  {baixa.reference_type === 'maintenance'
                    ? <>
                        {baixa.maintenance?.part?.name ?? 'Manutenção'}
                        {baixa.maintenance?.part?.brand && <span className="text-slate-400 font-normal">— {baixa.maintenance.part.brand}</span>}
                        {baixa.maintenance?.provider && <span className="text-slate-400 font-normal">· {baixa.maintenance.provider}</span>}
                      </>
                    : (baixa.supplier?.name ?? '—')}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-slate-500">Parcela</span>
                <span className="font-medium text-slate-900">#{baixa.installment_number} · {formatDate(baixa.due_date)}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-slate-500">Valor total</span>
                <span className="font-medium text-slate-900">{BRL(baixa.amount)}</span>
              </div>
            </div>
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            <Field label="Data do pagamento">
              <input type="date" className="input" value={baixaDate} onChange={(e) => setBaixaDate(e.target.value)} />
            </Field>
            <Field label="Valor pago (R$)" hint="pode ser parcial">
              <input type="number" step="0.01" className="input" value={baixaAmount} onChange={(e) => setBaixaAmount(Number(e.target.value))} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setBaixa(null)}>Cancelar</button>
              <button className="btn-primary" disabled={baixaSaving} onClick={confirmBaixa}>{baixaSaving ? 'Salvando...' : 'Confirmar baixa'}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
