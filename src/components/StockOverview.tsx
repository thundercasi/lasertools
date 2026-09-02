import { useEffect, useMemo, useState } from 'react';
import { Package, AlertCircle, Clock, AlertTriangle } from 'lucide-react';
import { supabase, type Part, type PartStock, BRL } from '../lib/supabase';

type PartWithSales = Part & { total_sold: number };

export default function StockOverview() {
  const [parts, setParts] = useState<PartWithSales[]>([]);
  const [loading, setLoading] = useState(true);
  const [stock, setStock] = useState<PartStock[]>([]);
  const [condPrices, setCondPrices] = useState<{ part_id: string; condition: string; unit_price: number }[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pRes, siRes, stRes] = await Promise.all([
        supabase.from('parts').select('*'),
        supabase.from('sale_items').select('part_id, quantity'),
        supabase.from('part_stock').select('*'),
      ]);
      setStock((stRes.data as PartStock[]) ?? []);
      const { data: cpData } = await supabase.from('part_condition_prices').select('part_id, condition, unit_price');
      setCondPrices((cpData as any[]) ?? []);
      const soldByPart = new Map<string, number>();
      for (const si of ((siRes.data as any[]) ?? [])) {
        soldByPart.set(si.part_id, (soldByPart.get(si.part_id) ?? 0) + Number(si.quantity));
      }
      setParts(((pRes.data as Part[]) ?? []).map((p) => ({ ...p, total_sold: soldByPart.get(p.id) ?? 0 })));
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const inStock = parts.filter((p) => Number(p.stock_quantity) > 0);
    const capital = inStock.reduce((s, p) => s + Number(p.stock_quantity) * Number(p.unit_cost), 0);
    const units = inStock.reduce((s, p) => s + Number(p.stock_quantity), 0);
    const inMaintenance = parts.reduce((s, p) => s + Number(p.in_maintenance ?? 0), 0);
    // A part counts as unpriced when it holds stock in a condition that
    // has no sale price configured for that specific condition.
    const noPrice = inStock.filter((p) =>
      stock.some((st) =>
        st.part_id === p.id && Number(st.disponivel) > 0 &&
        !condPrices.some((cp) => cp.part_id === p.id && cp.condition === st.condition && Number(cp.unit_price) > 0)
      )
    );
    const neverSold = inStock.filter((p) => p.total_sold === 0);
    const neverSoldCapital = neverSold.reduce((s, p) => s + Number(p.stock_quantity) * Number(p.unit_cost), 0);
    const noMinStock = parts.filter((p) => Number(p.min_stock) === 0).length;

    const condLabelOf = (partId: string) => {
      const rows = stock.filter((s) => s.part_id === partId && Number(s.disponivel) > 0);
      return rows.map((r) => `${Number(r.disponivel)} ${r.condition.toLowerCase()}`).join(' · ');
    };

    const topCapital = [...inStock]
      .map((p) => ({ ...p, capital: Number(p.stock_quantity) * Number(p.unit_cost), condLabel: condLabelOf(p.id) }))
      .filter((p) => p.capital > 0)
      .sort((a, b) => b.capital - a.capital)
      .slice(0, 5);

    return { capital, units, inMaintenance, noPrice, neverSold, neverSoldCapital, noMinStock, topCapital };
  }, [parts, stock, condPrices]);

  const maxCapital = stats.topCapital[0]?.capital ?? 1;

  if (loading) {
    return (
      <div className="card p-6">
        <div className="p-4 text-center text-slate-400 text-sm">Carregando estoque...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Package size={16} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Estoque</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-50 rounded-xl p-4">
          <div className="text-xs text-slate-500">Capital em estoque</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{BRL(stats.capital)}</div>
        </div>
        <div className="bg-slate-50 rounded-xl p-4">
          <div className="text-xs text-slate-500">Itens disponíveis</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{stats.units}</div>
        </div>
        <div className="bg-slate-50 rounded-xl p-4">
          <div className="text-xs text-slate-500">Em manutenção</div>
          <div className="text-xl font-bold text-slate-900 mt-1">{stats.inMaintenance}</div>
        </div>
        <div className={`rounded-xl p-4 ${stats.noPrice.length > 0 ? 'bg-amber-50' : 'bg-slate-50'}`}>
          <div className={`text-xs ${stats.noPrice.length > 0 ? 'text-amber-600' : 'text-slate-500'}`}>Sem preço de venda</div>
          <div className={`text-xl font-bold mt-1 ${stats.noPrice.length > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{stats.noPrice.length}</div>
        </div>
      </div>

      {stats.topCapital.length > 0 && (
        <div className="card p-6">
          <div className="text-sm font-bold text-slate-800 mb-4">Onde seu dinheiro está parado</div>
          <div className="space-y-3">
            {stats.topCapital.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800 truncate">{p.name}{p.brand ? ` — ${p.brand}` : ''}</div>
                  <div className="text-xs text-slate-400">{Number(p.stock_quantity)} un{p.condLabel ? ` · ${p.condLabel}` : ''}</div>
                </div>
                <div className="w-24 sm:w-36 h-2 bg-slate-100 rounded-full overflow-hidden shrink-0">
                  <div className="h-full bg-sky-500 rounded-full" style={{ width: `${(p.capital / maxCapital) * 100}%` }} />
                </div>
                <div className="text-sm font-semibold text-slate-900 w-24 text-right shrink-0">{BRL(p.capital)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(stats.noPrice.length > 0 || stats.neverSold.length > 0 || stats.noMinStock > 0) && (
        <div className="card p-6">
          <div className="text-sm font-bold text-slate-800 mb-3">Precisa de atenção</div>
          <div className="divide-y divide-slate-100">
            {stats.noPrice.length > 0 && (
              <div className="flex items-center gap-3 py-2.5">
                <AlertCircle size={16} className="text-amber-500 shrink-0" />
                <div className="flex-1 text-sm text-slate-700">
                  {stats.noPrice.length} {stats.noPrice.length === 1 ? 'peça sem preço' : 'peças sem preço'} de venda definido
                </div>
              </div>
            )}
            {stats.neverSold.length > 0 && (
              <div className="flex items-center gap-3 py-2.5">
                <Clock size={16} className="text-slate-400 shrink-0" />
                <div className="flex-1 text-sm text-slate-700">
                  {stats.neverSold.length} {stats.neverSold.length === 1 ? 'peça nunca vendida' : 'peças nunca vendidas'} — {BRL(stats.neverSoldCapital)} parados
                </div>
              </div>
            )}
            {stats.noMinStock > 0 && (
              <div className="flex items-center gap-3 py-2.5">
                <AlertTriangle size={16} className="text-slate-400 shrink-0" />
                <div className="flex-1 text-sm text-slate-700">
                  {stats.noMinStock} {stats.noMinStock === 1 ? 'peça sem estoque mínimo' : 'peças sem estoque mínimo'} configurado — alertas de reposição não disparam
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
