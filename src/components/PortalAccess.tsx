import { useEffect, useState } from 'react';
import { Send, RotateCw, UserX, UserCheck } from 'lucide-react';
import { supabase, type Customer, formatDate } from '../lib/supabase';
import { Modal, Field, Badge } from './ui';

type PortalUser = {
  user_id: string;
  email: string;
  full_name: string | null;
  active: boolean;
  email_notifications: boolean;
  invited_at: string;
};

// Invites go through the `invite-portal-user` Edge Function, which needs the
// service role to create the auth user — the browser can't do that itself.
export default function PortalAccess({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [email, setEmail] = useState(customer.email ?? '');
  const [fullName, setFullName] = useState(customer.contact_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const load = async () => {
    const { data } = await supabase
      .from('customer_users')
      .select('user_id, email, full_name, active, email_notifications, invited_at')
      .eq('customer_id', customer.id)
      .order('invited_at');
    setUsers((data as PortalUser[]) ?? []);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [customer.id]);

  const call = async (body: Record<string, unknown>) => {
    setError(''); setInfo('');
    setBusy(true);
    const { data, error: e } = await supabase.functions.invoke('invite-portal-user', { body });
    setBusy(false);
    if (e) {
      // FunctionsHttpError carries the JSON body in `context`
      let msg = e.message;
      try { msg = (await (e as { context: Response }).context.json()).error ?? msg; } catch { /* keep message */ }
      setError(msg);
      return false;
    }
    if (data?.error) { setError(data.error); return false; }
    return true;
  };

  const invite = async () => {
    if (!email.trim()) { setError('Informe o e-mail.'); return; }
    if (await call({ action: 'invite', customer_id: customer.id, email: email.trim(), full_name: fullName.trim() || null })) {
      setInfo(`Convite enviado para ${email.trim()}.`);
      setEmail(''); setFullName('');
      load();
    }
  };

  const resend = async (u: PortalUser) => {
    if (await call({ action: 'resend', email: u.email })) setInfo(`Link de acesso reenviado para ${u.email}.`);
  };

  const toggle = async (u: PortalUser) => {
    await supabase.from('customer_users').update({ active: !u.active }).eq('user_id', u.user_id);
    load();
  };

  return (
    <Modal title={`Portal do Cliente — ${customer.name}`} onClose={onClose} wide>
      <div className="space-y-5">
        <p className="text-sm text-slate-500">
          Pessoas deste cliente que podem entrar no portal para registrar manutenções, ver custos e receber alertas.
          Elas veem apenas os dados deste cliente e as compras feitas com a Laser Tools (preço de venda — nunca custo ou margem).
        </p>

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
        {info && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">{info}</div>}

        {users.length > 0 && (
          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            {users.map((u) => (
              <div key={u.user_id} className="flex items-center gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">{u.full_name || u.email}</div>
                  <div className="text-xs text-slate-400">{u.email} · convidado em {formatDate(u.invited_at)}{u.email_notifications ? '' : ' · alertas por e-mail desligados'}</div>
                </div>
                <Badge tone={u.active ? 'green' : 'slate'}>{u.active ? 'Ativo' : 'Desativado'}</Badge>
                <button className="icon-btn" title="Reenviar link de acesso" disabled={busy} onClick={() => resend(u)}><RotateCw size={15} /></button>
                <button className="icon-btn" title={u.active ? 'Desativar acesso' : 'Reativar acesso'} onClick={() => toggle(u)}>
                  {u.active ? <UserX size={15} /> : <UserCheck size={15} />}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl bg-slate-50 p-4 space-y-3">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Convidar pessoa</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="E-mail"><input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Nome"><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" disabled={busy} onClick={invite}><Send size={16} /> {busy ? 'Enviando...' : 'Enviar convite'}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
