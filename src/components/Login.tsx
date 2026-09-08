import { useState } from 'react';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import logo from '../assets/logo.png';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async () => {
    setError('');
    setInfo('');
    if (!email.trim() || !password) { setError('Preencha e-mail e senha.'); return; }
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) { setError('E-mail ou senha inválidos.'); return; }
      } else {
        if (password.length < 6) { setError('A senha precisa ter pelo menos 6 caracteres.'); return; }
        const { data, error: e } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { full_name: fullName.trim() || null } },
        });
        if (e) { setError(e.message); return; }
        if (data.session) {
          // Email confirmation is disabled on the project — signed in right away.
        } else {
          setInfo('Conta criada! Verifique seu e-mail para confirmar o acesso. Depois disso, peça a um administrador para liberar seu papel de acesso.');
          setMode('login');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={logo} alt="Laser Tools Components" className="w-64 object-contain" />
        </div>

        <div className="card p-6">
          <h1 className="text-base font-bold text-slate-900 mb-4">
            {mode === 'login' ? 'Entrar no sistema' : 'Criar conta'}
          </h1>

          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-4">{error}</div>}
          {info && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 mb-4">{info}</div>}

          <div className="space-y-3">
            {mode === 'signup' && (
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Nome</label>
                <input className="input mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">E-mail</label>
              <input
                type="email" className="input mt-1" value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Senha</label>
              <input
                type="password" className="input mt-1" value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </div>
          </div>

          <button className="btn-primary w-full mt-5 flex items-center justify-center gap-2" disabled={loading} onClick={submit}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
            {loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>

          <button
            className="w-full mt-3 text-xs text-slate-400 hover:text-slate-600"
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setInfo(''); }}
          >
            {mode === 'login' ? 'Não tem conta? Criar uma' : 'Já tem conta? Entrar'}
          </button>
        </div>

        {mode === 'signup' && (
          <p className="text-xs text-slate-400 text-center mt-4">
            Sua conta é criada sem acesso a nenhuma tela — um administrador precisa liberar seu papel depois.
          </p>
        )}
      </div>
    </div>
  );
}
