import React, { useEffect, useState } from 'react';
import { disconnectGoogleCalendar, getGoogleCalendarStatus, startGoogleCalendarOAuth, type GoogleCalendarStatus } from '../services/googleCalendar';
import { readUserStorage, removeUserStorage, writeUserStorage } from '../services/userStorage';

interface Props {
  userId: string | null;
}

const STATUS_COPY: Record<GoogleCalendarStatus, string> = {
  disconnected: 'Conecte seu Google Agenda para receber lembretes de vencimentos e pagamentos.',
  connected: 'O aplicativo pode criar e gerenciar eventos relacionados aos seus pagamentos.',
  expired: 'A autorização expirou. Reconecte seu Google Agenda para continuar.',
  error: 'Não foi possível verificar a conexão agora. Tente novamente.',
};

const STATUS_STORAGE_KEY = 'google_calendar_status';

export const GoogleCalendarSettings: React.FC<Props> = ({ userId }) => {
  const cachedStatus = userId ? readUserStorage(userId, STATUS_STORAGE_KEY) as GoogleCalendarStatus | null : null;
  const [status, setStatus] = useState<GoogleCalendarStatus>(cachedStatus === 'connected' || cachedStatus === 'expired' ? cachedStatus : 'disconnected');
  const [loading, setLoading] = useState(Boolean(userId) && !cachedStatus);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    const result = new URLSearchParams(window.location.search).get('google_calendar');
    if (window.opener && result) {
      window.opener.postMessage({ type: 'google-calendar-oauth', status: result }, '*');
      window.close();
      return;
    }
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
    let popup: Window | null = null;
    let pollId: number | undefined;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (pollId !== undefined) window.clearInterval(pollId);
      setWorking(false);
    };
    const onMessage = (event: MessageEvent<{ type?: string; status?: string }>) => {
      const allowedOrigins = new Set([window.location.origin, 'https://finance-app-alpha-opal.vercel.app']);
      if (!allowedOrigins.has(event.origin) || event.data?.type !== 'google-calendar-oauth') return;
      const nextStatus = event.data.status === 'connected' ? 'connected' : 'error';
      setStatus(nextStatus);
      setErrorMessage(nextStatus === 'error' ? 'Não foi possível concluir a conexão com o Google Agenda.' : null);
      if (nextStatus === 'connected') writeUserStorage(userId, STATUS_STORAGE_KEY, nextStatus);
      cleanup();
    };
    try {
      popup = window.open('', 'google-calendar-oauth', 'popup,width=520,height=720');
      if (!popup) throw new Error('O navegador bloqueou a janela de autorização do Google. Permita popups para este site e tente novamente.');
      await startGoogleCalendarOAuth(popup);
      if (!popup) throw new Error('O navegador bloqueou a janela de autorização do Google. Permita popups para este site e tente novamente.');
      window.addEventListener('message', onMessage);
      pollId = window.setInterval(() => {
        if (popup?.closed) cleanup();
      }, 500);
    } catch (error) {
      popup?.close();
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Não foi possível iniciar a conexão.');
      cleanup();
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
      {status === 'connected' ? (
        <>
          <button className="settings-action" type="button" onClick={() => void connect()} disabled={working}>
            <span>{working ? 'Reconectando...' : 'Reconectar Google Agenda'}</span><span className="settings-action-arrow">→</span>
          </button>
          <button className="settings-action" type="button" onClick={() => void disconnect()} disabled={working}>
            <span>{working ? 'Desconectando...' : 'Desconectar Google Agenda'}</span><span className="settings-action-arrow">→</span>
          </button>
        </>
      ) : (
        <button className="settings-action" type="button" onClick={() => void connect()} disabled={loading || working}>
          <span>{working ? 'Conectando...' : status === 'expired' || status === 'error' ? 'Reconectar Google Agenda' : 'Conectar Google Agenda'}</span><span className="settings-action-arrow">→</span>
        </button>
      )}
    </div>
  );
};
