import React, { useEffect, useState } from 'react';
import { disconnectGoogleCalendar, getGoogleCalendarStatus, startGoogleCalendarOAuth, type GoogleCalendarStatus } from '../services/googleCalendar';
import { readUserStorage, removeUserStorage, writeUserStorage } from '../services/userStorage';

interface Props {
  userId: string | null;
  onReauthenticate: (email: string, password: string) => Promise<string | null>;
}

const STATUS_COPY: Record<GoogleCalendarStatus, string> = {
  disconnected: 'Conecte seu Google Agenda para receber lembretes de vencimentos e pagamentos.',
  connected: 'O aplicativo pode criar e gerenciar eventos relacionados aos seus pagamentos.',
  expired: 'A autorização expirou. Reconecte seu Google Agenda para continuar.',
  error: 'Não foi possível verificar a conexão agora. Tente novamente.',
};

const STATUS_STORAGE_KEY = 'google_calendar_status';

export const GoogleCalendarSettings: React.FC<Props> = ({ userId, onReauthenticate }) => {
  const cachedStatus = userId ? readUserStorage(userId, STATUS_STORAGE_KEY) as GoogleCalendarStatus | null : null;
  const [status, setStatus] = useState<GoogleCalendarStatus>(cachedStatus === 'connected' || cachedStatus === 'expired' ? cachedStatus : 'disconnected');
  const [loading, setLoading] = useState(Boolean(userId) && !cachedStatus);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reauthEmail, setReauthEmail] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthLoading, setReauthLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const result = new URLSearchParams(window.location.search).get('google_calendar');
    if (result) window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    void getGoogleCalendarStatus()
      .then((nextStatus) => {
        const resolvedStatus = result === 'error' ? 'error' : nextStatus;
        setStatus(resolvedStatus);
        setErrorMessage(null);
        if (resolvedStatus === 'connected' || resolvedStatus === 'expired') writeUserStorage(userId, STATUS_STORAGE_KEY, resolvedStatus);
      })
      .catch((error: unknown) => {
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Não foi possível verificar a conexão agora.');
      })
      .finally(() => setLoading(false));
  }, [userId]);

  const connect = async () => {
    setWorking(true);
    try {
      await startGoogleCalendarOAuth();
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível iniciar a conexão.');
      setWorking(false);
    }
  };

  const disconnect = async () => {
    setWorking(true);
    try {
      await disconnectGoogleCalendar();
      setStatus('disconnected');
      removeUserStorage(userId, STATUS_STORAGE_KEY);
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível desconectar o Google Agenda.');
    } finally {
      setWorking(false);
    }
  };

  const reauthenticate = async () => {
    if (!reauthEmail.trim() || !reauthPassword) return;
    setReauthLoading(true);
    const error = await onReauthenticate(reauthEmail, reauthPassword);
    if (error) setErrorMessage(error);
    else {
      setErrorMessage(null);
      setStatus('expired');
      setReauthPassword('');
      try {
        const nextStatus = await getGoogleCalendarStatus();
        setStatus(nextStatus);
        if (nextStatus === 'connected' || nextStatus === 'expired') writeUserStorage(userId, STATUS_STORAGE_KEY, nextStatus);
      } catch (statusError) {
        setErrorMessage(statusError instanceof Error ? statusError.message : 'Sessão renovada. Tente reconectar o Google Agenda.');
      }
    }
    setReauthLoading(false);
  };

  return (
    <div className="settings-group google-calendar-settings">
      <div className="settings-label">Integrações</div>
      <div className="google-calendar-heading">
        <div>
          <strong>Google Agenda</strong>
          <small>{loading ? 'Verificando conexão...' : errorMessage ?? STATUS_COPY[status]}</small>
        </div>
        {status === 'connected' && <span className="google-calendar-status is-connected">✓ Conectado</span>}
        {status === 'expired' && <span className="google-calendar-status is-expired">⚠ Expirada</span>}
      </div>
      {errorMessage?.includes('sessão do aplicativo') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12, padding: 10, background: '#111520', border: '1px solid #1e2a3e', borderRadius: 7 }}>
          <input type="email" value={reauthEmail} onChange={(event) => setReauthEmail(event.target.value)} placeholder="E-mail da conta" aria-label="E-mail para renovar sessão" style={{ background: '#0e0e0e', border: '1px solid #252525', borderRadius: 5, color: '#e0e0e0', padding: '8px 10px', fontSize: 12 }} />
          <input type="password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void reauthenticate(); }} placeholder="Senha da conta" aria-label="Senha para renovar sessão" style={{ background: '#0e0e0e', border: '1px solid #252525', borderRadius: 5, color: '#e0e0e0', padding: '8px 10px', fontSize: 12 }} />
          <button type="button" onClick={() => void reauthenticate()} disabled={reauthLoading || !reauthEmail.trim() || !reauthPassword} className="settings-action" style={{ cursor: reauthLoading ? 'wait' : 'pointer' }}>{reauthLoading ? 'Renovando sessão...' : 'Renovar sessão do app'}</button>
        </div>
      )}
      {status === 'connected' ? (
        <button className="settings-action" type="button" onClick={() => void disconnect()} disabled={working}>
          <span>{working ? 'Desconectando...' : 'Desconectar Google Agenda'}</span><span className="settings-action-arrow">→</span>
        </button>
      ) : (
        <button className="settings-action" type="button" onClick={() => void connect()} disabled={loading || working}>
          <span>{working ? 'Conectando...' : status === 'expired' || status === 'error' ? 'Reconectar Google Agenda' : 'Conectar Google Agenda'}</span><span className="settings-action-arrow">→</span>
        </button>
      )}
    </div>
  );
};
