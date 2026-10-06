import React from 'react';
import { type BudgetMonth, getMonthIndex } from '../types';
import { usePreferences } from '../i18n';
import { centsToAmount, getMonthPlannedCents } from '../services/cardTransactions';

interface Props {
  month: BudgetMonth;
  /** Busca do mês anterior pelo calendário, não pela posição na lista, que pode vir desordenada do sync. */
  months: BudgetMonth[];
  hideValues?: boolean;
}

export const SpendingPace: React.FC<Props> = ({ month, months, hideValues }) => {
  const { formatMoney, formatMonthShort, t } = usePreferences();
  const monthIndex = getMonthIndex(month.name);
  if (monthIndex < 0) return null;

  const previousMonth = monthIndex === 0
    ? months.find((m) => getMonthIndex(m.name) === 11 && m.year === month.year - 1)
    : months.find((m) => getMonthIndex(m.name) === monthIndex - 1 && m.year === month.year);

  const today = new Date();
  const totalDays = new Date(month.year, monthIndex + 1, 0).getDate();
  const start = new Date(month.year, monthIndex, 1).getTime();
  const cursor = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const isCurrent = start === cursor;
  const isPast = start < cursor;
  const elapsedDays = isCurrent ? today.getDate() : isPast ? totalDays : 0;
  const leftDays = isCurrent ? totalDays - today.getDate() + 1 : isPast ? 0 : totalDays;

  const planned = centsToAmount(getMonthPlannedCents(month.bills, month.creditCardInvoices ?? []));
  const remaining = month.income - planned;
  if (planned === 0 && month.income === 0) return null;

  const previousPlanned = previousMonth
    ? centsToAmount(getMonthPlannedCents(previousMonth.bills, previousMonth.creditCardInvoices ?? []))
    : 0;
  const deltaPct = previousPlanned > 0 ? ((planned - previousPlanned) / previousPlanned) * 100 : null;

  const mask = '••••';
  const money = (value: number) => (hideValues ? mask : formatMoney(value));
  const isShort = remaining < 0;
  // A média por dia só faz sentido enquanto o mês ainda tem dias; em mês fechado o número é a sobra final.
  const headlineValue = isPast ? remaining : leftDays > 0 ? Math.abs(remaining) / leftDays : remaining;
  const subtitle = isPast
    ? t('paceClosedMonth', { amount: money(remaining) })
    : isShort
      ? t('paceShortfall', { amount: money(Math.abs(remaining)) })
      : t('paceLeftForDays', { amount: money(remaining), days: leftDays });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('paceTitle')}</h3>
        <span className="theme-pace-muted" style={{ fontSize: 11, color: '#8b8b8b' }}>
          {isCurrent ? t('paceDayOf', { day: today.getDate(), total: totalDays }) : formatMonthShort(month.name, month.year)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span
          className={`privacy-mask theme-pace-headline ${isShort ? 'is-negative' : 'is-positive'}`}
          style={{ fontSize: 22, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : isShort ? '#ef4444' : '#10b981', transition: 'color 0.2s' }}
        >
          {isPast ? money(headlineValue) : money(Math.abs(headlineValue))}
        </span>
        {!isPast && leftDays > 0 && (
          <span className="theme-pace-muted" style={{ fontSize: 12, color: '#8b8b8b' }}>{t('pacePerDay')}</span>
        )}
      </div>

      <div className="theme-pace-muted" style={{ fontSize: 12, color: '#8b8b8b' }}>{subtitle}</div>

      <div
        className="theme-pace-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalDays}
        aria-valuenow={elapsedDays}
        aria-label={t('paceDayOf', { day: elapsedDays, total: totalDays })}
        style={{ height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}
      >
        <div style={{ width: `${Math.min(100, (elapsedDays / totalDays) * 100)}%`, height: '100%', borderRadius: 2, background: isShort ? '#ef4444' : '#60a5fa', transition: 'width 0.2s' }} />
      </div>

      <div className="theme-pace-muted" style={{ fontSize: 11, color: '#8b8b8b' }}>
        {t('pacePlannedThisMonth')} {money(planned)}
        {deltaPct !== null && previousMonth && (
          <span> · {t('paceVsPrevious', {
            month: formatMonthShort(previousMonth.name, previousMonth.year),
            delta: `${deltaPct >= 0 ? '+' : '−'}${Math.abs(deltaPct).toFixed(0)}%`,
          })}</span>
        )}
      </div>
    </div>
  );
};
