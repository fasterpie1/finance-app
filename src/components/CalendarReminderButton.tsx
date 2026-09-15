import React from 'react';

interface Props {
  added: boolean;
  loading?: boolean;
  onClick: () => void;
}

export const CalendarReminderButton: React.FC<Props> = ({ added, loading = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={added || loading}
    title={added ? 'Lembrete já adicionado ao Google Agenda' : 'Adicionar lembrete ao Google Agenda'}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${added ? '#173522' : '#1e2a3e'}`,
      borderRadius: 5, background: added ? '#0d1a12' : '#111520', color: added ? '#4ade80' : '#60a5fa',
      cursor: added || loading ? 'default' : 'pointer', padding: '3px 7px', fontSize: 9, fontWeight: 600,
      opacity: loading ? 0.6 : 1,
    }}
  >
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M12 14v4M10 16h4" />
    </svg>
    {loading ? 'Adicionando...' : added ? 'Já adicionado' : 'Lembrar'}
  </button>
);