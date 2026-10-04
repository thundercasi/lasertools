import { useEffect, useMemo, useState } from 'react';
import { History, Search, ShoppingCart, Receipt } from 'lucide-react';
import { supabase, BRL, formatDate, type Part } from '../lib/supabase';
import { PageHeader, EmptyState } from './ui';

type PurchaseRow = {
  id: string; quantity: number; unit_cost: number; unit_cost_total: number; condition: string; serial_number: string | null;
  purchase: { code: string; purchase_date: string; supplier: { name: string } | null } | null;
};
type SaleRow = {
  id: string; quantity: number; unit_price: number; condition: string; serial_number: string | null;
  sale: { code: string; sale_date: string; customer: { name: string } | null } | null;
};

export default function PartHistory() {
  const [parts, setParts] = useState<Part[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Part | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loadingParts, setLoadingParts] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('parts').select('*').order('name');
      setParts((data as Part[]) ?? []);
      setLoadingParts(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parts.slice(0, 30);
    return parts.filter((p) =>
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.part_number ?? '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [parts, query]);

  const selectPart = async (p: Part) => {
    setSelected(p);
    setLoadingHistory(true);
    const [{ data: pData }, { data: sData }] = await Promise.all([
      supabase
        .from('purchase_items')
        .select('id, quantity, unit_cost, unit_cost_total, condition, serial_number, purchase:purchase_id(code, purchase_date, supplier:supplier_id(name))')
        .eq('part_id', p.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('sale_items')
        .select('id, quantity, unit_price, condition, serial_number, sale:sale_id(code, sale_date, customer:customer_id(name))')
        .eq('part_id', p.id)
        .order('created_at', { ascending: false }),
    ]);
    setPurchases((pData as any[]) ?? []);
    setSales((sData as any[]) ?? []);
    setLoadingHistory(false);
  };

  const purchaseSummary = useMemo(() => {
    const qty = purchases.reduce((s, r) => s + Number(r.quantity), 0);
    const last = purchases[0] ?? null; // already sorted newest-first
    return { count: purchases.length, qty, last };
  }, [purchases]);

  const saleSummary = useMemo(() => {
    const qty = sales.reduce((s, r) => s + Number(r.quantity), 0);
    const last = sales[0] ?? null;
    return { count: sales.length, qty, last };
  }, [sales]);

  return (
    <div>
      <PageHeader title="Histórico da Peça" subtitle="Busque uma peça para ver todo o histórico de compras e vendas dela." />

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        {/* Busca de peça */}
        <div className="card p-4 h-fit">
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9 text-sm" placeholder="Nome, SKU ou part number..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {loadingParts ? (
            <div className="text-sm text-slate-400 text-center py-6">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-6">Nenhuma peça encontrada.</div>
          ) : (
            <div className="space-y-1 max-h-[560px] overflow-y-auto">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectPart(p)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${selected?.id === p.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-100 text-slate-700'}`}
                >
                  <div className="font-medium truncate">{p.name}</div>
                  <div className={`text-xs ${selected?.id === p.id ? 'text-slate-300' : 'text-slate-400'}`}>{p.sku}{p.part_number ? ` · ${p.part_number}` : ''}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Histórico da peça selecionada */}
        <div>
          {!selected ? (
            <div className="card">
              <EmptyState icon={History} title="Selecione uma peça" subtitle="Escolha uma peça na lista ao lado para ver o histórico completo de compras e vendas." />
            </div>
          ) : loadingHistory ? (
            <div className="card p-8 text-center text-slate-400 text-sm">Carregando histórico...</div>
          ) : (
            <div className="space-y-6">
              <div className="card p-5">
                <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
                <p className="text-xs text-slate-400">{selected.sku}{selected.part_number ? ` · PN ${selected.part_number}` : ''}{selected.brand ? ` · ${selected.brand}` : ''}</p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="card p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-sky-600 uppercase mb-2">
                    <ShoppingCart size={14} /> Compras
                  </div>
                  {purchaseSummary.count === 0 ? (
                    <p className="text-sm text-slate-400">Nunca foi comprada.</p>
                  ) : (
                    <>
                      <div className="text-2xl font-bold text-slate-900">{purchaseSummary.qty} un.</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        em {purchaseSummary.count} {purchaseSummary.count === 1 ? 'compra' : 'compras'} · última em {formatDate(purchaseSummary.last!.purchase!.purchase_date)}
                        {purchaseSummary.last?.purchase?.supplier?.name && ` (${purchaseSummary.last.purchase.supplier.name})`}
                      </div>
                    </>
                  )}
                </div>
                <div className="card p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 uppercase mb-2">
                    <Receipt size={14} /> Vendas
                  </div>
                  {saleSummary.count === 0 ? (
                    <p className="text-sm text-slate-400">Nunca foi vendida.</p>
                  ) : (
                    <>
                      <div className="text-2xl font-bold text-slate-900">{saleSummary.qty} un.</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        em {saleSummary.count} {saleSummary.count === 1 ? 'venda' : 'vendas'} · última em {formatDate(saleSummary.last!.sale!.sale_date)}
                        {saleSummary.last?.sale?.customer?.name && ` (${saleSummary.last.sale.customer.name})`}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="card overflow-hidden">
                <div className="px-4 pt-4 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Histórico de Compras</div>
                {purchases.length === 0 ? (
                  <p className="text-sm text-slate-400 px-4 pb-4">Nenhuma compra registrada.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="th">Data</th>
                        <th className="th">Compra</th>
                        <th className="th">Fornecedor</th>
                        <th className="th">Condição</th>
                        <th className="th text-right">Qtd</th>
                        <th className="th text-right">Custo unit.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {purchases.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/50">
                          <td className="td text-slate-600">{r.purchase ? formatDate(r.purchase.purchase_date) : '—'}</td>
                          <td className="td text-slate-500">{r.purchase?.code ?? '—'}</td>
                          <td className="td text-slate-600">{r.purchase?.supplier?.name ?? '—'}</td>
                          <td className="td text-slate-500">{r.condition}</td>
                          <td className="td text-right font-medium">{r.quantity}</td>
                          <td className="td text-right">{BRL(Number(r.unit_cost_total) || Number(r.unit_cost))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="card overflow-hidden">
                <div className="px-4 pt-4 pb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Histórico de Vendas</div>
                {sales.length === 0 ? (
                  <p className="text-sm text-slate-400 px-4 pb-4">Nenhuma venda registrada.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="th">Data</th>
                        <th className="th">Venda</th>
                        <th className="th">Cliente</th>
                        <th className="th">Condição</th>
                        <th className="th text-right">Qtd</th>
                        <th className="th text-right">Preço unit.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sales.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/50">
                          <td className="td text-slate-600">{r.sale ? formatDate(r.sale.sale_date) : '—'}</td>
                          <td className="td text-slate-500">{r.sale?.code ?? '—'}</td>
                          <td className="td text-slate-600">{r.sale?.customer?.name ?? '—'}</td>
                          <td className="td text-slate-500">{r.condition}</td>
                          <td className="td text-right font-medium">{r.quantity}</td>
                          <td className="td text-right">{BRL(r.unit_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
