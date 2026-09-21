import React from 'react';
import { usePreferences } from '../i18n';
import { type BillNotification } from '../store/useDashboard';

interface Props {
  notifications: BillNotification[];
  onClose: () => void;
}

export const DailyBillNotification: React.FC<Props> = ({ notifications, onClose }) => {
  const { formatMoney, locale, t } = usePreferences();
  const formatDueDate = (date: Date) => date.toLocaleDateString(locale === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit' });
  const dueLabel = (notification: BillNotification) => {
    if (notification.isOverdue) return t('overdue');
    if (notification.daysUntilDue === 0) return t('dueToday');
    return `${t('dueIn')} ${notification.daysUntilDue} ${notification.daysUntilDue === 1 ? (locale === 'en' ? 'day' : 'dia') : (locale === 'en' ? 'days' : 'dias')}`;
  };
  return (
  <div className="daily-notification-backdrop" role="presentation">
    <section className="daily-notification" role="dialog" aria-modal="true" aria-labelledby="daily-notification-title">
      <div className="daily-notification-header">
        <div>
          <div className="daily-notification-eyebrow">{t('financialReminder')}</div>
          <h2 id="daily-notification-title">{t('upcomingBills')}</h2>
        </div>
        <button className="daily-notification-close" type="button" onClick={onClose} aria-label="Fechar lembrete">×</button>
      </div>

      <p className="daily-notification-intro">
        {t('reminderIntro')}
      </p>

      <div className="daily-notification-list">
        {notifications.map((notification) => (
          <div className={`daily-notification-item ${notification.isOverdue ? 'is-overdue' : ''}`} key={notification.billId}>
            <div className="daily-notification-item-main">
              <span className="daily-notification-dot" />
              <div>
                <strong>{notification.name}</strong>
                <span>{t('dueDate')} {formatDueDate(notification.dueDate)}</span>
              </div>
            </div>
            <div className="daily-notification-item-meta">
              <strong>{formatMoney(notification.amount)}</strong>
              <span>{dueLabel(notification)}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="daily-notification-ok" type="button" onClick={onClose}>{t('understood')}</button>
    </section>
  </div>
  );
};
