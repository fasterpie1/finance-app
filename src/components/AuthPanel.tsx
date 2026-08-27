import React, { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase';

interface Props {
  children: (userId: string | null, signOut: () => void) => React.ReactNode;
}

export const AuthPanel: React.FC<Props> = ({ children }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(Boolean(supabase));
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setUserId(data.session?.user.id ?? null); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    if (!supabase || !email.trim() || !password) return;
    setLoading(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMessage(error.message);
    setLoading(false);
  };

  const signUp = async () => {
    if (!supabase || !email.trim() || !password) return;
    setLoading(true); setMessage('');
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) setMessage(error.message);
    else if (!data.session) setMessage('Conta criada. Confirme seu e-mail para entrar.');
    setLoading(false);
  };
  const signOut = () => { void supabase?.auth.signOut(); };

  if (!isSupabaseConfigured) return <>{children(null, signOut)}</>;
  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#777', background: '#0a0a0a' }}>Carregando...</div>;
  if (userId) return <>{children(userId, signOut)}</>;

  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0', display: 'grid', placeItems: 'center', padding: 20, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <section style={{ width: '100%', maxWidth: 400, background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, padding: 24 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>Finança Pessoal</h1>
        <p style={{ margin: '0 0 22px', color: '#666', fontSize: 13 }}>Entre para acessar seus dados financeiros.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="email" placeholder="Seu e-mail" value={email} onChange={(event) => setEmail(event.target.value)} style={{ background: '#0e0e0e', border: '1px solid #292929', borderRadius: 6, color: '#eee', padding: 11, fontSize: 14 }} />
          <input type="password" placeholder="Senha (mínimo 6 caracteres)" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && signIn()} style={{ background: '#0e0e0e', border: '1px solid #292929', borderRadius: 6, color: '#eee', padding: 11, fontSize: 14 }} />
          {message && <div style={{ color: message.includes('criada') ? '#4ade80' : '#ef4444', fontSize: 12, lineHeight: 1.4 }}>{message}</div>}
          <button onClick={signIn} disabled={loading || !email || !password} style={{ background: '#3b82f6', border: 0, borderRadius: 6, color: '#fff', padding: 11, fontWeight: 600, cursor: 'pointer' }}>Entrar</button>
          <button onClick={signUp} disabled={loading || !email || password.length < 6} style={{ background: 'transparent', border: '1px solid #292929', borderRadius: 6, color: '#aaa', padding: 11, fontWeight: 600, cursor: 'pointer' }}>Criar conta</button>
        </div>
      </section>
    </main>
  );
};
