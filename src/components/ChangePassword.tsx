import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Modal, Field } from './ui';

export default function ChangePassword({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const save = async () => {
    setError('');
    if (password.length < 6) { setError('A senha precisa ter pelo menos 6 caracteres.'); return; }
    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    setSaving(true);
    const { error: e } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setDone(true);
  };

  return (
    <Modal title="Trocar senha" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">Senha alterada com sucesso.</div>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={onClose}>Fechar</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}
          <Field label="Nova senha">
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirmar nova senha">
            <input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando...' : 'Salvar'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
