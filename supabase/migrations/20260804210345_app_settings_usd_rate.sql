/*
  # App settings — daily USD/BRL rate with spread

  ## Context
  A single-row settings table storing the spread applied on top of the
  daily USD/BRL market rate, plus a cache of the last fetched rate (so
  the app doesn't hit the public rate API on every page load — only once
  per day). The actual fetch happens client-side (the browser has
  internet access; this environment's own sandbox does not), against a
  free public API (AwesomeAPI economia).

  ## Table: app_settings
  Single-row table (id is always 'default'). Holds:
  - usd_spread_percent: user-configurable spread added on top of the
    market rate (default 5%)
  - usd_base_rate: last fetched raw USD/BRL market rate
  - usd_rate_updated_at: date the rate was last fetched (compared to
    today's date client-side to decide whether to refetch)
*/

CREATE TABLE IF NOT EXISTS app_settings (
  id text PRIMARY KEY DEFAULT 'default',
  usd_spread_percent numeric(6,2) NOT NULL DEFAULT 5,
  usd_base_rate numeric(12,4),
  usd_rate_updated_at date,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_crud_select" ON app_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "app_settings_crud_insert" ON app_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "app_settings_crud_update" ON app_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

INSERT INTO app_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
