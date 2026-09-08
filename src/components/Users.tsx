import { useEffect, useState } from 'react';
import { ShieldCheck, Plus, Copy, Check } from 'lucide-react';
import { supabase, type Profile, ROLE_LABELS } from '../lib/supabase';
import { PageHeader, Badge, Modal, Field } from './ui';

const ROLES = Object.keys(ROLE_LABELS);

const generatePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
};

function NewUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('vendedor');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setError('');
    if (!fullName.trim() || !email.trim()) { setError('Preencha nome e e-mail.'); return; }
    setSaving(true);
    const password = generatePassword();
    const { error: e } = await supabase.rpc('admin_create_user', {
      p_email: email.trim(), p_full_name: fullName.trim(), p_role: role, p_password: password,
    });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setCreatedPassword(password);
    onCreated();
  };

  const copyPassword = () => {
    if (!createdPassword) return;
    navigator.clipboard.writeText(createdPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (createdPassword) {
    return (
      <Modal title="Usuário criado" onClose={onClose}>
        <div className="space-y-4">
          <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">
            Conta de <strong>{email}</strong> criada. Repasse a senha temporária abaixo — ela só aparece agora, uma vez.
          </div>
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-3">
            <code className="flex-1 text-sm font-mono text-slate-800 select-all">{createdPassword}</code>
            <button className="icon-btn" onClick={copyPassword} title="Copiar">
              {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
            </button>
          </div>
          <p className="text-xs text-slate-400">A pessoa pode trocar essa senha depois de logar, no menu lateral.</p>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Novo usuário" onClose={onClose}>
      <div className="space-y-4">
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
        <Field label="Nome"><input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        <Field label="E-mail"><input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Papel">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.filter((r) => r !== 'sem_papel').map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </Field>
        <p className="text-xs text-slate-400">Uma senha temporária é gerada automaticamente — você repassa pra pessoa depois.</p>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={saving} onClick={create}>{saving ? 'Criando...' : 'Criar usuário'}</button>
        </div>
      </div>
    </Modal>
  );
}

export default function Users({ myId }: { myId: string }) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at');
    setUsers((data as Profile[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const updateRole = async (id: string, role: string, active: boolean) => {
    setSavingId(id);
    setError('');
    const { error: e } = await supabase.rpc('admin_set_user_role', { target_id: id, new_role: role, new_active: active });
    setSavingId(null);
    if (e) { setError(e.message); return; }
    load();
  };

  return (
    <div>
      <PageHeader
        title="Usuários"
        subtitle="Quem tem acesso ao sistema e o que cada um pode ver"
        action={<button className="btn-primary flex items-center gap-1.5" onClick={() => setCreating(true)}><Plus size={16} /> Novo usuário</button>}
      />

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="th">Nome</th>
              <th className="th">E-mail</th>
              <th className="th">Papel</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={4} className="td text-center text-slate-400 py-8">Carregando...</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50/50">
                <td className="td font-medium text-slate-900">
                  {u.full_name || '—'}
                  {u.id === myId && <span className="ml-2 text-xs text-sky-600">(você)</span>}
                </td>
                <td className="td text-slate-600">{u.email}</td>
                <td className="td">
                  <select
                    className="input py-1.5 text-sm"
                    value={u.role}
                    disabled={savingId === u.id || u.id === myId}
                    onChange={(e) => updateRole(u.id, e.target.value, u.active)}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </td>
                <td className="td">
                  <button
                    disabled={savingId === u.id || u.id === myId}
                    onClick={() => updateRole(u.id, u.role, !u.active)}
                  >
                    <Badge tone={u.active ? 'green' : 'red'}>{u.active ? 'Ativo' : 'Bloqueado'}</Badge>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-2 mt-4 text-xs text-slate-400">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <p>
          Contas criadas por auto-cadastro chegam como "Sem papel" — sem acesso a nenhuma tela — até você atribuir um papel.
          Você não pode alterar seu próprio papel ou se bloquear (evita ficar trancado fora do sistema por engano).
        </p>
      </div>

      {creating && <NewUserModal onClose={() => setCreating(false)} onCreated={load} />}
    </div>
  );
}
