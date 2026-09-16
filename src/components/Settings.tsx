import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, RefreshCw, Landmark } from 'lucide-react';
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

      <InterCredentials />
    </div>
  );
}

function InterCredentials() {
  const [status, setStatus] = useState<{ environment: string; configured: boolean; updated_at: string | null } | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const loadStatus = async () => {
    const { data } = await supabase.rpc('get_inter_status');
    setStatus(Array.isArray(data) ? data[0] : data);
  };

  useEffect(() => { loadStatus(); }, []);

  const readFile = (file: File, setter: (v: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const save = async () => {
    setError('');
    setSaving(true);
    const { error: e } = await supabase.rpc('admin_save_inter_credentials', {
      p_client_id: clientId.trim(), p_client_secret: clientSecret.trim(),
      p_cert_pem: certPem.trim(), p_key_pem: keyPem.trim(),
    });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setClientId(''); setClientSecret(''); setCertPem(''); setKeyPem('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    loadStatus();
  };

  return (
    <div className="card p-6 max-w-xl mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Landmark size={16} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Emissão de Boleto (Banco Inter)</span>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Cole aqui o Client ID, Client Secret e o conteúdo dos arquivos de certificado (.crt) e chave (.key) gerados no portal de desenvolvedores do Inter.
        Esses dados ficam guardados de forma protegida — o app nunca os exibe de volta depois de salvos.
      </p>

      {status && (
        <div className={`text-sm rounded-lg p-3 mb-4 ${status.environment === 'producao' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {status.environment === 'producao'
            ? '✅ Configurado — emitindo boletos reais pelo Banco Inter.'
            : '⚠️ Modo simulado — nenhuma credencial real configurada ainda. Os boletos emitidos no sistema são fictícios até você preencher os campos abaixo.'}
        </div>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{error}</div>}

      <div className="space-y-4">
        <Field label="Client ID">
          <input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        </Field>
        <Field label="Client Secret">
          <input type="password" className="input" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
        </Field>
        <Field label="Certificado (.crt)" hint="selecione o arquivo — o conteúdo é lido automaticamente">
          <input type="file" accept=".crt,.pem" className="input" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f, setCertPem); }} />
          {certPem && <p className="text-xs text-emerald-600 mt-1">Arquivo carregado ({certPem.length} caracteres).</p>}
        </Field>
        <Field label="Chave (.key)" hint="selecione o arquivo — o conteúdo é lido automaticamente">
          <input type="file" accept=".key,.pem" className="input" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f, setKeyPem); }} />
          {keyPem && <p className="text-xs text-emerald-600 mt-1">Arquivo carregado ({keyPem.length} caracteres).</p>}
        </Field>
      </div>

      <div className="flex justify-end mt-4">
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar credenciais'}
        </button>
      </div>
    </div>
  );
}
