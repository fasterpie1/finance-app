import React, { useMemo, useState } from 'react';
import type { CategoryId, CreditCardTransaction } from '../types';
import { usePreferences } from '../i18n';
import { centsToAmount, getPersonalImpactCents } from '../services/cardTransactions';
import { planCategorySuggestions } from '../services/merchantCategories';
import { readDismissed, writeDismissed } from '../services/dismissedSuggestions';

const DISMISS_KEY = 'financa_merchant_category_dismissed_v1';
const MAX_ROWS = 3;

interface Props {
  transactions: CreditCardTransaction[];
  /** Meses anteriores, para o histórico dele valer mais que a regra fixa. */
  history: CreditCardTransaction[];
  userId: string | null;
  onApply: (transactionIds: string[], category: CategoryId) => void;
  hideValues?: boolean;
}

interface Row {
  category: CategoryId;
  transactionIds: string[];
  merchants: string[];
  cents: number;
}

/** Junta os lançamentos por categoria sugerida: um toque classifica tudo o que a regra reconhece. */
function groupPlan(
  transactions: CreditCardTransaction[],
  history: CreditCardTransaction[],
): Row[] {
  const plan = planCategorySuggestions(transactions, history);
  const byCategory = new Map<CategoryId, Row>();
  plan.forEach(({ transactionId, merchant, category }) => {
    const row = byCategory.get(category) ?? { category, transactionIds: [], merchants: [], cents: 0 };
    const transaction = transactions.find((item) => item.id === transactionId);
    row.transactionIds.push(transactionId);
    if (transaction) row.cents += getPersonalImpactCents(transaction);
    if (!row.merchants.includes(merchant)) row.merchants.push(merchant);
    byCategory.set(category, row);
  });
  return [...byCategory.values()].sort((a, b) => b.cents - a.cents || b.transactionIds.length - a.transactionIds.length);
}

export const MerchantCategoryNotice: React.FC<Props> = ({ transactions, history, userId, onApply, hideValues }) => {
  const { formatMoney, categoryLabel, categoryColor, t } = usePreferences();
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed(userId, DISMISS_KEY));

  const rows = useMemo(() => groupPlan(transactions, history), [transactions, history]);
  const visible = rows.filter((row) => !dismissed.includes(row.category)).slice(0, MAX_ROWS);
  if (visible.length === 0) return null;

  const dismiss = (category: CategoryId) => {
    const next = [...dismissed, category];
    setDismissed(next);
    writeDismissed(userId, DISMISS_KEY, next);
  };

  return (
    <div className="theme-inset-panel" style={{ background: '#0e0e0e', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('merchantCategoryTitle')}</h4>
        <span className="theme-muted-text" style={{ fontSize: 10 }}>{t('merchantCategoryHint')}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        {visible.map((row) => (
          <div key={row.category} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 3, height: 26, borderRadius: 2, background: categoryColor(row.category), flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{categoryLabel(row.category)}</div>
              <div className="theme-muted-text" style={{ fontSize: 10, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t('merchantCategoryLine', {
                  count: row.transactionIds.length,
                  noun: row.transactionIds.length === 1 ? t('entrySingular') : t('entryPlural'),
                  amount: hideValues ? '••••' : formatMoney(centsToAmount(row.cents)),
                })}
                {' · '}
                {row.merchants.slice(0, 2).map((merchant) => merchant.toLowerCase()).join(', ')}
                {row.merchants.length > 2 ? ` +${row.merchants.length - 2}` : ''}
              </div>
            </div>
            <button
              type="button"
              className="theme-chart-toggle"
              onClick={() => onApply(row.transactionIds, row.category)}
              style={{ minHeight: 32, padding: '6px 10px', border: '1px solid #1e2a3e', background: '#111520', borderRadius: 6, color: '#60a5fa', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {t('merchantCategoryApply')}
            </button>
            <button
              type="button"
              className="theme-chart-toggle"
              aria-label={`${t('recurringDismiss')}: ${categoryLabel(row.category)}`}
              onClick={() => dismiss(row.category)}
              style={{ minHeight: 32, width: 32, border: '1px solid #1e1e1e', background: 'transparent', borderRadius: 5, color: '#8b8b8b', cursor: 'pointer', fontSize: 13, lineHeight: 1, flexShrink: 0 }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
