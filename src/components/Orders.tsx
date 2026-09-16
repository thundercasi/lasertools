import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, Plus, Trash2, Calculator, Printer, Eraser,
} from 'lucide-react';
import { supabase, BRL } from '../lib/supabase';
import { useUsdRate } from '../lib/useUsdRate';
import { Field, PageHeader } from './ui';

type OrderItem = {
  id: string;
  description: string;
  qty: number;
  is_import: boolean;
  cost_usd: number;
  cost_brl: number;
  // True while cost_brl was last set BY US (auto-fill), not typed by the
  // user. Lets USD keep re-syncing R$ across every keystroke, but stops
  // touching it the moment the user edits R$ directly.
  cost_brl_auto: boolean;
};

const newItem = (): OrderItem => ({
  id: crypto.randomUUID(), description: '', qty: 1, is_import: false, cost_usd: 0, cost_brl: 0, cost_brl_auto: true,
});

const emptyHeader = {
  proposal_date: new Date().toISOString().slice(0, 10),
  seller: '',
  client_name: '',
  client_doc: '',
  address: '',
  city_uf: '',
  cep: '',
};

const emptyRates = {
  exchange_rate: 0,
  freight_usd: 0,
  iof_percent: 0,
  import_tax_percent: 0,
  invoice_tax_percent: 0,
  seller_commission_percent: 0,
  card_fee_percent: 0,
  issuer_commission_percent: 0,
  profit_margin_percent: 20,
};

const emptyTerms = {
  delivery_time: '',
  payment_terms: '',
  warranty: '',
  proposal_validity: '',
  notes: '',
  final_discount: '',
};

const num = (v: number) => (isFinite(v) ? v : 0);

// This screen has exactly ONE shared draft, stored as a single row (not
// a list — every user reads and writes the same "current pedido"). This
// fixed code identifies that row; a real sequence isn't needed since
// there's only ever one.
const SHARED_CODE = 'PEDIDO-ATUAL';

// Renders a number input that shows blank instead of a leading "0" while
// the field is empty/zero, so typing doesn't produce "05", "010" etc.
function NumField({
  value, onChange, step, className, min,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: string;
  className?: string;
  min?: number;
}) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      className={className}
      value={value === 0 ? '' : value}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
    />
  );
}

// Percent field with a visible label showing the current value next to it.
function PctField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <Field label={label} hint={value ? `atual: ${value}%` : undefined}>
      <NumField value={value} onChange={onChange} step="0.01" className={disabled ? 'input opacity-60' : 'input'} />
    </Field>
  );
}

export default function Orders() {
  const usd = useUsdRate();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [header, setHeader] = useState(emptyHeader);
  const [rates, setRates] = useState(emptyRates);
  const [items, setItems] = useState<OrderItem[]>([newItem()]);
  const [terms, setTerms] = useState(emptyTerms);
  const [generated, setGenerated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);

  // Loads the single shared draft — whatever the last person saved is
  // what everyone sees when they open this screen. If it doesn't exist
  // yet (first time anyone uses this screen), falls through to defaults.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('orders').select('*, order_items(*)').eq('code', SHARED_CODE).maybeSingle();

      if (data) {
        setOrderId(data.id);
        setHeader({
          proposal_date: data.proposal_date, seller: data.seller ?? '', client_name: data.client_name ?? '',
          client_doc: data.client_doc ?? '', address: data.address ?? '', city_uf: data.city_uf ?? '', cep: data.cep ?? '',
        });
        setRates({
          exchange_rate: Number(data.exchange_rate) || 0, freight_usd: Number(data.freight_usd) || 0,
          iof_percent: Number(data.iof_percent) || 0, import_tax_percent: Number(data.import_tax_percent) || 0,
          invoice_tax_percent: Number(data.invoice_tax_percent) || 0, seller_commission_percent: Number(data.seller_commission_percent) || 0,
          card_fee_percent: Number(data.card_fee_percent) || 0, issuer_commission_percent: Number(data.issuer_commission_percent) || 0,
          profit_margin_percent: Number(data.profit_margin_percent) || 0,
        });
        const loadedItems = ((data.order_items ?? []) as any[]).sort((a, b) => a.position - b.position).map((it) => ({
          id: it.id, description: it.description, qty: Number(it.qty), is_import: it.is_import,
          cost_usd: Number(it.cost_usd), cost_brl: Number(it.cost_brl), cost_brl_auto: false,
        }));
        setItems(loadedItems.length > 0 ? loadedItems : [newItem()]);
        setTerms({
          delivery_time: data.delivery_time ?? '', payment_terms: data.payment_terms ?? '', warranty: data.warranty ?? '',
          proposal_validity: data.proposal_validity ?? '', notes: data.notes ?? '', final_discount: data.final_discount ?? '',
        });
        setSavedAt(data.updated_at);
      } else {
        // Nobody has saved a pedido yet — start from blank rates.
        setRates(emptyRates);
      }
      setDefaultsLoaded(true);
      setLoading(false);
    })();
  }, []);

  // Only while the exchange rate field is still empty (no saved draft has
  // ever set one) does this fall back to the day's USD quote (+ spread) —
  // once a value exists (typed by a user, or saved before), it's never
  // touched automatically again.
  useEffect(() => {
    if (!defaultsLoaded) return;
    if (Number(rates.exchange_rate) === 0 && usd.effectiveRate) {
      setRates((r) => (Number(r.exchange_rate) === 0 ? { ...r, exchange_rate: usd.effectiveRate as number } : r));
    }
  }, [defaultsLoaded, usd.effectiveRate, rates.exchange_rate]);

  const addItem = () => {
    if (items.length >= 10) return;
    setItems((r) => [...r, newItem()]);
  };
  const removeItem = (id: string) => setItems((r) => r.filter((i) => i.id !== id));
  const updateItem = (id: string, patch: Partial<OrderItem>) =>
    setItems((r) => r.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const setItemImport = (id: string, checked: boolean) => {
    const rate = Number(rates.exchange_rate) || Number(usd.effectiveRate) || 0;
    setItems((prev) => prev.map((i) => {
      if (i.id !== id) return i;
      const autoFlag = i.cost_brl_auto ?? true;
      if (checked) {
        if (autoFlag && num(i.cost_usd) > 0 && rate) {
          return { ...i, is_import: true, cost_brl: Number((i.cost_usd * rate).toFixed(2)), cost_brl_auto: true };
        }
        return { ...i, is_import: true, cost_brl_auto: autoFlag };
      }
      return { ...i, is_import: false, cost_usd: 0, cost_brl_auto: autoFlag };
    }));
  };

  const updateItemCostUsd = (id: string, v: number) => {
    const rate = Number(rates.exchange_rate) || Number(usd.effectiveRate) || 0;
    setItems((prev) => prev.map((i) => {
      if (i.id !== id) return i;
      const nowImport = i.is_import || v > 0;
      const autoFlag = i.cost_brl_auto ?? true;
      if (autoFlag && v > 0 && rate) {
        return { ...i, cost_usd: v, is_import: nowImport, cost_brl: Number((v * rate).toFixed(2)), cost_brl_auto: true };
      }
      if (autoFlag && v === 0) {
        return { ...i, cost_usd: v, is_import: nowImport, cost_brl: 0, cost_brl_auto: true };
      }
      return { ...i, cost_usd: v, is_import: nowImport, cost_brl_auto: autoFlag };
    }));
  };

  const updateItemCostBrl = (id: string, v: number) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, cost_brl: v, cost_brl_auto: false } : i)));

  // Persists the shared draft — every field, including the item table.
  // Called explicitly (Salvar) and also by "Limpar tudo", so a clear
  // is seen by everyone too, not just the person who clicked it.
  const persist = async (h: typeof header, r: typeof rates, it: OrderItem[], t: typeof terms) => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        code: SHARED_CODE, status: 'Rascunho',
        proposal_date: h.proposal_date, seller: h.seller || null, client_name: h.client_name || null,
        client_doc: h.client_doc || null, address: h.address || null, city_uf: h.city_uf || null, cep: h.cep || null,
        exchange_rate: Number(r.exchange_rate) || 0, freight_usd: Number(r.freight_usd) || 0,
        iof_percent: Number(r.iof_percent) || 0, import_tax_percent: Number(r.import_tax_percent) || 0,
        invoice_tax_percent: Number(r.invoice_tax_percent) || 0, seller_commission_percent: Number(r.seller_commission_percent) || 0,
        card_fee_percent: Number(r.card_fee_percent) || 0, issuer_commission_percent: Number(r.issuer_commission_percent) || 0,
        profit_margin_percent: Number(r.profit_margin_percent) || 0,
        delivery_time: t.delivery_time || null, payment_terms: t.payment_terms || null, warranty: t.warranty || null,
        proposal_validity: t.proposal_validity || null, final_discount: t.final_discount || null, notes: t.notes || null,
        updated_at: new Date().toISOString(),
      };

      let id = orderId;
      if (id) {
        await supabase.from('orders').update(payload).eq('id', id);
      } else {
        const { data, error: e } = await supabase.from('orders').insert({ ...payload, created_by: user?.id ?? null }).select('id').single();
        if (e) throw e;
        id = data.id;
        setOrderId(id);
      }

      await supabase.from('order_items').delete().eq('order_id', id);
      const validItems = it.filter((i) => i.description.trim());
      if (validItems.length > 0) {
        const itemRows = validItems.map((i, idx) => ({
          order_id: id, position: idx, description: i.description, qty: Number(i.qty) || 0,
          is_import: i.is_import, cost_usd: Number(i.cost_usd) || 0, cost_brl: Number(i.cost_brl) || 0,
        }));
        await supabase.from('order_items').insert(itemRows);
      }
      setSavedAt(new Date().toISOString());
    } finally {
      setSaving(false);
    }
  };

  const save = () => persist(header, rates, items, terms);

  const clearAll = () => {
    const h = emptyHeader;
    const r = emptyRates;
    const it = [newItem()];
    const t = emptyTerms;
    setHeader(h);
    setRates(r);
    setItems(it);
    setTerms(t);
    setGenerated(false);
    persist(h, r, it, t);
  };

  // Deductions applied on top of the sale price (taxes, commissions, card fee) — not including profit margin itself.
  const otherDeductionsPct = (rates.invoice_tax_percent + rates.seller_commission_percent + rates.card_fee_percent + rates.issuer_commission_percent) / 100;
  const marginPct = rates.profit_margin_percent / 100;
  const denom = 1 - otherDeductionsPct - marginPct;

  const totalCostUSD = useMemo(
    () => items.reduce((s, i) => s + (i.is_import ? num(i.qty) * num(i.cost_usd) : 0), 0),
    [items]
  );

  const rows = useMemo(() => items.map((i) => {
    const qty = num(i.qty);
    const isImp = !!i.is_import;
    const rowCostUSD = isImp ? qty * num(i.cost_usd) : 0;
    const rowCostBRL = qty * num(i.cost_brl);
    const share = totalCostUSD > 0 ? rowCostUSD / totalCostUSD : 0;
    const freightBRL = isImp ? share * rates.freight_usd * rates.exchange_rate : 0;
    const iofBRL = isImp ? rowCostBRL * (rates.iof_percent / 100) : 0;
    const importTaxBRL = isImp ? rowCostBRL * (rates.import_tax_percent / 100) : 0;
    const taxRateado = iofBRL + importTaxBRL;
    const custoFinal = rowCostBRL + freightBRL + taxRateado;
    const precoVenda = denom > 0 ? custoFinal / denom : custoFinal;
    const lucroLiq = precoVenda * marginPct;
    return { ...i, rowCostUSD, rowCostBRL, freightBRL, taxRateado, custoFinal, precoVenda, lucroLiq };
  }), [items, rates, totalCostUSD, denom, marginPct]);

  const totalCusto = rows.reduce((s, r) => s + r.custoFinal, 0);
  const totalVendaBruto = rows.reduce((s, r) => s + r.precoVenda, 0);
  const totalDeducoes = rows.reduce((s, r) => s + r.precoVenda * otherDeductionsPct, 0);
  const totalLucro = rows.reduce((s, r) => s + r.lucroLiq, 0);

  const discountValue = (() => {
    const raw = Number(String(terms.final_discount).replace(',', '.'));
    if (!raw || isNaN(raw)) return 0;
    return raw < 100 ? totalVendaBruto * (raw / 100) : raw;
  })();
  const totalVendaFinal = Math.max(totalVendaBruto - discountValue, 0);

  const inputCls = 'input';

  if (loading) {
    return <div className="p-8 text-center text-slate-400 text-sm">Carregando pedido...</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pedidos"
        subtitle="Simulação de proposta comercial — compartilhada com toda a equipe. Frete (USD) e impostos (R$) rateados proporcionalmente por item"
        action={
          <div className="flex gap-2 print:hidden">
            <button className="btn-secondary" onClick={clearAll}><Eraser size={16} /> Limpar tudo</button>
            <button className="btn-secondary" onClick={() => window.print()}><Printer size={16} /> Imprimir / Salvar PDF</button>
            <button className="btn-secondary" onClick={() => setGenerated(true)}><Calculator size={16} /> Calcular &amp; Gerar Pedido</button>
            <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        }
      />
      {savedAt && (
        <p className="text-xs text-slate-400 -mt-4 print:hidden">
          Última atualização: {new Date(savedAt).toLocaleString('pt-BR')}
        </p>
      )}

      <div className="print:hidden space-y-6">
        {/* 1. Dados do pedido e cliente */}
        <div className="card p-6">
          <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
            <ClipboardList size={16} className="text-sky-500" /> 1. Dados do Pedido e Cliente
          </h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Data da proposta">
              <input type="date" className={inputCls} value={header.proposal_date} onChange={(e) => setHeader({ ...header, proposal_date: e.target.value })} />
            </Field>
            <Field label="Vendedor / Emitente">
              <input className={inputCls} value={header.seller} onChange={(e) => setHeader({ ...header, seller: e.target.value })} />
            </Field>
            <Field label="Razão Social / Nome do Cliente">
              <input className={inputCls} value={header.client_name} onChange={(e) => setHeader({ ...header, client_name: e.target.value })} />
            </Field>
            <Field label="CNPJ / CPF">
              <input className={inputCls} value={header.client_doc} onChange={(e) => setHeader({ ...header, client_doc: e.target.value })} />
            </Field>
            <Field label="Endereço">
              <input className={inputCls} value={header.address} onChange={(e) => setHeader({ ...header, address: e.target.value })} />
            </Field>
            <Field label="Cidade / UF">
              <input className={inputCls} value={header.city_uf} onChange={(e) => setHeader({ ...header, city_uf: e.target.value })} />
            </Field>
            <Field label="CEP">
              <input className={inputCls} value={header.cep} onChange={(e) => setHeader({ ...header, cep: e.target.value })} />
            </Field>
          </div>
        </div>

        {/* 2. Câmbio, impostos, frete e margens */}
        <div className="card p-6">
          <h3 className="text-sm font-bold text-slate-800 mb-4">💱 2. Câmbio, Impostos, Frete e Margens</h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Cotação do Dólar (R$)">
              <NumField value={rates.exchange_rate} onChange={(v) => setRates({ ...rates, exchange_rate: v })} step="0.0001" className={inputCls} />
            </Field>
            <Field label="Frete Internacional (USD)" hint="rateio proporcional">
              <NumField value={rates.freight_usd} onChange={(v) => setRates({ ...rates, freight_usd: v })} step="0.01" className={inputCls} />
            </Field>
            <PctField label="IOF (%)" value={rates.iof_percent} onChange={(v) => setRates({ ...rates, iof_percent: v })} />
            <PctField label="Imposto Importação (%)" value={rates.import_tax_percent} onChange={(v) => setRates({ ...rates, import_tax_percent: v })} />
            <PctField label="Imposto Nota Fiscal (%)" value={rates.invoice_tax_percent} onChange={(v) => setRates({ ...rates, invoice_tax_percent: v })} />
            <PctField label="Comissão Vendedor (%)" value={rates.seller_commission_percent} onChange={(v) => setRates({ ...rates, seller_commission_percent: v })} />
            <PctField label="Taxa Cartão de Crédito (%)" value={rates.card_fee_percent} onChange={(v) => setRates({ ...rates, card_fee_percent: v })} />
            <PctField label="Comissão do Emissor (%)" value={rates.issuer_commission_percent} onChange={(v) => setRates({ ...rates, issuer_commission_percent: v })} />
            <PctField label="🎯 Margem de Lucro (%)" value={rates.profit_margin_percent} onChange={(v) => setRates({ ...rates, profit_margin_percent: v })} />
          </div>
          {denom <= 0 && (
            <p className="text-xs text-red-600 mt-3">A soma da margem de lucro com as deduções percentuais atingiu ou passou de 100% — ajuste os valores, o preço de venda não pode ser calculado.</p>
          )}
        </div>

        {/* 3. Produtos */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-800">📦 3. Produtos e Calculadora de Margem (até 10 itens)</h3>
            <button className="btn-secondary" onClick={addItem} disabled={items.length >= 10}>
              <Plus size={16} /> Adicionar item
            </button>
          </div>
          <div className="overflow-x-auto -mx-6">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="th">Descrição</th>
                  <th className="th text-center">Import.</th>
                  <th className="th text-right">Qtd</th>
                  <th className="th text-right">Custo USD</th>
                  <th className="th text-right">Custo R$</th>
                  <th className="th text-right">Frete Rateado</th>
                  <th className="th text-right">Imp. Rateado</th>
                  <th className="th text-right">Custo Final</th>
                  <th className="th text-right">Preço Venda</th>
                  <th className="th text-right">Total Item</th>
                  <th className="th text-right">Lucro Líq.</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td"><input className={inputCls} value={r.description} onChange={(e) => updateItem(r.id, { description: e.target.value })} /></td>
                    <td className="td px-2 text-center">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 cursor-pointer"
                        checked={r.is_import}
                        onChange={(e) => setItemImport(r.id, e.target.checked)}
                      />
                    </td>
                    <td className="td px-2 w-24"><NumField min={0} className={`${inputCls} text-right`} value={r.qty} onChange={(v) => updateItem(r.id, { qty: v })} /></td>
                    <td className="td px-2 w-32">
                      <NumField
                        step="0.01"
                        className={`${inputCls} text-right`}
                        value={r.cost_usd}
                        onChange={(v) => updateItemCostUsd(r.id, v)}
                      />
                    </td>
                    <td className="td px-2 w-32"><NumField step="0.01" className={`${inputCls} text-right`} value={r.cost_brl} onChange={(v) => updateItemCostBrl(r.id, v)} /></td>
                    <td className="td text-right text-slate-600">{BRL(r.freightBRL)}</td>
                    <td className="td text-right text-slate-600">{BRL(r.taxRateado)}</td>
                    <td className="td text-right font-medium text-slate-800">{BRL(r.custoFinal)}</td>
                    <td className="td text-right font-semibold text-slate-900">{BRL(r.precoVenda)}</td>
                    <td className="td text-right font-semibold text-slate-900">{BRL(r.precoVenda)}</td>
                    <td className="td text-right text-emerald-600 font-medium">{BRL(r.lucroLiq)}</td>
                    <td className="td"><button className="icon-btn" onClick={() => removeItem(r.id)}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                  <td className="td" colSpan={7}>TOTAL GERAL</td>
                  <td className="td text-right">{BRL(totalCusto)}</td>
                  <td className="td text-right">{BRL(totalVendaBruto)}</td>
                  <td className="td text-right">{BRL(totalVendaBruto)}</td>
                  <td className="td text-right text-emerald-700">{BRL(totalLucro)}</td>
                  <td className="td"></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase">Total de Custo</div>
              <div className="text-lg font-bold text-slate-900 mt-1">{BRL(totalCusto)}</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase">Total de Venda</div>
              <div className="text-lg font-bold text-slate-900 mt-1">{BRL(totalVendaBruto)}</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-xs font-semibold text-slate-500 uppercase">Total Deduções</div>
              <div className="text-lg font-bold text-slate-900 mt-1">{BRL(totalDeducoes)}</div>
            </div>
            <div className="bg-emerald-50 rounded-xl p-4">
              <div className="text-xs font-semibold text-emerald-600 uppercase">Lucro Líquido Total</div>
              <div className="text-lg font-bold text-emerald-700 mt-1">{BRL(totalLucro)}</div>
            </div>
          </div>
        </div>

        {/* 4. Condições comerciais */}
        <div className="card p-6">
          <h3 className="text-sm font-bold text-slate-800 mb-4">📜 4. Condições Comerciais e Observações</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Prazo de Entrega">
              <input className={inputCls} value={terms.delivery_time} onChange={(e) => setTerms({ ...terms, delivery_time: e.target.value })} />
            </Field>
            <Field label="Condições de Pagamento">
              <input className={inputCls} value={terms.payment_terms} onChange={(e) => setTerms({ ...terms, payment_terms: e.target.value })} />
            </Field>
            <Field label="Garantia">
              <input className={inputCls} value={terms.warranty} onChange={(e) => setTerms({ ...terms, warranty: e.target.value })} />
            </Field>
            <Field label="Validade da Proposta">
              <input className={inputCls} value={terms.proposal_validity} onChange={(e) => setTerms({ ...terms, proposal_validity: e.target.value })} />
            </Field>
            <Field label="Desconto Final (R$ ou %)" hint="se < 100 assume %, se ≥ 100 assume R$">
              <input className={inputCls} value={terms.final_discount} onChange={(e) => setTerms({ ...terms, final_discount: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Observações Adicionais">
              <textarea rows={3} className={inputCls} value={terms.notes} onChange={(e) => setTerms({ ...terms, notes: e.target.value })} />
            </Field>
          </div>
        </div>
      </div>

      {/* Proposta gerada / imprimível */}
      {generated && (
        <div className="card p-8 print:shadow-none print:border-0" id="proposal-print">
          <div className="flex items-start justify-between border-b border-slate-200 pb-4 mb-6">
            <div>
              <div className="text-lg font-bold text-slate-900">LASER TOOLS</div>
              <div className="text-xs text-slate-500">Distribuidora de Peças</div>
            </div>
            <div className="text-right text-sm text-slate-500">
              <div className="font-semibold text-slate-800">PROPOSTA COMERCIAL</div>
              <div>Data: {header.proposal_date ? new Date(header.proposal_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-6 mb-6 text-sm">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-1">Emitente</div>
              <div className="font-semibold text-slate-800">LASER TOOLS</div>
              <div className="text-slate-500">Vendedor: {header.seller || '—'}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-1">Cliente</div>
              <div className="font-semibold text-slate-800">{header.client_name || '—'}</div>
              <div className="text-slate-500">CNPJ/CPF: {header.client_doc || '—'}</div>
              <div className="text-slate-500">{header.address}{header.address && (header.city_uf || header.cep) ? ' — ' : ''}{header.city_uf} {header.cep}</div>
            </div>
          </div>

          <div className="text-xs font-bold text-slate-400 uppercase mb-2">Detalhes do Produto</div>
          <table className="w-full mb-6 text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">Descrição do Item</th>
                <th className="th text-right">Qtd</th>
                <th className="th text-right">V. Unitário</th>
                <th className="th text-right">V. Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.filter((r) => r.description).map((r) => (
                <tr key={r.id}>
                  <td className="td">{r.description || '—'}</td>
                  <td className="td text-right">{r.qty}</td>
                  <td className="td text-right">{BRL(r.precoVenda / (r.qty || 1))}</td>
                  <td className="td text-right">{BRL(r.precoVenda)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {discountValue > 0 && (
                <tr>
                  <td className="td text-right text-slate-500" colSpan={3}>Desconto</td>
                  <td className="td text-right text-red-600">- {BRL(discountValue)}</td>
                </tr>
              )}
              <tr className="border-t-2 border-slate-200 font-bold text-slate-900">
                <td className="td" colSpan={3}>TOTAL GERAL</td>
                <td className="td text-right">{BRL(totalVendaFinal)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="text-xs font-bold text-slate-400 uppercase mb-2">Condições Comerciais e Termos</div>
          <div className="grid sm:grid-cols-2 gap-2 text-sm text-slate-600 mb-6">
            <div>Prazo de Entrega: {terms.delivery_time || '—'}</div>
            <div>Condições de Pgto: {terms.payment_terms || '—'}</div>
            <div>Garantia: {terms.warranty || '—'}</div>
            <div>Val. Proposta: {terms.proposal_validity || '—'}</div>
          </div>

          {terms.notes && (
            <div className="mb-6">
              <div className="text-xs font-bold text-slate-400 uppercase mb-2">Observações Adicionais</div>
              <p className="text-sm text-slate-600 whitespace-pre-line">{terms.notes}</p>
            </div>
          )}

          <div className="border-t border-slate-200 pt-4 text-sm text-slate-500">
            <div className="font-semibold text-slate-700">{header.seller || 'Vendas'}</div>
            <div>Vendas | LASER TOOLS</div>
          </div>
        </div>
      )}
    </div>
  );
}
