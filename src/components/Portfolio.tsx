import { useEffect, useMemo, useState } from 'react';
import { Printer, AlertTriangle, EyeOff, BookOpen } from 'lucide-react';
import logo from '../assets/logo.png';
import { supabase, type Part, type PartStock, BRL } from '../lib/supabase';
import { useLocalState } from '../lib/useLocalState';
import { PageHeader, EmptyState } from './ui';

// Portfólio de peças e preços para enviar a clientes.
// Só entram peças com show_in_catalog = true; itens internos (ex.: códigos
// de upgrade) ficam de fora e são listados no aviso, que não sai na impressão.

type CondPrice = { part_id: string; condition: string; unit_price: number };
type Row = { part: Part; novo: number | null; usado: number | null; available: number };

const ALL = '__all__';

export default function Portfolio() {
  const [parts, setParts] = useState<Part[]>([]);
  const [prices, setPrices] = useState<CondPrice[]>([]);
  const [stock, setStock] = useState<PartStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [category, setCategory] = useLocalState('portfolio:category', ALL);
  const [showStock, setShowStock] = useLocalState('portfolio:showStock', true);
  const [showUsed, setShowUsed] = useLocalState('portfolio:showUsed', true);
  const [includeNoPrice, setIncludeNoPrice] = useLocalState('portfolio:includeNoPrice', true);
  const [notes, setNotes] = useLocalState(
    'portfolio:notes',
    'Valores em reais (R$), sujeitos a alteração sem aviso prévio e à disponibilidade de estoque.',
  );
  const [clientName, setClientName] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: p, error: e1 }, { data: cp }, { data: st }] = await Promise.all([
        supabase.from('parts').select('*').order('name'),
        supabase.from('part_condition_prices').select('part_id, condition, unit_price'),
        supabase.from('part_stock').select('*'),
      ]);
      if (e1) setError(e1.message);
      setParts((p as Part[]) ?? []);
      setPrices((cp as CondPrice[]) ?? []);
      setStock((st as PartStock[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const rows: Row[] = useMemo(() => parts.map((part) => {
    const own = prices.filter((x) => x.part_id === part.id);
    const priceOf = (c: string) => {
      const v = Number(own.find((x) => x.condition === c)?.unit_price) || 0;
      return v > 0 ? v : null;
    };
    let novo = priceOf('Novo');
    // Peças antigas sem preço por condição: usa o preço legado como "Novo".
    if (own.length === 0 && Number(part.unit_price) > 0) novo = Number(part.unit_price);
    const available = stock
      .filter((s) => s.part_id === part.id)
      .reduce((sum, s) => sum + (Number(s.disponivel) || 0), 0);
    return { part, novo, usado: priceOf('Usado'), available };
  }), [parts, prices, stock]);

  const categories = useMemo(
    () => Array.from(new Set(parts.map((p) => p.category || 'Outros'))).sort(),
    [parts],
  );

  const inCategory = (r: Row) => category === ALL || (r.part.category || 'Outros') === category;
  const internal = rows.filter((r) => r.part.show_in_catalog === false && inCategory(r));
  const catalog = rows.filter((r) => r.part.show_in_catalog !== false && inCategory(r));
  const noPrice = catalog.filter((r) => r.novo == null && r.usado == null);
  const printed = includeNoPrice ? catalog : catalog.filter((r) => r.novo != null || r.usado != null);

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of printed) {
      const k = r.part.category || 'Outros';
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [printed]);

  const today = new Date().toLocaleDateString('pt-BR');
  const priceCell = (v: number | null, missingAll: boolean) =>
    v != null ? BRL(v) : <span className="text-slate-400">{missingAll ? 'Sob consulta' : '—'}</span>;

  return (
    <div className="space-y-6">
      <div className="print:hidden space-y-6">
        <PageHeader
          title="Portfólio de Peças"
          subtitle="Lista de itens e valores para enviar aos clientes. Itens marcados como internos no cadastro não aparecem."
          action={
            <button className="btn-primary" onClick={() => window.print()} disabled={printed.length === 0}>
              <Printer size={16} /> Imprimir / Salvar PDF
            </button>
          }
        />

        <div className="card p-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="label">Categoria</span>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value={ALL}>Todas</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Preparado para <span className="normal-case font-normal text-slate-400">(opcional)</span></span>
              <input className="input" placeholder="Nome do cliente" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded" checked={showStock} onChange={(e) => setShowStock(e.target.checked)} />
              Mostrar coluna Disponibilidade (Pronta entrega / Sob encomenda)
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)} />
              Mostrar coluna Usado
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 rounded" checked={includeNoPrice} onChange={(e) => setIncludeNoPrice(e.target.checked)} />
              Incluir itens sem preço (como "Sob consulta")
            </label>
          </div>
          <label className="block">
            <span className="label">Observações no rodapé</span>
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        {(noPrice.length > 0 || internal.length > 0) && (
          <div className="grid md:grid-cols-2 gap-4">
            {noPrice.length > 0 && (
              <div className="card p-4 border-amber-200 bg-amber-50/60">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 mb-2">
                  <AlertTriangle size={16} /> {noPrice.length} {noPrice.length === 1 ? 'peça sem preço' : 'peças sem preço'}
                  <span className="font-normal text-amber-700">
                    — {includeNoPrice ? 'sairão como "Sob consulta"' : 'não sairão no relatório'}
                  </span>
                </div>
                <ul className="text-xs text-amber-900 space-y-0.5">
                  {noPrice.map((r) => <li key={r.part.id}>{r.part.sku} · {r.part.name}{r.part.brand ? ` — ${r.part.brand.trim()}` : ''}</li>)}
                </ul>
              </div>
            )}
            {internal.length > 0 && (
              <div className="card p-4 border-violet-200 bg-violet-50/60">
                <div className="flex items-center gap-2 text-sm font-semibold text-violet-800 mb-2">
                  <EyeOff size={16} /> {internal.length} {internal.length === 1 ? 'item interno oculto' : 'itens internos ocultos'}
                </div>
                <ul className="text-xs text-violet-900 space-y-0.5">
                  {internal.map((r) => <li key={r.part.id}>{r.part.sku} · {r.part.name}</li>)}
                </ul>
                <p className="text-[11px] text-violet-700 mt-2">Para mudar, edite a peça em Cadastros › Peças.</p>
              </div>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {loading ? (
        <div className="card p-10 text-center text-sm text-slate-400 print:hidden">Carregando…</div>
      ) : printed.length === 0 ? (
        <div className="card print:hidden"><EmptyState icon={BookOpen} title="Nenhuma peça para o portfólio" subtitle="Verifique a categoria escolhida ou cadastre preços nas peças." /></div>
      ) : (
        <div className="card p-8 print:p-0 print:mt-0 print:shadow-none print:border-0" id="portfolio-print">
          <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-4 mb-6">
            <img src={logo} alt="Laser Tools Components" className="w-40 object-contain" />
            <div className="text-right text-sm text-slate-500">
              <div className="font-semibold text-slate-900 text-base">Portfólio de Peças e Preços</div>
              <div>Emitido em {today}</div>
              {clientName.trim() && <div>Preparado para: <span className="font-medium text-slate-700">{clientName.trim()}</span></div>}
            </div>
          </div>

          {grouped.map(([cat, list]) => (
            <div key={cat} className="mb-6">
              {grouped.length > 1 || cat !== 'Outros' ? (
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 break-after-avoid">{cat}</div>
              ) : null}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="th pl-0">Peça</th>
                    <th className="th">Modelo compatível</th>
                    {showStock && <th className="th">Disponibilidade</th>}
                    <th className="th text-right">Novo</th>
                    {showUsed && <th className="th text-right pr-0">Usado</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((r) => {
                    const missingAll = r.novo == null && r.usado == null;
                    return (
                      <tr key={r.part.id} className="break-inside-avoid">
                        <td className="td pl-0">
                          <div className="font-medium text-slate-900">
                            {r.part.name}{r.part.brand?.trim() ? <span className="font-normal text-slate-500"> — {r.part.brand.trim()}</span> : null}
                          </div>
                          <div className="text-xs text-slate-400">
                            {r.part.sku}{r.part.part_number ? ` · P/N ${r.part.part_number}` : ''}
                          </div>
                        </td>
                        <td className="td text-slate-600">{r.part.machine_model || '—'}</td>
                        {showStock && (
                          <td className="td">
                            {r.available > 0
                              ? <span className="text-emerald-700">Pronta entrega</span>
                              : <span className="text-slate-500">Sob encomenda</span>}
                          </td>
                        )}
                        <td className="td text-right font-semibold text-slate-900 whitespace-nowrap">{priceCell(r.novo, missingAll)}</td>
                        {showUsed && <td className="td text-right pr-0 whitespace-nowrap">{missingAll ? '' : priceCell(r.usado, false)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          <div className="border-t border-slate-200 pt-4 text-xs text-slate-500 space-y-1">
            {notes.trim() && <p className="whitespace-pre-line">{notes.trim()}</p>}
            <p>"—" indica que a peça não é oferecida nessa condição.</p>
            <p className="font-medium text-slate-600">LaserTools Componentes</p>
          </div>
        </div>
      )}
    </div>
  );
}
