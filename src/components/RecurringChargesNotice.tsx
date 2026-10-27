import React, { useMemo, useState } from 'react';
import type { BudgetMonth } from '../types';
import { usePreferences } from '../i18n';
import { findRecurringCharges, type RecurringCharge } from '../services/recurringCharges';
import { readUserStorage, writeUserStorage } from '../services/userStorage';

const DISMISS_KEY = 'financa_recurring_dismissed_v1';
const MAX_SUGGESTIONS = 3;

interface Props {
  months: BudgetMonth[];
  selectedMonthId: string;
  userId: string | null;
  hideValues?: boolean;
  onReclassify: (charge: RecurringCharge) => void;
}

function readDismissed(userId: string | null): string[] {
  try {
    const saved = JSON.parse(readUserStorage(userId, DISMISS_KEY) || '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : [];
  } catch { return []; }
}

export const RecurringChargesNotice: React.FC<Props> = ({ months, selectedMonthId, userId, hideValues, onReclassify }) => {
  const { formatMoney, categoryLabel, t } = usePreferences();
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed(userId));

  const candidates = useMemo(() => findRecurringCharges(months, selectedMonthId), [months, selectedMonthId]);
  const visible = candidates.filter((charge) => !dismissed.includes(charge.key)).slice(0, MAX_SUGGESTIONS);
  if (visible.length === 0) return null;

  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    writeUserStorage(userId, DISMISS_KEY, JSON.stringify(next));
  };

  return (
    <div className="theme-inset-panel" style={{ background: '#0e0e0e', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('recurringTitle')}</h4>
        <span className="theme-muted-text" style={{ fontSize: 10 }}>{t('recurringHint')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {visible.map((charge) => {
          const last = charge.occurrences[charge.occurrences.length - 1];
          return (
            <div key={charge.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{charge.name}</div>
                <div className="theme-muted-text" style={{ fontSize: 10, marginTop: 1 }}>
                  {hideValues ? '••••' : formatMoney(last.amount)} · {categoryLabel(charge.category)} · {t('recurringMonths', { count: charge.monthCount })}
                </div>
              </div>
              <button
                type="button"
                className="theme-chart-toggle"
                onClick={() => onReclassify(charge)}
                style={{ minHeight: 32, border: '1px solid #1e2a3e', background: '#111520', borderRadius: 5, color: '#60a5fa', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '6px 10px', flexShrink: 0 }}
              >
                {t('recurringMark')}
              </button>
              <button
                type="button"
                className="theme-chart-toggle"
                aria-label={`${t('recurringDismiss')}: ${charge.name}`}
                onClick={() => dismiss(charge.key)}
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
