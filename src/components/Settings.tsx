import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, RefreshCw, Landmark, Loader2, PlugZap } from 'lucide-react';
import { supabase, functionErrorMessage } from '../lib/supabase';
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
  const [status, setStatus] = useState<{ environment: string; configured: boolean; updated_at: string | null; conta_corrente: string | null } | null>(null);
  const [environment, setEnvironment] = useState<'producao' | 'sandbox'>('producao');
  const [contaCorrente, setContaCorrente] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadStatus = async () => {
    const { data } = await supabase.rpc('get_inter_status');
    const s = Array.isArray(data) ? data[0] : data;
    setStatus(s ?? null);
    if (s?.environment === 'sandbox' || s?.environment === 'producao') setEnvironment(s.environment);
    setContaCorrente(s?.conta_corrente ?? '');
  };

  useEffect(() => { loadStatus(); }, []);

  const readFile = (file: File, setter: (v: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const save = async () => {
    setError('');
    setTestResult(null);
    if (!status?.configured && !(clientId.trim() && clientSecret.trim() && certPem.trim() && keyPem.trim())) {
      setError('Na primeira vez, preencha os quatro campos: Client ID, Client Secret, certificado e chave.');
      return;
    }
    setSaving(true);
    const { error: e } = await supabase.rpc('admin_save_inter_credentials', {
      p_client_id: clientId.trim(), p_client_secret: clientSecret.trim(),
      p_cert_pem: certPem.trim(), p_key_pem: keyPem.trim(),
      p_environment: environment, p_conta_corrente: contaCorrente.trim() || null,
    });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setClientId(''); setClientSecret(''); setCertPem(''); setKeyPem('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    loadStatus();
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const { data, error: e } = await supabase.functions.invoke('emit-boleto', { body: { action: 'test' } });
    setTesting(false);
    if (data?.ok) setTestResult({ ok: true, msg: `Conexão com o Inter OK (${data.environment === 'sandbox' ? 'sandbox' : 'produção'}). Nenhuma cobrança foi gerada.` });
    else setTestResult({ ok: false, msg: data?.error || (await functionErrorMessage(e)) || 'Falha ao testar a conexão.' });
  };

  const envLabel = status?.environment === 'producao' ? 'produção' : status?.environment === 'sandbox' ? 'sandbox (testes)' : null;

  return (
    <div className="card p-6 max-w-xl mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Landmark size={16} className="text-slate-400" />
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Emissão de Boleto + PIX (Banco Inter)</span>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Cole aqui o Client ID, Client Secret e selecione os arquivos de certificado (.crt) e chave (.key) gerados na integração do Inter.
        Esses dados ficam guardados de forma protegida — o app nunca os exibe de volta depois de salvos.
      </p>

      {status && (
        <div className={`text-sm rounded-lg p-3 mb-4 ${envLabel ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
          {envLabel
            ? `✅ Credenciais salvas — ambiente: ${envLabel}.${status.updated_at ? ` Atualizado em ${new Date(status.updated_at).toLocaleString('pt-BR')}.` : ''}`
            : '⚠️ Modo simulado — nenhuma credencial real configurada ainda. Os boletos emitidos no sistema são fictícios até você preencher os campos abaixo.'}
        </div>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{error}</div>}

      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Ambiente">
            <select className="input" value={environment} onChange={(e) => setEnvironment(e.target.value as 'producao' | 'sandbox')}>
              <option value="producao">Produção (boletos reais)</option>
              <option value="sandbox">Sandbox (testes)</option>
            </select>
          </Field>
          <Field label="Conta corrente" hint="opcional">
            <input className="input" inputMode="numeric" placeholder="só se tiver mais de uma conta" value={contaCorrente} onChange={(e) => setContaCorrente(e.target.value)} />
          </Field>
        </div>
        <Field label="Client ID">
          <input className="input" autoComplete="off" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={status?.configured ? 'em branco = manter o atual' : ''} />
        </Field>
        <Field label="Client Secret">
          <input type="password" className="input" autoComplete="new-password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={status?.configured ? 'em branco = manter o atual' : ''} />
        </Field>
        <Field label="Certificado (.crt)" hint="selecione o arquivo — o conteúdo é lido automaticamente">
          <input type="file" accept=".crt,.pem" className="input" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f, setCertPem); }} />
          {certPem && <p className="text-xs text-emerald-600 mt-1">Arquivo carregado ({certPem.length} caracteres).</p>}
        </Field>
        <Field label="Chave (.key)" hint="selecione o arquivo — o conteúdo é lido automaticamente">
          <input type="file" accept=".key,.pem" className="input" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f, setKeyPem); }} />
          {keyPem && <p className="text-xs text-emerald-600 mt-1">Arquivo carregado ({keyPem.length} caracteres).</p>}
        </Field>
        {status?.configured && (
          <p className="text-xs text-slate-400">Campos deixados em branco mantêm o valor já salvo — dá para trocar só o ambiente ou a conta.</p>
        )}
      </div>

      {testResult && (
        <div className={`text-sm rounded-lg p-3 mt-4 break-words ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
          {testResult.ok ? '✅ ' : '❌ '}{testResult.msg}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <button className="btn-secondary" disabled={testing || !status?.configured} onClick={testConnection}
          title={status?.configured ? 'Só autentica no Inter — não gera cobrança' : 'Salve as credenciais primeiro'}>
          {testing ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />} Testar conexão
        </button>
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar credenciais'}
        </button>
      </div>
    </div>
  );
}