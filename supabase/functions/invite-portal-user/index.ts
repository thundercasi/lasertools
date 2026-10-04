// Invites a customer contact to the customer portal.
//
// Called from the ERP (Clientes → Acesso ao portal) by a signed-in staff
// member. Body:
//   { action: 'invite', customer_id, email, full_name? }
//   { action: 'resend', email }            → sends a new "set password" e-mail
//
// Secrets: PORTAL_URL (e.g. https://thundercasi.github.io/portal/)
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const portalUrl = Deno.env.get('PORTAL_URL');
  if (!portalUrl) return json({ error: 'PORTAL_URL não configurada' }, 500);

  // Caller must be staff
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData } = await caller.auth.getUser();
  if (!userData.user) return json({ error: 'Não autenticado' }, 401);
  const { data: isStaff } = await caller.rpc('is_staff');
  if (!isStaff) return json({ error: 'Apenas a equipe Laser Tools pode convidar clientes' }, 403);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: { action?: string; customer_id?: string; email?: string; full_name?: string };
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'E-mail inválido' }, 400);

  if (body.action === 'resend') {
    const { error } = await caller.auth.resetPasswordForEmail(email, { redirectTo: portalUrl });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  if (!body.customer_id) return json({ error: 'customer_id obrigatório' }, 400);

  const { data: customer } = await admin.from('customers').select('id').eq('id', body.customer_id).maybeSingle();
  if (!customer) return json({ error: 'Cliente não encontrado' }, 404);

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { portal: true, full_name: body.full_name ?? null },
    redirectTo: portalUrl,
  });
  if (inviteError || !invited.user) {
    const msg = inviteError?.message ?? 'Falha ao convidar';
    return json({
      error: /already|registered|exists/i.test(msg)
        ? 'Este e-mail já tem uma conta. Use outro e-mail ou peça para a pessoa usar "Esqueci minha senha".'
        : msg,
    }, 400);
  }
  const userId = invited.user.id;

  // The ERP's signup trigger may have created a 'sem_papel' staff profile
  // for this user — portal customers must not show up in ERP → Usuários.
  await admin.from('profiles').delete().eq('id', userId).eq('role', 'sem_papel');

  const { error: linkError } = await admin.from('customer_users').insert({
    user_id: userId,
    customer_id: body.customer_id,
    email,
    full_name: body.full_name ?? null,
    invited_by: userData.user.id,
  });
  if (linkError) {
    await admin.auth.admin.deleteUser(userId);
    return json({ error: linkError.message }, 400);
  }

  return json({ ok: true, user_id: userId });
});
