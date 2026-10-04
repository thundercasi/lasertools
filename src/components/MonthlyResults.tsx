import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { TrendingUp } from 'lucide-react';
import { supabase, BRL } from '../lib/supabase';

type MonthBucket = {
  key: string;
  label: string;
  faturamento: number;
  lucro: number;
  resultado: number;
};

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
};

// Rounds a max value up to a "nice" round number for the axis, and picks
// a matching step so the axis shows evenly-spaced gridlines. Works for a
// signed range (min can be negative, when some month's Resultado dips
// below zero).
function niceScale(maxAbs: number, targetTicks = 4) {
  if (maxAbs <= 0) return { niceMax: 1, step: 1 };
  const rough = maxAbs / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const niceMax = Math.ceil(maxAbs / step) * step;
  return { niceMax, step };
}

const axisNumber = (v: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);

function ChartSvg({
  buckets, hoverKey, setHoverKey,
}: {
  buckets: MonthBucket[];
  hoverKey: string | null;
  setHoverKey: Dispatch<SetStateAction<string | null>>;
}) {
  const W = 1000;
  const H = 320;
  const left = 60;
  const right = W - 8;
  const top = 12;
  const bottom = H - 34;
  const plotH = bottom - top;
  const plotW = right - left;

  const maxPos = Math.max(0, ...buckets.map((b) => Math.max(b.faturamento, b.lucro, b.resultado)));
  const maxNeg = Math.max(0, ...buckets.map((b) => Math.max(-b.lucro, -b.resultado, 0)));
  const { niceMax: niceMaxPos, step } = niceScale(maxPos || 1);
  // Negative side reuses the same step so gridlines line up evenly above and below zero.
  const niceMaxNeg = maxNeg > 0 ? Math.ceil(maxNeg / step) * step : 0;
  const totalRange = niceMaxPos + niceMaxNeg;
  const zeroY = top + (niceMaxPos / totalRange) * plotH;

  const posTicks = Array.from({ length: Math.round(niceMaxPos / step) + 1 }, (_, i) => i * step);
  const negTicks = niceMaxNeg > 0 ? Array.from({ length: Math.round(niceMaxNeg / step) }, (_, i) => -(i + 1) * step) : [];
  const ticks = [...posTicks, ...negTicks];

  const groupW = buckets.length > 0 ? plotW / buckets.length : plotW;
  const barW = Math.min(11, groupW * 0.2);
  const gap = Math.max(1.5, groupW * 0.03);

  const yFor = (v: number) => zeroY - (v / totalRange) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 280 }} preserveAspectRatio="none">
      {ticks.map((t) => {
        const y = yFor(t);
        return (
          <g key={t}>
            <line x1={left} y1={y} x2={right} y2={y} stroke={t === 0 ? '#cbd5e1' : '#e2e8f0'} strokeWidth={1} />
            <text x={left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#94a3b8">{axisNumber(t)}</text>
          </g>
        );
      })}

      {buckets.map((b, idx) => {
        const x0 = left + idx * groupW;
        const cx = x0 + groupW / 2;
        const isHover = hoverKey === b.key;
        const bars: { v: number; color: string }[] = [
          { v: b.faturamento, color: '#94a3b8' },
          { v: b.lucro, color: '#10b981' },
          { v: b.resultado, color: '#0f172a' },
        ];
        return (
          <g
            key={b.key}
            onMouseEnter={() => setHoverKey(b.key)}
            onMouseLeave={() => setHoverKey((k) => (k === b.key ? null : k))}
          >
            <rect x={x0} y={top} width={groupW} height={plotH} fill="transparent" />
            {isHover && <rect x={x0} y={top} width={groupW} height={plotH} fill="#0f172a" opacity={0.03} />}
            {bars.map((bar, i) => {
              const barX = cx - (barW * 1.5 + gap) + i * (barW + gap);
              const y1 = yFor(Math.max(bar.v, 0));
              const y2 = yFor(Math.min(bar.v, 0));
              const h = Math.max(y2 - y1, bar.v !== 0 ? 2 : 0);
              return <rect key={i} x={barX} y={y1} width={barW} height={h} rx={1.5} fill={bar.color} />;
            })}
            <text x={cx} y={bottom + 16} textAnchor="middle" fontSize={10} fill="#94a3b8">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function MonthlyResults() {
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
      twelveMonthsAgo.setDate(1);
      const { data } = await supabase
        .from('sales')
        .select('id, sale_date, status, total_amount, delivery_fee, delivery_cost, nf_tax, nf_fee, salesperson_commission, card_fee_percent, sale_items(quantity, unit_cost)')
        .neq('status', 'Cancelada')
        .gte('sale_date', twelveMonthsAgo.toISOString().slice(0, 10));
      setSales(data ?? []);
      setLoading(false);
    })();
  }, []);

  const buckets = useMemo(() => {
    const map = new Map<string, MonthBucket>();

    // Seed the last 12 months so a month with zero sales still shows an
    // empty group instead of just disappearing from the axis.
    const cursor = new Date();
    cursor.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
      const key = monthKey(d);
      map.set(key, { key, label: monthLabel(key), faturamento: 0, lucro: 0, resultado: 0 });
    }

    for (const s of sales) {
      const d = new Date(s.sale_date + 'T00:00:00');
      const key = monthKey(d);
      const b = map.get(key);
      if (!b) continue; // outside the 12-month window we seeded

      // Same formula already used per-sale in the Vendas screen's
      // "Líquido" column — just summed by month here instead of shown
      // per sale. Deliberately excludes anything not tied to THIS sale:
      // no old installments, no restocking purchases, no unrelated
      // payables — only the direct revenue/cost/fees of that sale.
      const t = Number(s.total_amount) + Number(s.delivery_fee || 0); // Faturamento
      const cogs = ((s.sale_items ?? []) as any[]).reduce((sum, si) => sum + Number(si.unit_cost) * Number(si.quantity), 0);
      const lucro = t - cogs; // gross profit — revenue minus the real cost of the parts sold
      const ded = t * (Number(s.nf_tax) + Number(s.nf_fee) + Number(s.salesperson_commission) + Number(s.card_fee_percent)) / 100;
      const resultado = lucro - ded - Number(s.delivery_cost || 0);

      b.faturamento += t;
      b.lucro += lucro;
      b.resultado += resultado;
    }

    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [sales]);

  const hovered = buckets.find((b) => b.key === hoverKey) ?? null;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Últimos 12 meses</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-slate-400 inline-block" /> Faturamento</span>
          <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Lucro</span>
          <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-slate-900 inline-block" /> Resultado</span>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Resultado = lucro da venda menos só os custos daquela venda (impostos, comissão, cartão, frete) — não inclui dívidas antigas nem compras de reposição.
      </p>

      {loading ? (
        <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
      ) : (
        <>
          {hovered && (
            <div className="text-xs text-slate-600 mb-2 h-4">
              <span className="font-semibold">{hovered.label}</span>
              {' — '}
              <span className="text-slate-500">Faturamento: {BRL(hovered.faturamento)}</span>
              {'  ·  '}
              <span className="text-emerald-600">Lucro: {BRL(hovered.lucro)}</span>
              {'  ·  '}
              <span className={hovered.resultado < 0 ? 'text-red-600' : 'text-slate-900 font-medium'}>Resultado: {BRL(hovered.resultado)}</span>
            </div>
          )}
          {!hovered && <div className="h-4 mb-2" />}

          <ChartSvg buckets={buckets} hoverKey={hoverKey} setHoverKey={setHoverKey} />
        </>
      )}
    </div>
  );
}
