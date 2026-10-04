// Sends pending portal notifications by e-mail (one digest per customer
// contact) through Resend, then stamps notifications.emailed_at.
//
// Triggered every 15 min by pg_cron (see migration portal_notifications).
// Deploy with verify_jwt = false; auth is the shared x-cron-secret header.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM ("Laser Tools <alertas@seudominio.com.br>"),
//          PORTAL_URL, CRON_SECRET
import { createClient } from 'npm:@supabase/supabase-js@2';

type Notification = {
  id: string; customer_id: string; type: string; title: string; body: string | null; created_at: string;
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TYPE_COLOR: Record<string, string> = {
  plan_overdue: '#dc2626',
  plan_due: '#d97706',
  warranty_ending: '#0284c7',
};

function renderEmail(name: string | null, items: Notification[], portalUrl: string) {
  const rows = items.map((n) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #e2e8f0">
      <div style="font-size:14px;font-weight:600;color:${TYPE_COLOR[n.type] ?? '#0f172a'}">${escapeHtml(n.title)}</div>
      ${n.body ? `<div style="font-size:13px;color:#475569;margin-top:4px">${escapeHtml(n.body)}</div>` : ''}
    </td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Inter,Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #e2e8f0">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #e2e8f0">
        <div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#0284c7;text-transform:uppercase">Laser Tools · Portal do Cliente</div>
        <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:6px">Olá${name ? `, ${escapeHtml(name)}` : ''}!</div>
        <div style="font-size:14px;color:#475569;margin-top:4px">Você tem ${items.length} alerta(s) sobre seus equipamentos:</div>
      </td></tr>
      <tr><td style="padding:4px 28px"><table width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
      <tr><td style="padding:24px 28px">
        <a href="${portalUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:12px">Abrir o portal</a>
        <div style="font-size:12px;color:#94a3b8;margin-top:18px">Para deixar de receber estes e-mails, desative os alertas por e-mail em Minha conta no portal.</div>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  const portalUrl = Deno.env.get('PORTAL_URL') ?? '';
  if (!resendKey || !from) return new Response('RESEND_API_KEY/EMAIL_FROM não configurados', { status: 500 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: pending, error } = await admin
    .from('notifications')
    .select('id, customer_id, type, title, body, created_at')
    .is('emailed_at', null)
    .order('created_at')
    .limit(500);
  if (error) return new Response(error.message, { status: 500 });
  if (!pending?.length) return Response.json({ sent: 0 });

  const byCustomer = new Map<string, Notification[]>();
  for (const n of pending as Notification[]) {
    byCustomer.set(n.customer_id, [...(byCustomer.get(n.customer_id) ?? []), n]);
  }

  const { data: users } = await admin
    .from('customer_users')
    .select('customer_id, email, full_name')
    .in('customer_id', [...byCustomer.keys()])
    .eq('active', true)
    .eq('email_notifications', true);

  let sent = 0;
  const failed = new Set<string>();
  for (const [customerId, items] of byCustomer) {
    const recipients = (users ?? []).filter((u) => u.customer_id === customerId);
    for (const u of recipients) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [u.email],
          subject: items.length === 1 ? items[0].title : `${items.length} alertas sobre seus equipamentos`,
          html: renderEmail(u.full_name, items, portalUrl),
        }),
      });
      if (res.ok) sent++;
      else {
        failed.add(customerId);
        console.error('resend error', customerId, res.status, await res.text());
      }
    }
  }

  // Stamp everything except customers whose send failed (retried next run).
  const done = (pending as Notification[]).filter((n) => !failed.has(n.customer_id)).map((n) => n.id);
  if (done.length) {
    await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', done);
  }

  return Response.json({ sent, failed: failed.size });
});
