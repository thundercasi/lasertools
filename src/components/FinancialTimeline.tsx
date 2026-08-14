import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { TrendingUp } from 'lucide-react';
import { supabase, type Installment, BRL } from '../lib/supabase';

type Bucket = { key: string; label: string; receivable: number; payable: number; isToday: boolean };

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

const monthLabel = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
};

// Rounds a max value up to a "nice" round number for the axis (e.g. 437 -> 500),
// and picks a matching step so the axis shows ~5 evenly-spaced gridlines.
function niceScale(maxValue: number, targetTicks = 5) {
  if (maxValue <= 0) return { niceMax: 1, step: 1 };
  const rough = maxValue / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const niceMax = Math.ceil(maxValue / step) * step;
  return { niceMax, step };
}

const axisNumber = (v: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);

function ChartSvg({
  buckets, maxVal, hoverKey, setHoverKey,
}: {
  buckets: Bucket[];
  maxVal: number;
  hoverKey: string | null;
  setHoverKey: Dispatch<SetStateAction<string | null>>;
}) {
  const W = 1000;
  const H = 320;
  const left = 56;
  const right = W - 8;
  const top = 12;
  const bottom = H - 34;
  const plotW = right - left;
  const plotH = bottom - top;

  const { niceMax, step } = niceScale(maxVal);
  const tickCount = Math.round(niceMax / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * step);

  const groupW = buckets.length > 0 ? plotW / buckets.length : plotW;
  const barW = Math.min(20, groupW * 0.32);
  const gap = Math.max(2, groupW * 0.06);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 280 }} preserveAspectRatio="none">
      {/* Gridlines + y-axis labels */}
      {ticks.map((t) => {
        const y = bottom - (t / niceMax) * plotH;
        return (
          <g key={t}>
            <line x1={left} y1={y} x2={right} y2={y} stroke="#e2e8f0" strokeWidth={1} />
            <text x={left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#94a3b8">{axisNumber(t)}</text>
          </g>
        );
      })}
      {/* Baseline */}
      <line x1={left} y1={bottom} x2={right} y2={bottom} stroke="#cbd5e1" strokeWidth={1} />

      {buckets.map((b, idx) => {
        const x0 = left + idx * groupW;
        const rH = (b.receivable / niceMax) * plotH;
        const pH = (b.payable / niceMax) * plotH;
        const rX = x0 + groupW / 2 - gap / 2 - barW;
        const pX = x0 + groupW / 2 + gap / 2;
        const isHover = hoverKey === b.key;
        return (
          <g
            key={b.key}
            onMouseEnter={() => setHoverKey(b.key)}
            onMouseLeave={() => setHoverKey((k) => (k === b.key ? null : k))}
          >
            {/* Invisible full-height hit area for easier hover */}
            <rect x={x0} y={top} width={groupW} height={plotH} fill="transparent" />
            {isHover && <rect x={x0} y={top} width={groupW} height={plotH} fill="#0f172a" opacity={0.03} />}
            <rect x={rX} y={bottom - rH} width={barW} height={Math.max(rH, b.receivable > 0 ? 2 : 0)} rx={2} fill="#10b981" />
            <rect x={pX} y={bottom - pH} width={barW} height={Math.max(pH, b.payable > 0 ? 2 : 0)} rx={2} fill="#f87171" />
            <text
              x={x0 + groupW / 2}
              y={bottom + 16}
              textAnchor="middle"
              fontSize={10}
              fontWeight={b.isToday ? 700 : 400}
              fill={b.isToday ? '#0f172a' : '#94a3b8'}
            >
              {b.label}
            </text>
            {b.isToday && <circle cx={x0 + groupW / 2} cy={bottom + 24} r={2} fill="#0ea5e9" />}
          </g>
        );
      })}
    </svg>
  );
}

export default function FinancialTimeline() {
  const [items, setItems] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('installments')
        .select('due_date, amount, reference_type')
        .in('reference_type', ['sale', 'purchase', 'maintenance']);
      setItems((data as Installment[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const { buckets, totalReceivable, totalPayable } = useMemo(() => {
    if (items.length === 0) return { buckets: [] as Bucket[], totalReceivable: 0, totalPayable: 0 };

    const keyFn = monthKey;
    const labelFn = monthLabel;

    const today = new Date();
    const todayKey = keyFn(today);

    const map = new Map<string, Bucket>();
    let totalReceivable = 0;
    let totalPayable = 0;
    for (const i of items) {
      const d = new Date(i.due_date + 'T00:00:00');
      const key = keyFn(d);
      const amt = Number(i.amount) || 0;
      if (!map.has(key)) map.set(key, { key, label: labelFn(key), receivable: 0, payable: 0, isToday: key === todayKey });
      const b = map.get(key)!;
      if (i.reference_type === 'sale') { b.receivable += amt; totalReceivable += amt; }
      else { b.payable += amt; totalPayable += amt; }
    }
    const buckets = Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
    return { buckets, totalReceivable, totalPayable };
  }, [items]);

  const maxVal = Math.max(1, ...buckets.map((b) => Math.max(b.receivable, b.payable)));
  const hovered = buckets.find((b) => b.key === hoverKey) ?? null;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Linha do Tempo Financeira</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> A Receber</span>
          <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" /> A Pagar</span>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Histórico completo · agrupado por mês
      </p>

      {loading ? (
        <div className="p-8 text-center text-slate-400 text-sm">Carregando...</div>
      ) : buckets.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-sm">Nenhuma parcela lançada ainda.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
            <div className="bg-emerald-50 rounded-xl p-3">
              <div className="text-[11px] font-semibold text-emerald-600 uppercase">Total a Receber</div>
              <div className="text-base font-bold text-emerald-700 mt-0.5">{BRL(totalReceivable)}</div>
            </div>
            <div className="bg-red-50 rounded-xl p-3">
              <div className="text-[11px] font-semibold text-red-500 uppercase">Total a Pagar</div>
              <div className="text-base font-bold text-red-600 mt-0.5">{BRL(totalPayable)}</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 col-span-2 sm:col-span-2">
              <div className="text-[11px] font-semibold text-slate-500 uppercase">Saldo Projetado</div>
              <div className={`text-base font-bold mt-0.5 ${totalReceivable - totalPayable >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                {BRL(totalReceivable - totalPayable)}
              </div>
            </div>
          </div>

          {hovered && (
            <div className="text-xs text-slate-600 mb-2 h-4">
              <span className="font-semibold">{hovered.label}</span>
              {' — '}
              <span className="text-emerald-600">Receber: {BRL(hovered.receivable)}</span>
              {'  ·  '}
              <span className="text-red-500">Pagar: {BRL(hovered.payable)}</span>
            </div>
          )}
          {!hovered && <div className="h-4 mb-2" />}

          <ChartSvg buckets={buckets} maxVal={maxVal} hoverKey={hoverKey} setHoverKey={setHoverKey} />
        </>
      )}
    </div>
  );
}
