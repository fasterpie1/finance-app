import React, { useEffect, useState } from 'react';
import { disconnectGoogleCalendar, getGoogleCalendarStatus, startGoogleCalendarOAuth, type GoogleCalendarStatus } from '../services/googleCalendar';

interface Props {
  userId: string | null;
}

const STATUS_COPY: Record<GoogleCalendarStatus, string> = {
  disconnected: 'Conecte seu Google Agenda para receber lembretes de vencimentos e pagamentos.',
  connected: 'O aplicativo pode criar e gerenciar eventos relacionados aos seus pagamentos.',
  expired: 'A autorização expirou. Reconecte seu Google Agenda para continuar.',
  error: 'Não foi possível verificar a conexão agora. Tente novamente.',
};

export const GoogleCalendarSettings: React.FC<Props> = ({ userId }) => {
  const [status, setStatus] = useState<GoogleCalendarStatus>('disconnected');
  const [loading, setLoading] = useState(Boolean(userId));
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const result = new URLSearchParams(window.location.search).get('google_calendar');
    if (result) window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    void getGoogleCalendarStatus()
      .then((nextStatus) => setStatus(result === 'error' ? 'error' : nextStatus))
      .catch(() => setStatus('error'))
      .finally(() => setLoading(false));
  }, [userId]);

  const connect = async () => {
    setWorking(true);
    try {
      await startGoogleCalendarOAuth();
    } catch {
      setStatus('error');
      setWorking(false);
    }
  };

  const disconnect = async () => {
    setWorking(true);
    try {
      await disconnectGoogleCalendar();
      setStatus('disconnected');
    } catch {
      setStatus('error');
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
          <small>{loading ? 'Verificando conexão...' : STATUS_COPY[status]}</small>
        </div>
        {status === 'connected' && <span className="google-calendar-status is-connected">✓ Conectado</span>}
        {status === 'expired' && <span className="google-calendar-status is-expired">⚠ Expirada</span>}
      </div>
      {status === 'connected' ? (
        <button className="settings-action" type="button" onClick={() => void disconnect()} disabled={working}>
          <span>{working ? 'Desconectando...' : 'Desconectar Google Agenda'}</span><span className="settings-action-arrow">→</span>
        </button>
      ) : (
        <button className="settings-action" type="button" onClick={() => void connect()} disabled={loading || working}>
          <span>{working ? 'Conectando...' : status === 'expired' ? 'Reconectar Google Agenda' : 'Conectar Google Agenda'}</span><span className="settings-action-arrow">→</span>
        </button>
      )}
    </div>
  );
};
