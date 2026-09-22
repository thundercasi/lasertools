import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Search } from 'lucide-react';
import { supabase, BRL } from '../lib/supabase';
import { PageHeader, EmptyState } from './ui';

type Row = {
  part_id: string;
  sku: string;
  name: string;
  stock: number;
  min: number;
  lastCost: number;
  lowestCompetitor: { price: number; currency: string; competitor: string } | null;
  supplier: string | null;
};

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export default function PurchaseSuggestions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'zero' | 'cheaper'>('all');
  const [query, setQuery] = useState('');
  const [usdRate, setUsdRate] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: parts }, { data: prices }, { data: purchaseItems }, { data: settings }] = await Promise.all([
        supabase.from('parts').select('id, sku, name, stock_quantity, min_stock, unit_cost, unit_price'),
        supabase.from('competition_prices').select('part_id, price, currency, competitor, observed_at').order('observed_at', { ascending: false }),
        supabase.from('purchase_items').select('part_id, created_at, unit_cost, purchase:purchase_id(purchase_date, currency, exchange_rate, supplier:supplier_id(name))').order('created_at', { ascending: false }),
        supabase.from('app_settings').select('usd_base_rate').eq('id', 'default').maybeSingle(),
      ]);
      const rate = Number((settings as any)?.usd_base_rate) || 0;
      setUsdRate(rate);

      // Needs attention = stock at or below the configured minimum. Most
      // parts don't have a minimum set yet (min_stock = 0), so this still
      // naturally catches every zeroed-out part — it just won't warn
      // ahead of time for parts whose minimum hasn't been configured.
      const needsAttention = (parts ?? []).filter((p: any) => Number(p.stock_quantity) <= Number(p.min_stock));

      const lowestByPart = new Map<string, { price: number; currency: string; competitor: string; usdEquiv: number }>();
      for (const cp of (prices ?? []) as any[]) {
        const price = Number(cp.price);
        const usdEquiv = cp.currency === 'USD' ? price : (rate ? price / rate : price);
        const existing = lowestByPart.get(cp.part_id);
        if (!existing || usdEquiv < existing.usdEquiv) {
          lowestByPart.set(cp.part_id, { price, currency: cp.currency, competitor: cp.competitor, usdEquiv });
        }
      }

      const supplierByPart = new Map<string, string>();
      const lastCostByPart = new Map<string, number>();
      for (const pi of (purchaseItems ?? []) as any[]) {
        if (!lastCostByPart.has(pi.part_id)) {
          // Raw item price only — no freight/IOF/import tax rateio — but
          // still converted to R$ using the exchange rate that purchase
          // actually used, so a USD purchase and a BRL purchase remain
          // comparable to each other and to the competitor's price.
          const raw = Number(pi.unit_cost) || 0;
          const isUSD = pi.purchase?.currency === 'USD';
          const rate = Number(pi.purchase?.exchange_rate) || 0;
          lastCostByPart.set(pi.part_id, isUSD && rate ? raw * rate : raw);
        }
        if (!supplierByPart.has(pi.part_id) && pi.purchase?.supplier?.name) {
          supplierByPart.set(pi.part_id, pi.purchase.supplier.name);
        }
      }

      const built: Row[] = needsAttention.map((p: any) => ({
        part_id: p.id, sku: p.sku, name: p.name,
        stock: Number(p.stock_quantity), min: Number(p.min_stock), lastCost: lastCostByPart.get(p.id) ?? 0,
        lowestCompetitor: lowestByPart.has(p.id) ? {
          price: lowestByPart.get(p.id)!.price, currency: lowestByPart.get(p.id)!.currency, competitor: lowestByPart.get(p.id)!.competitor,
        } : null,
        supplier: supplierByPart.get(p.id) ?? null,
      }));

      built.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
      setRows(built);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    let r = rows;
    if (filter === 'zero') r = r.filter((x) => x.stock === 0);
    if (filter === 'cheaper') r = r.filter((x) => {
      if (!x.lowestCompetitor) return false;
      const ourPrice = x.lastCost; // raw item price only — no freight/IOF/import tax, matching how the competitor's price is quoted
      const compUsd = x.lowestCompetitor.currency === 'USD' ? x.lowestCompetitor.price : (usdRate ? x.lowestCompetitor.price / usdRate : x.lowestCompetitor.price);
      const compBRL = x.lowestCompetitor.currency === 'BRL' ? x.lowestCompetitor.price : compUsd * usdRate;
      return ourPrice > 0 && compBRL < ourPrice;
    });
    const q = query.trim().toLowerCase();
    if (q) r = r.filter((x) => x.name.toLowerCase().includes(q) || x.sku.toLowerCase().includes(q));
    return r;
  }, [rows, filter, query, usdRate]);

  const zeroCount = rows.filter((r) => r.stock === 0).length;
  const totalCost = rows.reduce((s, r) => s + (r.lastCost > 0 ? r.lastCost : 0), 0);
  const cheaperCount = rows.filter((x) => {
    if (!x.lowestCompetitor || x.lastCost <= 0) return false;
    const compBRL = x.lowestCompetitor.currency === 'BRL' ? x.lowestCompetitor.price : x.lowestCompetitor.price * (usdRate || 1);
    return compBRL < x.lastCost;
  }).length;

  return (
    <div>
      <PageHeader
        title="Sugestão de Compras"
        subtitle="Peças no estoque mínimo ou abaixo. Custo mostra só o valor do item (sem frete/IOF/imposto), pra comparar direto com o preço anunciado pelo concorrente."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <div className="text-[11px] font-semibold text-slate-400 uppercase">No mínimo ou abaixo</div>
          <div className="text-2xl font-bold mt-1">{rows.length}</div>
        </div>
        <div className="card p-4 bg-red-50 border-red-100">
          <div className="text-[11px] font-semibold text-red-600 uppercase">Estoque zerado</div>
          <div className="text-2xl font-bold mt-1 text-red-700">{zeroCount}</div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] font-semibold text-slate-400 uppercase">Custo estimado (último pago)</div>
          <div className="text-2xl font-bold mt-1">{BRL(totalCost)}</div>
        </div>
        <div className="card p-4 bg-emerald-50 border-emerald-100">
          <div className="text-[11px] font-semibold text-emerald-600 uppercase">Concorrente mais barato</div>
          <div className="text-2xl font-bold mt-1 text-emerald-700">{cheaperCount}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-2">
          {([
            { id: 'all', label: 'Todas' },
            { id: 'zero', label: 'Zeradas' },
            { id: 'cheaper', label: 'Concorrente mais barato' },
          ] as const).map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${filter === f.id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9 py-1.5 text-sm w-56" placeholder="Buscar peça..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Nada por aqui" subtitle="Nenhuma peça encontrada nesse filtro." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">Peça</th>
                <th className="th text-right">Estoque / Mín.</th>
                <th className="th text-right">Custo do item (última compra)</th>
                <th className="th text-right">Menor preço concorrente</th>
                <th className="th">Fornecedor sugerido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.part_id} className="hover:bg-slate-50/50">
                  <td className="td">
                    <div className="font-medium text-slate-900">{r.name}</div>
                    <div className="text-xs text-slate-400">{r.sku}</div>
                  </td>
                  <td className="td text-right">
                    <span className={r.stock === 0 ? 'font-bold text-red-600' : 'font-bold text-amber-600'}>{fmtQty(r.stock)}</span>
                    <span className="text-slate-400"> / {fmtQty(r.min)}</span>
                  </td>
                  <td className="td text-right">{r.lastCost > 0 ? BRL(r.lastCost) : <span className="text-slate-300">—</span>}</td>
                  <td className="td text-right">
                    {r.lowestCompetitor ? (
                      <>
                        <div className="font-medium">
                          {r.lowestCompetitor.currency === 'USD' ? '$' : 'R$'} {r.lowestCompetitor.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          {r.lowestCompetitor.currency === 'USD' && usdRate > 0 && (
                            <span className="text-slate-400 font-normal"> ({BRL(r.lowestCompetitor.price * usdRate)})</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">{r.lowestCompetitor.competitor}</div>
                      </>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="td text-slate-600">{r.supplier ?? <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
