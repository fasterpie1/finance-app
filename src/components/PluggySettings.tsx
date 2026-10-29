import React from 'react';
import { usePreferences } from '../i18n';
import { type usePluggy } from '../hooks/usePluggy';

type Props = {
  userId: string | null;
  integration: ReturnType<typeof usePluggy>;
};

const copy = {
  'pt-BR': {
    title: 'Open Finance (Pluggy)',
    description: 'Conecte seu cartão pelo Pluggy. As compras só entram na fatura depois da sua revisão.',
    connect: 'Conectar instituição',
    addAnother: 'Adicionar outra instituição',
    sync: 'Buscar compras disponíveis',
    checking: 'Verificando conexões...',
    signIn: 'Entre na sua conta para conectar uma instituição.',
    none: 'Nenhuma instituição conectada.',
    trial: 'O teste de produção da Pluggy é temporário; configure as credenciais no servidor, nunca neste navegador.',
    syncTiming: 'A busca lê o que o banco já disponibilizou no Pluggy; novas compras podem levar um tempo para aparecer.',
  },
  en: {
    title: 'Open Finance (Pluggy)',
    description: 'Connect your card through Pluggy. Purchases enter the invoice only after your review.',
    connect: 'Connect institution',
    addAnother: 'Add another institution',
    sync: 'Fetch available purchases',
    checking: 'Checking connections...',
    signIn: 'Sign in to connect an institution.',
    none: 'No institution connected.',
    trial: 'Pluggy production trials are temporary; configure credentials on the server, never in this browser.',
    syncTiming: 'This fetch reads what the bank has already made available through Pluggy; new purchases may take time to appear.',
  },
} as const;

export const PluggySettings: React.FC<Props> = ({ userId, integration }) => {
  const { locale } = usePreferences();
  const text = copy[locale];

  return (
    <div className="settings-group">
      <div className="settings-label">{text.title}</div>
      <div className="google-calendar-heading">
        <div>
          <strong>{integration.items.length > 0 ? integration.items.map((item) => item.connector_name).join(', ') : text.title}</strong>
          <small>
            {integration.loading
              ? text.checking
              : integration.errorMessage ? text.none : !userId ? text.signIn : integration.items.length > 0 ? text.description : text.none}
          </small>
        </div>
        {integration.items.length > 0 && <span className="google-calendar-status is-connected">✓ {locale === 'en' ? 'Connected' : 'Conectado'}</span>}
      </div>
      {integration.items.length === 0 ? (
        <button className="settings-action" type="button" onClick={() => void integration.connect()} disabled={!userId || integration.loading || integration.working}>
          <span>{integration.working ? (locale === 'en' ? 'Connecting...' : 'Conectando...') : text.connect}</span>
          <span className="settings-action-arrow">→</span>
        </button>
      ) : (
        <>
          <button className="settings-action" type="button" onClick={() => void integration.sync()} disabled={!userId || integration.working}>
            <span>{integration.working ? (locale === 'en' ? 'Searching...' : 'Buscando...') : text.sync}</span>
            <span className="settings-action-arrow">→</span>
          </button>
          <button className="settings-action" type="button" onClick={() => void integration.connect()} disabled={!userId || integration.working}>
            <span>{text.addAnother}</span>
            <span className="settings-action-arrow">→</span>
          </button>
          {integration.items.map((item) => (
            <small key={item.item_id} style={{ display: 'block', color: '#777', marginTop: 6 }}>
              {item.connector_name} · {item.status}{item.last_synced_at
                ? ` · ${new Date(item.last_synced_at).toLocaleString(locale === 'en' ? 'en-US' : 'pt-BR')}`
                : ''}
            </small>
          ))}
        </>
      )}
      {integration.notice && <small role="status" style={{ display: 'block', color: '#4ade80', marginTop: 8 }}>{integration.notice}</small>}
      {integration.errorMessage && <small role="alert" style={{ display: 'block', color: '#f87171', marginTop: 8 }}>{integration.errorMessage}</small>}
      <small style={{ display: 'block', color: '#777', lineHeight: 1.5, marginTop: 8 }}>{text.trial}</small>
      <small style={{ display: 'block', color: '#777', lineHeight: 1.5, marginTop: 6 }}>{text.syncTiming}</small>
    </div>
  );
};
