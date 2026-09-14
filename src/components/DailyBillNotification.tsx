import React from 'react';
import { formatCurrency } from '../types';
import { type BillNotification } from '../store/useDashboard';

interface Props {
  notifications: BillNotification[];
  onClose: () => void;
}

function formatDueDate(date: Date): string {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function dueLabel(notification: BillNotification): string {
  if (notification.isOverdue) return 'Conta atrasada';
  if (notification.daysUntilDue === 0) return 'Vence hoje';
  return `Vence em ${notification.daysUntilDue} dia${notification.daysUntilDue === 1 ? '' : 's'}`;
}

export const DailyBillNotification: React.FC<Props> = ({ notifications, onClose }) => (
  <div className="daily-notification-backdrop" role="presentation">
    <section className="daily-notification" role="dialog" aria-modal="true" aria-labelledby="daily-notification-title">
      <div className="daily-notification-header">
        <div>
          <div className="daily-notification-eyebrow">Lembrete financeiro</div>
          <h2 id="daily-notification-title">Contas próximas do vencimento</h2>
        </div>
        <button className="daily-notification-close" type="button" onClick={onClose} aria-label="Fechar lembrete">×</button>
      </div>

      <p className="daily-notification-intro">
        Confira as contas que precisam de atenção. Este lembrete aparece uma vez por dia.
      </p>

      <div className="daily-notification-list">
        {notifications.map((notification) => (
          <div className={`daily-notification-item ${notification.isOverdue ? 'is-overdue' : ''}`} key={notification.billId}>
            <div className="daily-notification-item-main">
              <span className="daily-notification-dot" />
              <div>
                <strong>{notification.name}</strong>
                <span>Vencimento em {formatDueDate(notification.dueDate)}</span>
              </div>
            </div>
            <div className="daily-notification-item-meta">
              <strong>{formatCurrency(notification.amount)}</strong>
              <span>{dueLabel(notification)}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="daily-notification-ok" type="button" onClick={onClose}>OK, entendi</button>
    </section>
  </div>
);
