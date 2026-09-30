import React from 'react';
import { usePreferences } from '../i18n';

interface Props {
  added: boolean;
  loading?: boolean;
  onClick: () => void;
}

export const CalendarReminderButton: React.FC<Props> = ({ added, loading = false, onClick }) => {
  const { t } = usePreferences();
  return (
  <button
    type="button"
    onClick={onClick}
    disabled={added || loading}
    className={added ? 'theme-reminder-btn is-added' : 'theme-reminder-btn'}
    title={added ? t('reminderAddedTitle') : t('reminderAddTitle')}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${added ? '#173522' : '#1e2a3e'}`,
      borderRadius: 5, background: added ? '#0d1a12' : '#111520', color: added ? '#4ade80' : '#60a5fa',
      cursor: added || loading ? 'default' : 'pointer', minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0, padding: '3px 10px', fontSize: 10, fontWeight: 600,
      opacity: loading ? 0.6 : 1,
    }}
  >
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M12 14v4M10 16h4" />
    </svg>
    {loading ? t('reminderAdding') : added ? t('reminderAdded') : t('remind')}
  </button>
  );
};