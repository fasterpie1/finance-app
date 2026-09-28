import React, { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { usePreferences } from '../i18n';

const AUTH_REDIRECT_URL = 'https://finance-app-alpha-opal.vercel.app';

type AuthMode = 'signin' | 'signup' | 'checkEmail';

interface Props {
  children: (userId: string | null, signOut: () => void) => React.ReactNode;
}

const fieldStyle: React.CSSProperties = {
  background: '#0e0e0e', border: '1px solid #333', borderRadius: 8, color: '#f0f0f0',
  padding: '12px 14px', fontSize: 15, width: '100%', boxSizing: 'border-box', outline: 'none',
};
const labelStyle: React.CSSProperties = { display: 'block', color: '#bbb', fontSize: 13, fontWeight: 600, marginBottom: 6 };
const hintStyle: React.CSSProperties = { color: '#777', fontSize: 12, marginTop: 4 };

export const AuthPanel: React.FC<Props> = ({ children }) => {
  const { t } = usePreferences();
  const [userId, setUserId] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(Boolean(supabase));
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        console.error('Falha ao restaurar a sessão do Supabase:', error);
        setMessage(t('restoreSessionError'));
      }
      setUserId(data.session?.user.id ?? null);
      setInitializing(false);
    }).catch((error: unknown) => {
      if (!active) return;
      console.error('Falha ao restaurar a sessão do Supabase:', error);
      setMessage(t('restoreSessionError'));
      setInitializing(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') console.warn('Sessão encerrada pelo Supabase. Verifique expiração, armazenamento local e configuração do domínio.');
      setUserId(session?.user.id ?? null);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [t]);

  const authError = (raw: string): string => {
    if (/invalid login credentials/i.test(raw)) return t('invalidCredentials');
    if (/email not confirmed/i.test(raw)) return t('emailNotConfirmed');
    if (/already registered/i.test(raw)) return t('alreadyRegistered');
    if (/at least 6 characters/i.test(raw)) return t('passwordTooShort');
    return raw;
  };

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setMessage('');
    setPassword('');
    setConfirmPassword('');
  };

  const signIn = async () => {
    if (!supabase || !email.trim() || !password) return;
    setLoading(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMessage(authError(error.message));
    setLoading(false);
  };

  const signUp = async () => {
    if (!supabase || !email.trim() || !password) return;
    if (password !== confirmPassword) { setMessage(t('passwordMismatch')); return; }
    setLoading(true); setMessage('');
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: AUTH_REDIRECT_URL },
    });
    setLoading(false);
    if (error) { setMessage(authError(error.message)); return; }
    if (!data.session) {
      setPassword('');
      setConfirmPassword('');
      setMode('checkEmail');
    }
  };

  const signOut = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setMessage('');
    setMode('signin');
    void supabase?.auth.signOut();
  };

  if (!isSupabaseConfigured) return <>{children(null, signOut)}</>;
  if (initializing) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#777', background: '#0a0a0a' }}>{t('loading')}</div>;
  if (userId) return <>{children(userId, signOut)}</>;

  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0', display: 'grid', placeItems: 'center', padding: 20, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <section style={{ width: '100%', maxWidth: 420, background: '#111', border: '1px solid #1f1f1f', borderRadius: 16, padding: 32, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>

        {mode === 'signin' && (
          <>
            <h1 style={{ margin: '0 0 8px', fontSize: 24, color: '#fff' }}>Finança Pessoal</h1>
            <p style={{ margin: '0 0 24px', color: '#999', fontSize: 14, lineHeight: 1.5 }}>{t('loginDescription')}</p>
            <form onSubmit={(event) => { event.preventDefault(); void signIn(); }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label htmlFor="auth-email" style={labelStyle}>{t('emailLabel')}</label>
                <input id="auth-email" type="email" autoComplete="email" placeholder="voce@exemplo.com" value={email} onChange={(event) => setEmail(event.target.value)} style={fieldStyle} />
              </div>
              <div>
                <label htmlFor="auth-password" style={labelStyle}>{t('passwordLabel')}</label>
                <input id="auth-password" type="password" autoComplete="current-password" placeholder="••••••" value={password} onChange={(event) => setPassword(event.target.value)} style={fieldStyle} />
              </div>
              {message && <div role="alert" style={{ color: '#f87171', fontSize: 13, lineHeight: 1.5, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 12px' }}>{message}</div>}
              <button type="submit" disabled={loading || !email || !password} style={{ background: loading || !email || !password ? '#1e3a5f' : '#3b82f6', border: 0, borderRadius: 8, color: '#fff', padding: 13, fontSize: 15, fontWeight: 700, cursor: loading || !email || !password ? 'default' : 'pointer', transition: 'background 0.15s' }}>
                {loading ? t('loading') : t('login')}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#555', fontSize: 12 }}>
                <span style={{ flex: 1, height: 1, background: '#262626' }} />
                <span>{t('noAccount')}</span>
                <span style={{ flex: 1, height: 1, background: '#262626' }} />
              </div>
              <button type="button" onClick={() => switchMode('signup')} style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 8, color: '#93c5fd', padding: 13, fontSize: 15, fontWeight: 700, cursor: 'pointer', transition: 'background 0.15s' }}>
                {t('createAccount')}
              </button>
            </form>
          </>
        )}

        {mode === 'signup' && (
          <>
            <h1 style={{ margin: '0 0 8px', fontSize: 24, color: '#fff' }}>{t('signUpTitle')}</h1>
            <p style={{ margin: '0 0 20px', color: '#999', fontSize: 14, lineHeight: 1.5 }}>{t('signUpDescription')}</p>
            <div style={{ background: '#0d1420', border: '1px solid #1c2a3d', borderRadius: 10, padding: '14px 16px', marginBottom: 22 }}>
              <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>{t('signUpHowItWorks')}</div>
              <ol style={{ margin: 0, paddingLeft: 18, color: '#b8c4d4', fontSize: 13, lineHeight: 1.8 }}>
                <li>{t('signUpStep1')}</li>
                <li>{t('signUpStep2')}</li>
                <li>{t('signUpStep3')}</li>
              </ol>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void signUp(); }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label htmlFor="signup-email" style={labelStyle}>{t('emailLabel')}</label>
                <input id="signup-email" type="email" autoComplete="email" placeholder="voce@exemplo.com" value={email} onChange={(event) => setEmail(event.target.value)} style={fieldStyle} />
              </div>
              <div>
                <label htmlFor="signup-password" style={labelStyle}>{t('passwordLabel')}</label>
                <input id="signup-password" type="password" autoComplete="new-password" placeholder="••••••" value={password} onChange={(event) => setPassword(event.target.value)} style={fieldStyle} />
                <div style={hintStyle}>{t('passwordHint')}</div>
              </div>
              <div>
                <label htmlFor="signup-confirm" style={labelStyle}>{t('confirmPasswordLabel')}</label>
                <input id="signup-confirm" type="password" autoComplete="new-password" placeholder="••••••" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} style={fieldStyle} />
              </div>
              {message && <div role="alert" style={{ color: '#f87171', fontSize: 13, lineHeight: 1.5, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '10px 12px' }}>{message}</div>}
              <button type="submit" disabled={loading || !email || password.length < 6 || !confirmPassword} style={{ background: loading || !email || password.length < 6 || !confirmPassword ? '#1e3a5f' : '#3b82f6', border: 0, borderRadius: 8, color: '#fff', padding: 13, fontSize: 15, fontWeight: 700, cursor: loading || !email || password.length < 6 || !confirmPassword ? 'default' : 'pointer', transition: 'background 0.15s' }}>
                {loading ? t('loading') : t('createAccount')}
              </button>
              <button type="button" onClick={() => switchMode('signin')} style={{ background: 'transparent', border: 0, color: '#93c5fd', padding: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {t('hasAccount')} {t('login')}
              </button>
            </form>
          </>
        )}

        {mode === 'checkEmail' && (
          <>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', display: 'grid', placeItems: 'center', fontSize: 26, marginBottom: 18 }}>✉️</div>
            <h1 style={{ margin: '0 0 8px', fontSize: 24, color: '#fff' }}>{t('checkEmailTitle')}</h1>
            <p style={{ margin: '0 0 16px', color: '#999', fontSize: 14, lineHeight: 1.6 }}>{t('checkEmailBody')}</p>
            <div style={{ background: '#0e0e0e', border: '1px solid #262626', borderRadius: 8, padding: '10px 14px', color: '#e0e0e0', fontSize: 14, marginBottom: 22, wordBreak: 'break-all' }}>{email}</div>
            <button type="button" onClick={() => switchMode('signin')} style={{ background: '#3b82f6', border: 0, borderRadius: 8, color: '#fff', padding: 13, fontSize: 15, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
              {t('backToLogin')}
            </button>
          </>
        )}
      </section>
    </main>
  );
};
