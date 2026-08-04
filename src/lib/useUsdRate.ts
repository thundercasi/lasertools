import { useEffect, useState, useCallback } from 'react';
import { supabase, type AppSettings } from './supabase';

const today = () => new Date().toISOString().slice(0, 10);

export type UsdRateInfo = {
  loading: boolean;
  error: string;
  baseRate: number | null;      // raw market rate (no spread)
  spreadPercent: number;         // e.g. 5 means +5%
  effectiveRate: number | null;  // baseRate * (1 + spreadPercent/100) — use this to auto-fill fields
  updatedAt: string | null;      // date (YYYY-MM-DD) the rate was fetched
  refresh: () => Promise<void>;
};

// Fetches the USD/BRL market rate from a free public API (AwesomeAPI),
// caching it in app_settings for the day so we don't refetch on every
// page load — only once per calendar day, or when the user forces a
// manual refresh.
export function useUsdRate(): UsdRateInfo {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const fetchFreshRate = useCallback(async (spreadPercent: number) => {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
    if (!res.ok) throw new Error('Falha ao consultar a cotação do dólar.');
    const data = await res.json();
    const bid = Number(data?.USDBRL?.bid);
    if (!bid || !isFinite(bid)) throw new Error('Resposta inválida da API de cotação.');
    const { data: saved, error: err } = await supabase
      .from('app_settings')
      .update({ usd_base_rate: bid, usd_rate_updated_at: today(), updated_at: new Date().toISOString() })
      .eq('id', 'default')
      .select('*')
      .single();
    if (err) throw err;
    return saved as AppSettings;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let { data: row } = await supabase.from('app_settings').select('*').eq('id', 'default').maybeSingle();
      if (!row) {
        const { data: created } = await supabase.from('app_settings').insert({ id: 'default' }).select('*').single();
        row = created as AppSettings;
      }
      if (!row.usd_rate_updated_at || row.usd_rate_updated_at !== today()) {
        try {
          row = await fetchFreshRate(Number(row.usd_spread_percent));
        } catch (e: any) {
          // Keep the stale cached rate if the live fetch fails (e.g. offline);
          // just surface the error so the UI can show it if useful.
          setError(e?.message || 'Não foi possível atualizar a cotação agora.');
        }
      }
      setSettings(row as AppSettings);
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar configurações de câmbio.');
    } finally {
      setLoading(false);
    }
  }, [fetchFreshRate]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const spread = Number(settings?.usd_spread_percent ?? 5);
      const row = await fetchFreshRate(spread);
      setSettings(row);
    } catch (e: any) {
      setError(e?.message || 'Não foi possível atualizar a cotação agora.');
    } finally {
      setLoading(false);
    }
  }, [fetchFreshRate, settings]);

  const spreadPercent = Number(settings?.usd_spread_percent ?? 5);
  const baseRate = settings?.usd_base_rate != null ? Number(settings.usd_base_rate) : null;
  const effectiveRate = baseRate != null ? Number((baseRate * (1 + spreadPercent / 100)).toFixed(4)) : null;

  return { loading, error, baseRate, spreadPercent, effectiveRate, updatedAt: settings?.usd_rate_updated_at ?? null, refresh };
}
