import { useEffect, useMemo, useState } from 'react';
import { Wallet, CheckCircle2, Clock, AlertCircle, Bell, Search, Undo2, Barcode, Copy, Check, Loader2, RefreshCw, FileDown, Ban } from 'lucide-react';
import { supabase, type Installment, type Boleto, BRL, formatDate, functionErrorMessage } from '../lib/supabase';
import { Modal, Field, Badge, EmptyState, PageHeader } from './ui';

export default function Financial() {
  const [items, setItems] = useState<Installment[]>([]);
  const [boletos, setBoletos] = useState<Record<string, Boleto>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'paid' | 'today'>('all');
  const [query, setQuery] = useState('');
  const [baixa, setBaixa] = useState<Installment | null>(null);
  const [baixaDate, setBaixaDate] = useState(new Date().toISOString().slice(0, 10));
  const [baixaAmount, setBaixaAmount] = useState(0);
  const [baixaSaving, setBaixaSaving] = useState(false);
  const [error, setError] = useState('');
  const [emittingId, setEmittingId] = useState<string | null>(null);
  const [viewingBoleto, setViewingBoleto] = useState<Boleto | null>(null);
  const [boletoError, setBoletoError] = useState('');

  const loadBoletos = async () => {
    const { data } = await supabase.from('boletos').select('*').order('created_at', { ascending: false });
    const map: Record<string, Boleto> = {};
    for (const b of ((data as Boleto[]) ?? [])) {
      // Keep only the most recent boleto per installment (list is already newest-first).
      if (!map[b.installment_id]) map[b.installment_id] = b;
    }
    setBoletos(map);
  };

  // Parcela vencida: o Inter não aceita vencimento no passado, então
  // pedimos uma nova data só para o boleto antes de emitir.
  const [dueFor, setDueFor] = useState<Installment | null>(null);
  const [newDue, setNewDue] = useState('');

  const pedirEmissao = (i: Installment) => {
    if (i.due_date < today) {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      setNewDue(d.toLocaleDateString('en-CA'));
      setDueFor(i);
      return;
    }
    emitirBoleto(i.id);
  };

  const emitirBoleto = async (installmentId: string, vencimento?: string) => {
    setEmittingId(installmentId);
    setBoletoError('');
    const { data, error: e } = await supabase.functions.invoke('emit-boleto', { body: { installment_id: installmentId, vencimento } });
    setEmittingId(null);
    if (e || data?.error) { setBoletoError(data?.error || (await functionErrorMessage(e)) || 'Falha ao emitir boleto.'); await loadBoletos(); return; }
    await loadBoletos();
    if (data?.boleto) setViewingBoleto(data.boleto as Boleto);
  };

  const load = async () => {
    setLoading(true);
    let res = await supabase
      .from('installments')
      .select('*, customer:customer_id(*), sale:sale_id(*)')
      .eq('reference_type', 'sale')
      .order('due_date', { ascending: true });
    if (res.error && /relationship.*schema cache/i.test(res.error.message)) {
      res = await supabase.from('installments').select('*').eq('reference_type', 'sale').order('due_date', { ascending: true });
    }
    setItems((res.data as Installment[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); loadBoletos(); }, []);

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
        (i.customer?.name ?? '').toLowerCase().includes(q) ||
        String(i.installment_number).includes(q)
      );
    }
    return list;
  }, [items, filter, query, today]);

  const totalPaid = items.reduce((s, i) => s + Number(i.paid_amount || 0), 0);
  const totalPending = items.filter((i) => !i.paid && !isOverdue(i)).reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount || 0)), 0);
  const totalOverdue = items.filter(isOverdue).reduce((s, i) => s + (Number(i.amount) - Number(i.paid_amount || 0)), 0);
  const dueTodayCount = items.filter(isDueToday).length;
  const overdueCount = items.filter(isOverdue).length;

  const openBaixa = (i: Installment) => {
    setBaixa(i);
    setBaixaDate(today);
    const remaining = Number(i.amount) - Number(i.paid_amount || 0);
    setBaixaAmount(Math.max(remaining, 0));
    setError('');
  };

  const confirmBaixa = async () => {
    if (!baixa) return;
    if (baixaAmount <= 0) { setError('Informe um valor maior que zero.'); return; }
    const alreadyPaid = Number(baixa.paid_amount || 0);
    const remaining = Number(baixa.amount) - alreadyPaid;
    if (baixaAmount > remaining + 0.01) {
      setError(`O valor não pode ser maior que o saldo restante (${BRL(remaining)}).`);
      return;
    }
    const newPaidAmount = alreadyPaid + baixaAmount;
    const isFullyPaid = newPaidAmount >= Number(baixa.amount) - 0.01;
    setBaixaSaving(true);
    const { error } = await supabase.from('installments').update({
      paid: isFullyPaid,
      paid_date: baixaDate,
      paid_amount: newPaidAmount,
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
      <PageHeader title="Contas a Receber" subtitle="Gestão de parcelas e inadimplência." />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Recebido</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center"><CheckCircle2 size={18} className="text-emerald-600" /></div>
          </div>
          <div className="mt-3 text-2xl font-bold text-slate-900">{BRL(totalPaid)}</div>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">A receber</span>
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
          <input className="input pl-10" placeholder="Buscar cliente..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Wallet} title="Nenhuma parcela encontrada" subtitle="As parcelas aparecem aqui quando vendas parceladas são registradas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="th">Cliente</th>
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
                      <td className="td font-medium text-slate-900">{i.customer?.name ?? '—'}</td>
                      <td className="td text-slate-500">
                        <div className="flex items-center gap-1.5">
                          {formatDate(i.due_date)}
                          {dueToday && <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">hoje</span>}
                          {overdue && <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">atrasada</span>}
                        </div>
                      </td>
                      <td className="td text-slate-600">#{i.installment_number}</td>
                      <td className="td">
                        {i.paid ? <Badge tone="green">Pago</Badge> : Number(i.paid_amount || 0) > 0 ? <Badge tone="blue">Parcial</Badge> : overdue ? <Badge tone="red">Atrasado</Badge> : dueToday ? <Badge tone="amber">Vence hoje</Badge> : <Badge tone="blue">Pendente</Badge>}
                      </td>
                      <td className="td text-right">
                        <div className="font-semibold text-slate-900">{BRL(i.paid ? i.paid_amount : i.amount)}</div>
                        {!i.paid && Number(i.paid_amount || 0) > 0 && (
                          <div className="text-xs font-normal text-blue-600">restam {BRL(Number(i.amount) - Number(i.paid_amount || 0))}</div>
                        )}
                      </td>
                      <td className="td text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {(!i.paid || boletos[i.id]?.status === 'Pago') && (
                            boletos[i.id] && ACTIVE_STATUSES.includes(boletos[i.id].status) ? (
                              <button
                                onClick={() => setViewingBoleto(boletos[i.id])}
                                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-sky-600 hover:bg-sky-50 transition inline-flex items-center gap-1"
                              >
                                <Barcode size={13} />
                                {BOLETO_LABEL[boletos[i.id].status] ?? 'Ver boleto'}
                              </button>
                            ) : i.paid ? null : (
                              <button
                                onClick={() => pedirEmissao(i)}
                                disabled={emittingId === i.id}
                                className="text-xs font-semibold px-3 py-1.5 rounded-lg text-sky-600 hover:bg-sky-50 transition inline-flex items-center gap-1"
                              >
                                {emittingId === i.id ? <Loader2 size={13} className="animate-spin" /> : <Barcode size={13} />}
                                Emitir boleto
                              </button>
                            )
                          )}
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
                              {Number(i.paid_amount || 0) > 0 ? 'Completar pagamento' : 'Dar baixa'}
                            </button>
                          )}
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

      {baixa && (
        <Modal title="Dar baixa na parcela" onClose={() => setBaixa(null)}>
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-xl p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Cliente</span>
                <span className="font-medium text-slate-900">{baixa.customer?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-slate-500">Parcela</span>
                <span className="font-medium text-slate-900">#{baixa.installment_number} · {formatDate(baixa.due_date)}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-slate-500">Valor total</span>
                <span className="font-medium text-slate-900">{BRL(baixa.amount)}</span>
              </div>
              {Number(baixa.paid_amount || 0) > 0 && (
                <>
                  <div className="flex justify-between mt-1">
                    <span className="text-slate-500">Já pago</span>
                    <span className="font-medium text-emerald-600">{BRL(baixa.paid_amount)}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-slate-500">Saldo restante</span>
                    <span className="font-semibold text-slate-900">{BRL(Number(baixa.amount) - Number(baixa.paid_amount || 0))}</span>
                  </div>
                </>
              )}
            </div>
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
            <Field label="Data do pagamento">
              <input type="date" className="input" value={baixaDate} onChange={(e) => setBaixaDate(e.target.value)} />
            </Field>
            <Field label="Valor pago agora (R$)" hint="pode ser parcial — o saldo continua em aberto até completar">
              <input type="number" step="0.01" className="input" value={baixaAmount} onChange={(e) => setBaixaAmount(Number(e.target.value))} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setBaixa(null)}>Cancelar</button>
              <button className="btn-primary" disabled={baixaSaving} onClick={confirmBaixa}>{baixaSaving ? 'Salvando...' : 'Confirmar baixa'}</button>
            </div>
          </div>
        </Modal>
      )}

      {dueFor && (
        <Modal title="Parcela vencida — nova data do boleto" onClose={() => setDueFor(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              A parcela #{dueFor.installment_number} de <strong>{dueFor.customer?.name ?? 'cliente'}</strong> venceu em {formatDate(dueFor.due_date)}.
              O banco não aceita boleto com vencimento no passado — escolha a nova data de vencimento do boleto.
              A data da parcela no sistema não muda.
            </p>
            <Field label="Vencimento do boleto">
              <input type="date" className="input" min={today} value={newDue} onChange={(e) => setNewDue(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDueFor(null)}>Cancelar</button>
              <button
                className="btn-primary"
                disabled={!newDue || newDue < today}
                onClick={() => { const id = dueFor.id; setDueFor(null); emitirBoleto(id, newDue); }}
              >
                <Barcode size={15} /> Emitir boleto
              </button>
            </div>
          </div>
        </Modal>
      )}

      {boletoError && (
        <Modal title="Não foi possível emitir o boleto" onClose={() => setBoletoError('')}>
          <div className="space-y-4">
            <div className="text-sm text-red-700 bg-red-50 rounded-lg p-3 break-words">{boletoError}</div>
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setBoletoError('')}>Entendi</button>
            </div>
          </div>
        </Modal>
      )}

      {viewingBoleto && (        <BoletoModal
          boleto={viewingBoleto}
          onChanged={(b) => { setViewingBoleto(b); loadBoletos(); }}
          onClose={() => setViewingBoleto(null)}
        />
      )}
    </div>
  );
}

// Boletos que ainda "valem" para a parcela; Cancelado/Expirado/Erro liberam nova emissão.
const ACTIVE_STATUSES = ['Simulado', 'Processando', 'Emitido', 'Pago'];
const BOLETO_LABEL: Record<string, string> = {
  Simulado: 'Boleto (simulado)',
  Processando: 'Boleto (processando)',
  Emitido: 'Ver boleto',
  Pago: 'Boleto pago',
};
const STATUS_TONE: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'blue'> = {
  Simulado: 'amber', Processando: 'blue', Emitido: 'blue', Pago: 'green', Cancelado: 'slate', Expirado: 'slate', Erro: 'red',
};

function BoletoModal({ boleto, onChanged, onClose }: { boleto: Boleto; onChanged: (b: Boleto) => void; onClose: () => void }) {
  const [copied, setCopied] = useState<'linha' | 'pix' | null>(null);
  const [busy, setBusy] = useState<'refresh' | 'pdf' | 'cancel' | null>(null);
  const [err, setErr] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [motivo, setMotivo] = useState('');

  const copy = (text: string, which: 'linha' | 'pix') => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  const call = async (action: 'refresh' | 'pdf' | 'cancel', extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setErr('');
    const { data, error } = await supabase.functions.invoke('emit-boleto', { body: { action, boleto_id: boleto.id, ...extra } });
    setBusy(null);
    if (error || data?.error) { setErr(data?.error || (await functionErrorMessage(error)) || 'Falha na operação.'); return null; }
    return data;
  };

  const refresh = async () => { const d = await call('refresh'); if (d?.boleto) onChanged(d.boleto); };
  const cancel = async () => {
    const d = await call('cancel', { motivo });
    if (d?.boleto) { setConfirmCancel(false); onChanged(d.boleto); }
  };
  const downloadPdf = async () => {
    const d = await call('pdf');
    if (!d?.pdf) return;
    const bytes = Uint8Array.from(atob(d.pdf), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `boleto-${boleto.seu_numero ?? boleto.id.slice(0, 8)}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const real = boleto.status !== 'Simulado';
  const canCancel = ['Simulado', 'Processando', 'Emitido'].includes(boleto.status);

  return (
    <Modal title="Boleto + PIX" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Badge tone={STATUS_TONE[boleto.status] ?? 'slate'}>{boleto.status}</Badge>
          {boleto.situacao && <span className="text-xs text-slate-400">Inter: {boleto.situacao}</span>}
        </div>
        {boleto.status === 'Simulado' && (
          <div className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
            ⚠️ Este é um boleto <strong>simulado</strong> — as credenciais do Banco Inter ainda não foram configuradas em Configurações. Nenhuma cobrança real foi gerada; os números abaixo não são válidos para pagamento.
          </div>
        )}
        {boleto.status === 'Processando' && (
          <div className="text-sm text-sky-700 bg-sky-50 rounded-lg p-3">
            O Inter recebeu a cobrança e ainda está gerando o boleto. Clique em <strong>Atualizar</strong> em alguns segundos.
          </div>
        )}
        {boleto.status === 'Erro' && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 break-words">Falha ao emitir: {boleto.erro_mensagem}</div>
        )}
        {err && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 break-words">{err}</div>}

        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Valor</span>
          <span className="font-semibold text-slate-900">{BRL(boleto.valor)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Vencimento</span>
          <span className="font-semibold text-slate-900">{formatDate(boleto.vencimento)}</span>
        </div>
        {boleto.nosso_numero && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Nosso número</span>
            <span className="font-mono text-slate-700">{boleto.nosso_numero}</span>
          </div>
        )}
        {boleto.linha_digitavel && (
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Linha digitável</label>
            <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-3 mt-1">
              <code className="flex-1 text-xs font-mono text-slate-800 select-all break-all">{boleto.linha_digitavel}</code>
              <button className="icon-btn shrink-0" onClick={() => copy(boleto.linha_digitavel!, 'linha')}>
                {copied === 'linha' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}
        {boleto.pix_copia_cola && (
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pix copia e cola</label>
            <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-3 mt-1">
              <code className="flex-1 text-xs font-mono text-slate-800 select-all break-all">{boleto.pix_copia_cola}</code>
              <button className="icon-btn shrink-0" onClick={() => copy(boleto.pix_copia_cola!, 'pix')}>
                {copied === 'pix' ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}

        {confirmCancel ? (
          <div className="border border-red-200 bg-red-50/60 rounded-xl p-3 space-y-3">
            <p className="text-sm text-red-700">
              Cancelar este boleto{real ? ' no Banco Inter' : ''}? O cliente não conseguirá mais pagá-lo. Depois você pode emitir um novo para a parcela.
            </p>
            <input className="input" placeholder="Motivo (opcional)" maxLength={50} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setConfirmCancel(false)}>Voltar</button>
              <button className="btn-danger" disabled={busy === 'cancel'} onClick={cancel}>
                {busy === 'cancel' ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />} Confirmar cancelamento
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            {canCancel && (
              <button className="btn-ghost text-red-600 hover:bg-red-50 mr-auto" onClick={() => setConfirmCancel(true)}>
                <Ban size={15} /> Cancelar boleto
              </button>
            )}
            {real && boleto.codigo_solicitacao && (
              <button className="btn-secondary" disabled={!!busy} onClick={refresh}>
                {busy === 'refresh' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Atualizar
              </button>
            )}
            {real && boleto.linha_digitavel && (
              <button className="btn-secondary" disabled={!!busy} onClick={downloadPdf}>
                {busy === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} Baixar PDF
              </button>
            )}
            <button className="btn-primary" onClick={onClose}>Fechar</button>
          </div>
        )}
      </div>
    </Modal>
  );
}