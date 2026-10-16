import React, { useEffect, useState } from 'react';
import { disconnectGoogleCalendar, getGoogleCalendarStatus, startGoogleCalendarOAuth, type GoogleCalendarStatus } from '../services/googleCalendar';
import { readUserStorage, removeUserStorage, writeUserStorage } from '../services/userStorage';
import { usePreferences } from '../i18n';

interface Props {
  userId: string | null;
  onClearCalendarEventIds?: () => void;
}

const STATUS_STORAGE_KEY = 'google_calendar_status';

export const GoogleCalendarSettings: React.FC<Props> = ({ userId, onClearCalendarEventIds }) => {
  const { t } = usePreferences();
  const cachedStatus = userId ? readUserStorage(userId, STATUS_STORAGE_KEY) as GoogleCalendarStatus | null : null;
  const [status, setStatus] = useState<GoogleCalendarStatus>(cachedStatus === 'connected' || cachedStatus === 'expired' ? cachedStatus : 'disconnected');
  const [loading, setLoading] = useState(Boolean(userId) && !cachedStatus);
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        setErrorMessage(error instanceof Error ? error.message : t('googleErrorDescription'));
      })
      .finally(() => setLoading(false));
  }, [userId, t]);

  const connect = async () => {
    setWorking(true);
    setErrorMessage(null);
    let popup: Window | null = null;
    let pollId: number | undefined;
    // O popup pode se fechar sem nunca avisar de nada: quando o Google barra a tela de permissão
    // (app em modo de teste) a janela fica presa na página deles e ninguém responde ao aplicativo.
    let settled = false;
    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (pollId !== undefined) window.clearInterval(pollId);
      setWorking(false);
    };
    const onMessage = (event: MessageEvent<{ type?: string; status?: string }>) => {
      const allowedOrigins = new Set([window.location.origin, 'https://finance-app-alpha-opal.vercel.app']);
      if (!allowedOrigins.has(event.origin) || event.data?.type !== 'google-calendar-oauth') return;
      settled = true;
      if (event.data.status === 'connected') {
        setStatus('connected');
        setErrorMessage(null);
        writeUserStorage(userId, STATUS_STORAGE_KEY, 'connected');
      } else if (event.data.status === 'cancelled') {
        setStatus('disconnected');
        setErrorMessage(t('googleConnectCancelled'));
      } else {
        setStatus('error');
        setErrorMessage(t('googleErrorDescription'));
      }
      cleanup();
    };
    try {
      popup = window.open('', 'google-calendar-oauth', 'popup,width=520,height=720');
      if (!popup) throw new Error(t('googleErrorDescription'));
      await startGoogleCalendarOAuth(popup);
      if (!popup) throw new Error(t('googleErrorDescription'));
      window.addEventListener('message', onMessage);
      pollId = window.setInterval(() => {
        if (!popup?.closed) return;
        if (!settled) {
          setStatus('disconnected');
          setErrorMessage(t('googleConnectIncomplete'));
        }
        cleanup();
      }, 500);
    } catch (error) {
      popup?.close();
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : t('googleErrorDescription'));
      cleanup();
    }
  };

  const disconnect = async () => {
    setWorking(true);
    try {
      await disconnectGoogleCalendar();
      setStatus('disconnected');
      removeUserStorage(userId, STATUS_STORAGE_KEY);
      // Sem isso os calendarEventId armazenados ficam órfãos e os fluxos de
      // pagar/editar/disparar lembrete tentariam operar eventos inacessíveis.
      onClearCalendarEventIds?.();
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : t('googleErrorDescription'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="settings-group google-calendar-settings">
      <div className="settings-label">{t('integrations')}</div>
      <div className="google-calendar-heading">
        <div>
          <strong>{t('googleCalendar')}</strong>
          <small>{loading ? t('checkingConnection') : working ? t('googleConnectHint') : errorMessage ?? (status === 'connected' ? t('googleConnectedDescription') : status === 'expired' ? t('googleExpiredDescription') : status === 'error' ? t('googleErrorDescription') : t('integrationsDescription'))}</small>
        </div>
        {status === 'connected' && <span className="google-calendar-status is-connected">✓ {t('connected')}</span>}
        {status === 'expired' && <span className="google-calendar-status is-expired">⚠ {t('expired')}</span>}
      </div>
      {status === 'connected' ? (
        <>
          <button className="settings-action" type="button" onClick={() => void connect()} disabled={working}>
            <span>{working ? t('reconnecting') : t('reconnectGoogle')}</span><span className="settings-action-arrow">→</span>
          </button>
          <button className="settings-action" type="button" onClick={() => void disconnect()} disabled={working}>
            <span>{working ? t('disconnecting') : t('disconnectGoogle')}</span><span className="settings-action-arrow">→</span>
          </button>
        </>
      ) : (
        <button className="settings-action" type="button" onClick={() => void connect()} disabled={loading || working}>
          <span>{working ? t('connecting') : status === 'expired' || status === 'error' ? t('reconnectGoogle') : t('connectGoogle')}</span><span className="settings-action-arrow">→</span>
        </button>
      )}
    </div>
  );
};
