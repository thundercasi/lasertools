import { useEffect, useState } from 'react';
import {
  Boxes, ShoppingCart, Receipt, AlertTriangle, TrendingUp, Wallet, BellRing,
} from 'lucide-react';
import { supabase, type Part, type Sale, type Installment, BRL, formatDate } from '../lib/supabase';
import { StatCard, Modal, Field } from './ui';

export default function Dashboard() {
  const [parts, setParts] = useState<Part[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [alerts, setAlerts] = useState<Installment[]>([]);
  const [saleItems, setSaleItems] = useState<{ sale_id: string; unit_cost: number; unit_price: number; quantity: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [baixa, setBaixa] = useState<Installment | null>(null);
  const [baixaDate, setBaixaDate] = useState(new Date().toISOString().slice(0, 10));
  const [baixaAmount, setBaixaAmount] = useState(0);
  const [baixaSaving, setBaixaSaving] = useState(false);

  const loadAlerts = async () => {
    const { data } = await supabase
      .from('installments')
      .select('*, customer:customer_id(*)')
      .eq('paid', false)
      .order('due_date', { ascending: true });
    const all = (data as Installment[]) ?? [];
    const today = new Date().toISOString().slice(0, 10);
    setAlerts(all.filter((i) => i.due_date <= today));
  };

  useEffect(() => {
    (async () => {
      const [p, s, si] = await Promise.all([
        supabase.from('parts').select('*'),
        supabase.from('sales').select('*'),
        supabase.from('sale_items').select('sale_id, unit_cost, unit_price, quantity'),
      ]);
      setParts((p.data as Part[]) ?? []);
      setSales((s.data as Sale[]) ?? []);
      setSaleItems((si.data as any[]) ?? []);
      await loadAlerts();
      setLoading(false);
    })();
  }, []);

  // Monthly revenue + gross profit
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const monthSales = sales.filter((s) => s.sale_date >= monthStart && s.sale_date <= monthEnd && s.status !== 'Cancelada');
  const monthRevenue = monthSales.reduce((sum, s) => sum + Number(s.total_amount) + Number(s.delivery_fee || 0), 0);
  const saleById = new Map(sales.map((s) => [s.id, s]));
  const monthCOGS = saleItems
    .filter((si) => {
      const s = saleById.get(si.sale_id);
      return s && s.sale_date >= monthStart && s.sale_date <= monthEnd && s.status !== 'Cancelada';
    })
    .reduce((sum, si) => sum + Number(si.unit_cost) * Number(si.quantity), 0);
  const monthGrossProfit = monthRevenue - monthCOGS;

  // Critical stock
  const criticalStock = parts.filter((p) => Number(p.stock_quantity) <= Number(p.min_stock));
  const stockValue = parts.reduce((sum, p) => sum + Number(p.unit_cost) * Number(p.stock_quantity), 0);

  const today = new Date().toISOString().slice(0, 10);
  const overdueAlerts = alerts.filter((i) => i.due_date < today);
  const todayAlerts = alerts.filter((i) => i.due_date === today);

  const openBaixa = (i: Installment) => {
    setBaixa(i);
    setBaixaDate(today);
    setBaixaAmount(Number(i.amount));
  };

  const confirmBaixa = async () => {
    if (!baixa) return;
    setBaixaSaving(true);
    await supabase.from('installments').update({
      paid: true,
      paid_date: baixaDate,
      paid_amount: baixaAmount,
    }).eq('id', baixa.id);
    setBaixaSaving(false);
    setBaixa(null);
    loadAlerts();
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>;
  }

  const AlertRow = ({ i, label, tone }: { i: Installment; label: string; tone: 'red' | 'amber' }) => (
    <div className="px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/50">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-900 truncate">{i.customer?.name ?? '—'}</div>
        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
          <span className={`font-semibold ${tone === 'red' ? 'text-red-600' : 'text-amber-600'}`}>{label}</span>
          {tone === 'red' && <span>Vencimento {formatDate(i.due_date)}</span>}
          <span>· Parcela {i.installment_number}</span>
        </div>
      </div>
      <div className="text-sm font-semibold text-slate-900 shrink-0">{BRL(i.amount)}</div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => openBaixa(i)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition"
        >
          Dar baixa
        </button>
      </div>
    </div>
  );

  const monthLabel = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-900">Visão geral</h2>
        <p className="text-sm text-slate-500 mt-0.5 capitalize">{monthLabel}</p>
      </div>

      {/* 3 main cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Faturamento do mês</span>
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><Receipt size={20} className="text-emerald-600" /></div>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{BRL(monthRevenue)}</div>
          <div className="mt-1 text-xs text-slate-400">{monthSales.length} venda{monthSales.length !== 1 ? 's' : ''} no período</div>
        </div>
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Lucro bruto estimado</span>
            <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center"><TrendingUp size={20} className="text-sky-600" /></div>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{BRL(monthGrossProfit)}</div>
          <div className="mt-1 text-xs text-slate-400">Receita - custo dos produtos</div>
        </div>
        <div className="card p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Estoque crítico</span>
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><AlertTriangle size={20} className="text-red-600" /></div>
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900">{criticalStock.length}</div>
          <div className="mt-1 text-xs text-slate-400">peça{criticalStock.length !== 1 ? 's' : ''} abaixo do mínimo</div>
        </div>
      </div>

      {/* Collection alerts */}
      {alerts.length > 0 && (
        <div className="card overflow-hidden mb-6 border-l-4 border-l-red-500">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2 bg-red-50/50">
            <BellRing size={18} className="text-red-600" />
            <h3 className="text-sm font-bold text-slate-900">Alertas de Cobrança</h3>
            <span className="text-xs font-semibold text-red-600 bg-red-100 px-2 py-0.5 rounded-full ml-auto">{alerts.length} parcela{alerts.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {overdueAlerts.map((i) => <AlertRow key={i.id} i={i} label="Atrasada" tone="red" />)}
            {todayAlerts.map((i) => <AlertRow key={i.id} i={i} label="Vence hoje" tone="amber" />)}
          </div>
        </div>
      )}

      {/* Secondary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Peças em estoque" value={String(parts.reduce((s, p) => s + Number(p.stock_quantity), 0))} icon={Boxes} tone="blue" sub={`${parts.length} peças distintas`} />
        <StatCard label="Valor em estoque" value={BRL(stockValue)} icon={Wallet} tone="slate" sub="Custo total" />
        <StatCard label="Vendas totais" value={BRL(sales.reduce((s, x) => s + Number(x.total_amount), 0))} icon={Receipt} tone="green" sub={`${sales.length} vendas`} />
        <StatCard label="Compras totais" value={BRL(0)} icon={ShoppingCart} tone="amber" sub="—" />
      </div>

      {/* Critical stock detail */}
      {criticalStock.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            <h3 className="text-sm font-bold text-slate-900">Peças com estoque crítico</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {criticalStock.map((p) => (
              <div key={p.id} className="px-6 py-3.5 flex items-center justify-between hover:bg-slate-50/50">
                <div>
                  <div className="text-sm font-medium text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-400">{p.brand || p.category || ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-red-600">{p.stock_quantity} un.</div>
                  <div className="text-xs text-slate-400">mín: {p.min_stock}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
            </div>
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
