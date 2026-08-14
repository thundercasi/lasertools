import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, Plus, Trash2, Calculator, Printer, Eraser,
} from 'lucide-react';
import { BRL } from '../lib/supabase';
import { useLocalState } from '../lib/useLocalState';
import { useUsdRate } from '../lib/useUsdRate';
import { Field, PageHeader } from './ui';

type OrderItem = {
  id: string;
  description: string;
  qty: number;
  is_import: boolean;
  cost_usd: number;
  cost_brl: number;
};

const newItem = (): OrderItem => ({
  id: crypto.randomUUID(), description: '', qty: 1, is_import: false, cost_usd: 0, cost_brl: 0,
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
  const [header, setHeader] = useLocalState('orders:header', emptyHeader);
  const [rates, setRates] = useLocalState('orders:rates', emptyRates);
  const [items, setItems] = useLocalState<OrderItem[]>('orders:items', [newItem()]);
  const [terms, setTerms] = useLocalState('orders:terms', emptyTerms);
  const [generated, setGenerated] = useState(false);

  // The date should always default to "today" on a fresh visit, even though
  // the rest of the form remembers the last values filled in.
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setHeader((h) => (h.proposal_date === today ? h : { ...h, proposal_date: today }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-fill the exchange rate from the daily USD quote (+ spread) —
  // only while the field hasn't been filled in yet (still 0).
  useEffect(() => {
    if (Number(rates.exchange_rate) === 0 && usd.effectiveRate) {
      setRates((r) => (Number(r.exchange_rate) === 0 ? { ...r, exchange_rate: usd.effectiveRate as number } : r));
    }
  }, [usd.effectiveRate, rates.exchange_rate, setRates]);

  const addItem = () => {
    if (items.length >= 10) return;
    setItems((r) => [...r, newItem()]);
  };
  const removeItem = (id: string) => setItems((r) => r.filter((i) => i.id !== id));
  const updateItem = (id: string, patch: Partial<OrderItem>) =>
    setItems((r) => r.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  // Toggling "Importação" on: auto-fills R$ from the USD cost already
  // typed (if any), using the day's exchange rate — only while R$ is
  // still blank. Toggling off: clears USD (não se aplica), keeps R$ as-is
  // so the user can still adjust the domestic cost directly.
  const setItemImport = (id: string, checked: boolean) => {
    setItems((prev) => prev.map((i) => {
      if (i.id !== id) return i;
      if (checked) {
        const autoBrl = num(i.cost_brl) === 0 && num(i.cost_usd) > 0 && rates.exchange_rate
          ? Number((i.cost_usd * rates.exchange_rate).toFixed(2))
          : i.cost_brl;
        return { ...i, is_import: true, cost_brl: autoBrl };
      }
      return { ...i, is_import: false, cost_usd: 0 };
    }));
  };

  // Typing the USD cost on an import item auto-fills R$ (while it's
  // still blank) using the day's exchange rate — never overwrites a
  // value the user already entered manually.
  const updateItemCostUsd = (id: string, v: number) => {
    setItems((prev) => prev.map((i) => {
      if (i.id !== id) return i;
      const autoBrl = i.is_import && num(i.cost_brl) === 0 && v > 0 && rates.exchange_rate
        ? Number((v * rates.exchange_rate).toFixed(2))
        : i.cost_brl;
      return { ...i, cost_usd: v, cost_brl: autoBrl };
    }));
  };

  const clearAll = () => {
    setHeader(emptyHeader);
    setRates(emptyRates);
    setItems([newItem()]);
    setTerms(emptyTerms);
    setGenerated(false);
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pedidos"
        subtitle="Simulação de proposta comercial — frete (USD) e impostos (R$) rateados proporcionalmente por item"
        action={
          <div className="flex gap-2 print:hidden">
            <button className="btn-secondary" onClick={clearAll}><Eraser size={16} /> Limpar tudo</button>
            <button className="btn-secondary" onClick={() => window.print()}><Printer size={16} /> Imprimir / Salvar PDF</button>
            <button className="btn-primary" onClick={() => setGenerated(true)}><Calculator size={16} /> Calcular &amp; Gerar Pedido</button>
          </div>
        }
      />

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
                        className={`${inputCls} text-right ${r.is_import ? '' : 'opacity-50'}`}
                        value={r.is_import ? r.cost_usd : 0}
                        onChange={(v) => updateItemCostUsd(r.id, v)}
                      />
                    </td>
                    <td className="td px-2 w-32"><NumField step="0.01" className={`${inputCls} text-right`} value={r.cost_brl} onChange={(v) => updateItem(r.id, { cost_brl: v })} /></td>
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
