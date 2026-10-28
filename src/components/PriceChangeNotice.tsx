import React, { useMemo, useState } from 'react';
import type { BudgetMonth } from '../types';
import { usePreferences } from '../i18n';
import { findPriceChanges } from '../services/recurringCharges';
import { readDismissed, writeDismissed } from '../services/dismissedSuggestions';

const DISMISS_KEY = 'financa_price_change_dismissed_v1';
const MAX_NOTICES = 3;

interface Props {
  months: BudgetMonth[];
  selectedMonthId: string;
  userId: string | null;
  hideValues?: boolean;
}

export const PriceChangeNotice: React.FC<Props> = ({ months, selectedMonthId, userId, hideValues }) => {
  const { formatMoney, t } = usePreferences();
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed(userId, DISMISS_KEY));

  const candidates = useMemo(() => findPriceChanges(months, selectedMonthId), [months, selectedMonthId]);
  const visible = candidates.filter((change) => !dismissed.includes(change.key)).slice(0, MAX_NOTICES);
  if (visible.length === 0) return null;

  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    writeDismissed(userId, DISMISS_KEY, next);
  };

  return (
    <div className="theme-inset-panel" style={{ background: '#0e0e0e', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('priceChangeTitle')}</h4>
        <span className="theme-muted-text" style={{ fontSize: 10 }}>{t('priceChangeHint')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {visible.map((change) => {
          const delta = `${change.deltaPct > 0 ? '+' : ''}${Math.round(change.deltaPct * 100)}%`;
          return (
            <div key={change.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{change.name}</div>
                <div className="theme-muted-text" style={{ fontSize: 10, marginTop: 1 }}>
                  {hideValues
                    ? '••••'
                    : t('priceChangeLine', { previous: formatMoney(change.previousAmount), current: formatMoney(change.currentAmount) })}
                  {' · '}
                  <span className={change.deltaPct > 0 ? 'theme-delta-up' : 'theme-delta-down'} style={{ color: change.deltaPct > 0 ? '#f87171' : '#34d399' }}>{delta}</span>
                </div>
              </div>
              <button
                type="button"
                className="theme-chart-toggle"
                aria-label={`${t('recurringDismiss')}: ${change.name}`}
                onClick={() => dismiss(change.key)}
                style={{ minHeight: 32, width: 32, border: '1px solid #1e1e1e', background: 'transparent', borderRadius: 5, color: '#8b8b8b', cursor: 'pointer', fontSize: 13, lineHeight: 1, flexShrink: 0 }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
