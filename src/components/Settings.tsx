import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, RefreshCw, ClipboardList } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useUsdRate } from '../lib/useUsdRate';
import { Field, PageHeader } from './ui';

export default function Settings() {
  const usd = useUsdRate();
  const [spreadInput, setSpreadInput] = useState('5');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (usd.spreadPercent != null) setSpreadInput(String(usd.spreadPercent));
  }, [usd.spreadPercent]);

  const saveSpread = async () => {
    const v = Number(spreadInput.replace(',', '.'));
    if (isNaN(v) || v < 0) return;
    setSaving(true);
    await supabase.from('app_settings').update({ usd_spread_percent: v, updated_at: new Date().toISOString() }).eq('id', 'default');
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    usd.refresh();
  };

  return (
    <div>
      <PageHeader title="Configurações" subtitle="Cotação do dólar aplicada automaticamente onde o valor ainda não foi preenchido." />

      <div className="card p-6 max-w-xl">
        <div className="flex items-center gap-2 mb-4">
          <SettingsIcon size={16} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Cotação do Dólar (USD/BRL)</span>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-slate-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-400 uppercase">Cotação de mercado</div>
            <div className="text-xl font-bold text-slate-900 mt-1">{usd.baseRate != null ? usd.baseRate.toFixed(4) : '—'}</div>
          </div>
          <div className="bg-emerald-50 rounded-xl p-4">
            <div className="text-xs font-semibold text-emerald-600 uppercase">Com spread ({usd.spreadPercent}%)</div>
            <div className="text-xl font-bold text-emerald-700 mt-1">{usd.effectiveRate != null ? usd.effectiveRate.toFixed(4) : '—'}</div>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-4">
          {usd.loading ? 'Consultando cotação...' : usd.updatedAt ? `Última atualização: ${new Date(usd.updatedAt + 'T00:00:00').toLocaleDateString('pt-BR')} (atualiza automaticamente 1x por dia)` : 'Cotação ainda não consultada'}
          {usd.error && <span className="text-red-600"> · {usd.error}</span>}
        </p>

        <div className="flex items-end gap-3">
          <Field label="Spread (%)" hint="acrescido sobre a cotação de mercado">
            <input className="input" value={spreadInput} onChange={(e) => setSpreadInput(e.target.value)} />
          </Field>
          <button className="btn-primary mb-0" disabled={saving} onClick={saveSpread}>{saving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar'}</button>
          <button className="btn-secondary mb-0" disabled={usd.loading} onClick={() => usd.refresh()}>
            <RefreshCw size={15} className={usd.loading ? 'animate-spin' : ''} /> Atualizar agora
          </button>
        </div>

        <p className="text-xs text-slate-400 mt-5 border-t border-slate-100 pt-4">
          Esse valor (com spread) é usado para preencher automaticamente os campos de câmbio em Compras e Pedidos, sempre que ainda estiverem vazios — se você já digitou uma taxa manualmente, ela nunca é sobrescrita.
        </p>
      </div>

      <OrderDefaults />
    </div>
  );
}

const DEFAULT_FIELDS: { key: string; label: string; suffix?: string }[] = [
  { key: 'exchange_rate', label: 'Cotação do dólar (R$)' },
  { key: 'freight_usd', label: 'Frete internacional (USD)' },
  { key: 'iof_percent', label: 'IOF', suffix: '%' },
  { key: 'import_tax_percent', label: 'Imposto importação', suffix: '%' },
  { key: 'invoice_tax_percent', label: 'Imposto nota fiscal', suffix: '%' },
  { key: 'seller_commission_percent', label: 'Comissão vendedor', suffix: '%' },
  { key: 'card_fee_percent', label: 'Taxa cartão de crédito', suffix: '%' },
  { key: 'issuer_commission_percent', label: 'Comissão do emissor', suffix: '%' },
  { key: 'profit_margin_percent', label: 'Margem de lucro', suffix: '%' },
];

function OrderDefaults() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('app_settings').select('order_defaults').eq('id', 'default').maybeSingle();
      const d = ((data as any)?.order_defaults ?? {}) as Record<string, number>;
      const initial: Record<string, string> = {};
      for (const f of DEFAULT_FIELDS) initial[f.key] = String(d[f.key] ?? 0);
      setValues(initial);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, number> = {};
    for (const f of DEFAULT_FIELDS) {
      const n = Number(String(values[f.key] ?? '0').replace(',', '.'));
      payload[f.key] = isNaN(n) ? 0 : n;
    }
    await supabase.from('app_settings').update({ order_defaults: payload, updated_at: new Date().toISOString() }).eq('id', 'default');
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="card p-6 max-w-xl mt-6">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList size={16} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Padrões de Pedidos</span>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Valores usados para pré-preencher a tela de Pedidos. Campos já preenchidos nunca são sobrescritos.
      </p>

      {loading ? (
        <div className="text-sm text-slate-400 py-4">Carregando...</div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-4">
            {DEFAULT_FIELDS.map((f) => (
              <Field key={f.key} label={f.label + (f.suffix ? ` (${f.suffix})` : '')}>
                <input
                  className="input"
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <button className="btn-primary" disabled={saving} onClick={save}>
              {saving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar padrões'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
