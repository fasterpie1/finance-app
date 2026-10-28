import React, { useMemo, useState } from 'react';
import type { BudgetMonth } from '../types';
import { usePreferences } from '../i18n';
import { findMissingCharges, findRecurringCharges, type MissingCharge, type RecurringCharge } from '../services/recurringCharges';
import { readDismissed, writeDismissed } from '../services/dismissedSuggestions';

const DISMISS_KEY = 'financa_recurring_dismissed_v1';
const MAX_SUGGESTIONS = 3;

interface Props {
  months: BudgetMonth[];
  selectedMonthId: string;
  userId: string | null;
  hideValues?: boolean;
  onReclassify: (charge: RecurringCharge) => void;
  onRepeat: (charge: MissingCharge) => void;
}

export const RecurringChargesNotice: React.FC<Props> = ({ months, selectedMonthId, userId, hideValues, onReclassify, onRepeat }) => {
  const { formatMoney, categoryLabel, t } = usePreferences();
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed(userId, DISMISS_KEY));

  const subscriptions = useMemo(() => findRecurringCharges(months, selectedMonthId), [months, selectedMonthId]);
  const missing = useMemo(() => findMissingCharges(months, selectedMonthId), [months, selectedMonthId]);
  const visibleSubscriptions = subscriptions.filter((charge) => !dismissed.includes(charge.key)).slice(0, MAX_SUGGESTIONS);
  const visibleMissing = missing.filter((charge) => !dismissed.includes(charge.key)).slice(0, MAX_SUGGESTIONS);
  if (visibleSubscriptions.length === 0 && visibleMissing.length === 0) return null;

  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    writeDismissed(userId, DISMISS_KEY, next);
  };

  const dismissButton = (key: string, name: string) => (
    <button
      type="button"
      className="theme-chart-toggle"
      aria-label={`${t('recurringDismiss')}: ${name}`}
      onClick={() => dismiss(key)}
      style={{ minHeight: 32, width: 32, border: '1px solid #1e1e1e', background: 'transparent', borderRadius: 5, color: '#8b8b8b', cursor: 'pointer', fontSize: 13, lineHeight: 1, flexShrink: 0 }}
    >
      ×
    </button>
  );

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
  const nameStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  const metaStyle: React.CSSProperties = { fontSize: 10, marginTop: 1 };
  const actionStyle: React.CSSProperties = { minHeight: 32, border: '1px solid #1e2a3e', background: '#111520', borderRadius: 5, color: '#60a5fa', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '6px 10px', flexShrink: 0 };

  return (
    <div className="theme-inset-panel" style={{ background: '#0e0e0e', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      {visibleSubscriptions.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('recurringTitle')}</h4>
            <span className="theme-muted-text" style={{ fontSize: 10 }}>{t('recurringHint')}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {visibleSubscriptions.map((charge) => {
              const last = charge.occurrences[charge.occurrences.length - 1];
              return (
                <div key={charge.key} style={rowStyle}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={nameStyle}>{charge.name}</div>
                    <div className="theme-muted-text" style={metaStyle}>
                      {hideValues ? '••••' : formatMoney(last.amount)} · {categoryLabel(charge.category)} · {t('recurringMonths', { count: charge.monthCount })}
                    </div>
                  </div>
                  <button type="button" className="theme-chart-toggle" onClick={() => onReclassify(charge)} style={actionStyle}>
                    {t('recurringMark')}
                  </button>
                  {dismissButton(charge.key, charge.name)}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {visibleMissing.length > 0 && (
        <div style={{ marginTop: visibleSubscriptions.length > 0 ? 12 : 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('recurringMissingTitle')}</h4>
            <span className="theme-muted-text" style={{ fontSize: 10 }}>{t('recurringMissingHint')}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {visibleMissing.map((charge) => (
              <div key={charge.key} style={rowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={nameStyle}>{charge.name}</div>
                  <div className="theme-muted-text" style={metaStyle}>
                    {hideValues ? '••••' : formatMoney(charge.lastAmount)} · {categoryLabel(charge.category)} · {t('recurringMonths', { count: charge.monthCount })}
                  </div>
                </div>
                <button type="button" className="theme-chart-toggle" onClick={() => onRepeat(charge)} style={actionStyle}>
                  {t('recurringRepeat')}
                </button>
                {dismissButton(charge.key, charge.name)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
