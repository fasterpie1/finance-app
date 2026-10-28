import React, { useState } from 'react';
import {
  type Bill,
  type BudgetMonth,
  type CategoryId,
} from '../types';
import { usePreferences } from '../i18n';
import { centsToAmount } from '../services/cardTransactions';
import { type ChartSource, getCategoryAnomalies, getCategoryChartData } from '../services/financeCharts';

interface Props {
  bills: Bill[];
  invoices?: BudgetMonth['creditCardInvoices'];
  /** Meses anteriores ao aberto: a base da marcação de anomalia. */
  previousMonths?: Array<Pick<BudgetMonth, 'bills' | 'creditCardInvoices'>>;
  hideValues?: boolean;
}

interface CategoryData {
  category: CategoryId;
  label: string;
  color: string;
  amount: number;
  pct: number;
}

const SOURCE_ORDER: ChartSource[] = ['all', 'card', 'account'];

export const CategoryChart: React.FC<Props> = ({ bills, invoices = [], previousMonths = [], hideValues }) => {
  const { formatMoney, categoryLabel, categoryColor, locale, t } = usePreferences();
  const [source, setSource] = useState<ChartSource>('all');
  const chartData = getCategoryChartData(bills, invoices, source);
  const anomalies = getCategoryAnomalies(chartData, previousMonths, source);
  const ratioFormatter = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'pt-BR', { maximumFractionDigits: 1 });
  const { totalCents } = chartData;
  const sourceToggle = (
    <div className="chart-source-toggle" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
      {SOURCE_ORDER.map((option) => (
        <button key={option} className={`theme-chart-toggle ${source === option ? 'is-selected' : ''}`} type="button" onClick={() => setSource(option)} aria-pressed={source === option} style={{ background: source === option ? '#111520' : '#151515', border: `1px solid ${source === option ? '#1e2a3e' : '#1e1e1e'}`, borderRadius: 6, color: source === option ? '#60a5fa' : '#8b8b8b', cursor: 'pointer', padding: '6px 12px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', minHeight: 32 }}>
          {option === 'all' ? t('chartSourceAll') : option === 'card' ? t('chartSourceCardShort') : t('debitPix')}
        </button>
      ))}
    </div>
  );
  if (totalCents === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sourceToggle}
      <div className="theme-muted-text" style={{ textAlign: 'center', color: '#8b8b8b', fontSize: 12, padding: 20 }}>{t('noExpenses')}</div>
    </div>
  );
  const total = centsToAmount(totalCents);

  const data: CategoryData[] = chartData.items.map(({ category, cents, percentage }) => ({
    category, label: categoryLabel(category), color: categoryColor(category), amount: centsToAmount(cents), pct: percentage,
  }));

  const size = 130;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = data.reduce<{
    items: Array<CategoryData & { dashArray: number; offset: number }>;
    offset: number;
  }>((accumulator, item) => {
    const dashArray = (item.pct / 100) * circumference;
    return {
      items: [
        ...accumulator.items,
        { ...item, dashArray, offset: accumulator.offset },
      ],
      offset: accumulator.offset + dashArray,
    };
  }, { items: [], offset: 0 }).items;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sourceToggle}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle className="donut-track" cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1a1a1a" strokeWidth={strokeWidth} />
            {segments.map((s, i) => (
              <circle key={i} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={s.color} strokeWidth={strokeWidth} strokeDasharray={`${s.dashArray} ${circumference - s.dashArray}`} strokeDashoffset={-s.offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'all 0.4s ease' }} />
            ))}
          </svg>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <div className="theme-muted-text" style={{ fontSize: 9, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('total')}</div>
            <div className="privacy-mask" style={{ fontSize: 13, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#d4d4d4', marginTop: 1, transition: 'color 0.2s' }}>{hideValues ? '••••' : formatMoney(total)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {data.map((d) => (
          <div className="theme-category-row" key={d.category} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 6 }}>
            <div style={{ width: 3, height: 24, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div className="category-label" style={{ fontSize: 13, color: '#c4c4c4', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</div>
              <div className="theme-muted-text" style={{ fontSize: 11, color: '#8f8f8f', marginTop: 2 }}>
                {t('pctOfTotal', { pct: d.pct.toFixed(1) })}
                {anomalies.has(d.category) && (
                  <span className="theme-delta-up" style={{ color: '#f87171' }}> · {t('categoryAnomaly', { ratio: ratioFormatter.format(anomalies.get(d.category)!.ratio) })}</span>
                )}
              </div>
            </div>
            <div className="privacy-mask" style={{ fontSize: 14, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#e3e3e3', flexShrink: 0, transition: 'color 0.2s', fontVariantNumeric: 'tabular-nums' }}>
              {hideValues ? '••••' : formatMoney(d.amount)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
