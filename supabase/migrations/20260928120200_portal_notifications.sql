/*
# Portal notifications: generation + e-mail dispatch schedule

1. `generate_portal_notifications()` inserts in-app notifications for:
   - maintenance plans due within `remind_days_before` days  (plan_due)
   - maintenance plans past due                              (plan_overdue)
   - purchased parts whose warranty ends within 30 days      (warranty_ending)
   `dedupe_key` makes it idempotent — safe to run any number of times.

2. pg_cron jobs:
   - daily 10:00 UTC (07:00 BRT): generate notifications
   - every 15 min: call the `send-notification-emails` Edge Function, which
     e-mails pending notifications through Resend and stamps `emailed_at`.

   The Edge Function call needs two Vault secrets (create them once in
   Dashboard → Project Settings → Vault, or via SQL):
     select vault.create_secret('https://<ref>.supabase.co', 'project_url');
     select vault.create_secret('<random string>', 'cron_secret');
   and the same `CRON_SECRET` set as an Edge Function secret.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION generate_portal_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_n integer;
BEGIN
  -- Due soon
  INSERT INTO notifications (customer_id, type, title, body, link, dedupe_key)
  SELECT p.customer_id, 'plan_due',
         'Manutenção próxima: ' || p.title,
         format('%s — vence em %s (%s dia(s)).', e.nickname, to_char(p.next_due_at, 'DD/MM/YYYY'), p.next_due_at - CURRENT_DATE),
         'plans:' || p.id,
         format('plan:%s:%s:due', p.id, p.next_due_at)
  FROM maintenance_plans p
  JOIN customer_equipments e ON e.id = p.equipment_id
  WHERE p.active AND e.status <> 'inativo'
    AND p.next_due_at >= CURRENT_DATE
    AND p.next_due_at <= CURRENT_DATE + p.remind_days_before
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- Overdue (one reminder per week while it stays overdue)
  INSERT INTO notifications (customer_id, type, title, body, link, dedupe_key)
  SELECT p.customer_id, 'plan_overdue',
         'Manutenção atrasada: ' || p.title,
         format('%s — venceu em %s (%s dia(s) de atraso).', e.nickname, to_char(p.next_due_at, 'DD/MM/YYYY'), CURRENT_DATE - p.next_due_at),
         'plans:' || p.id,
         format('plan:%s:%s:overdue:w%s', p.id, p.next_due_at, (CURRENT_DATE - p.next_due_at) / 7)
  FROM maintenance_plans p
  JOIN customer_equipments e ON e.id = p.equipment_id
  WHERE p.active AND e.status <> 'inativo'
    AND p.next_due_at < CURRENT_DATE
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- Warranty ending within 30 days
  INSERT INTO notifications (customer_id, type, title, body, link, dedupe_key)
  SELECT s.customer_id, 'warranty_ending',
         'Garantia terminando: ' || p.name,
         format('A garantia da peça %s (venda %s) termina em %s.',
                p.name, s.code, to_char(w.until, 'DD/MM/YYYY')),
         'purchases',
         format('warranty:%s', si.id)
  FROM sales s
  JOIN sale_items si ON si.sale_id = s.id
  JOIN parts p ON p.id = si.part_id
  CROSS JOIN LATERAL (SELECT (s.sale_date + make_interval(months => p.warranty_months))::date AS until) w
  WHERE s.customer_id IS NOT NULL
    AND s.status <> 'Cancelada'
    AND coalesce(p.warranty_months, 0) > 0
    AND w.until BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
    AND EXISTS (SELECT 1 FROM customer_users cu WHERE cu.customer_id = s.customer_id AND cu.active)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION generate_portal_notifications() FROM public, anon, authenticated;

-- Schedules (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job
   WHERE jobname IN ('portal-generate-notifications', 'portal-send-notification-emails');
END $$;

SELECT cron.schedule(
  'portal-generate-notifications',
  '0 10 * * *',
  $$ SELECT public.generate_portal_notifications(); $$
);

SELECT cron.schedule(
  'portal-send-notification-emails',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/send-notification-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )
  WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url')
    AND EXISTS (SELECT 1 FROM public.notifications WHERE emailed_at IS NULL);
  $$
);
