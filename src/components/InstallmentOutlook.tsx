import React, { useMemo } from 'react';
import type { BudgetMonth } from '../types';
import { usePreferences } from '../i18n';
import { projectInstallments } from '../services/installmentProjection';
import { centsToAmount } from '../services/cardTransactions';

interface Props {
  months: BudgetMonth[];
  selectedMonthId: string;
  hideValues?: boolean;
}

const HORIZON = 3;

export const InstallmentOutlook: React.FC<Props> = ({ months, selectedMonthId, hideValues }) => {
  const { formatMoney, formatMonthShort, t } = usePreferences();
  const projection = useMemo(() => projectInstallments(months, selectedMonthId, HORIZON), [months, selectedMonthId]);

  if (projection.groups.length === 0) return null;
  const money = (cents: number) => (hideValues ? '••••' : formatMoney(centsToAmount(cents)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('installmentOutlookTitle')}</h3>
        <span className="theme-pace-muted" style={{ fontSize: 11, color: '#8b8b8b' }}>{t('installmentOutlookHint')}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {projection.months.map((entry) => (
          <div key={entry.offset} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
            <span className="theme-pace-muted" style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#8b8b8b' }}>{formatMonthShort(entry.monthName, entry.year)}</span>
            {entry.endingCount > 0 && (
              <span className="theme-pace-muted" style={{ fontSize: 10, color: '#8b8b8b' }}>{t('installmentOutlookEnding', { count: entry.endingCount })}</span>
            )}
            <span className="privacy-mask" style={{ fontSize: 13, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#d4d4d4', fontVariantNumeric: 'tabular-nums' }}>
              {money(entry.cents)}
            </span>
          </div>
        ))}
      </div>

      <div className="theme-pace-muted" style={{ fontSize: 11, color: '#8b8b8b' }}>
        {t('installmentOutlookRemaining')} {money(projection.remainingCents)} · {t('installmentOutlookNow')} {money(projection.currentCents)}
      </div>
    </div>
  );
};
