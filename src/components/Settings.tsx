import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, RefreshCw } from 'lucide-react';
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
    </div>
  );
}
