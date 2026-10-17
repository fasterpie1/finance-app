import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Bill,
  type CategoryId,
  type CreditCardInvoice,
} from '../types';
import { usePreferences } from '../i18n';
import { safeSetItem } from '../services/safeStorage';
import { centsToAmount } from '../services/cardTransactions';
import { getCardCategoryAmountCents, getCardChartCategories, getCardChartMonths } from '../services/financeCharts';

interface MonthData {
  id: string;
  name: string;
  year: number;
  bills: Bill[];
  creditCardInvoices?: CreditCardInvoice[];
}

interface Props {
  months: MonthData[];
  selectedMonthName: string;
  selectedMonthYear: number;
  hideValues?: boolean;
}

const STORAGE_KEY = 'financa_card_chart_categories_v1';
const DEFAULT_CHART_WIDTH = 760;
const CHART_HEIGHT = 300;
const PADDING = { top: 62, right: 54, bottom: 62, left: 92 };
const NARROW_PADDING = { top: 52, right: 16, bottom: 52, left: 48 };

function loadCategories(available: CategoryId[]): CategoryId[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown;
    if (Array.isArray(saved)) {
      const valid = saved.filter((category): category is CategoryId => available.includes(category as CategoryId));
      if (valid.length > 0) return valid.slice(0, 3);
    }
  } catch { /* ignore */ }
  return available.slice(0, 3);
}

export const CardSpendingChart: React.FC<Props> = ({ months, selectedMonthName, selectedMonthYear, hideValues }) => {
  const { formatMoney, formatMonthShort, categoryLabel, categoryColor, locale, t } = usePreferences();
  const availableCategories = useMemo(() => {
    return getCardChartCategories(months).sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), locale === 'en' ? 'en-US' : 'pt-BR'));
  }, [months, categoryLabel, locale]);
  const [selectedCategories, setSelectedCategories] = useState<CategoryId[]>(() => loadCategories(availableCategories));

  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setMeasuredWidth((current) => (Math.abs(current - width) < 0.5 ? current : width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const toggleCategory = (category: CategoryId) => {
    setSelectedCategories((current) => {
      const next = current.includes(category)
        ? current.filter((item) => item !== category)
        : current.length < 3 ? [...current, category] : current;
      safeSetItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const chartMonths = getCardChartMonths(months, selectedMonthName, selectedMonthYear);
  const values = selectedCategories.flatMap((category) => chartMonths.map((month) =>
    centsToAmount(getCardCategoryAmountCents(month, category))
  ));
  const maxValue = Math.max(...values, 0);
  const chartWidth = measuredWidth > 0 ? Math.round(measuredWidth) : DEFAULT_CHART_WIDTH;
  const narrow = chartWidth < 480;
  const padding = narrow ? NARROW_PADDING : PADDING;
  const axisFontSize = narrow ? 10 : 14;
  const monthFontSize = narrow ? 11 : 15;
  const valueFontSize = narrow ? 10 : 14;
  const valueStagger = narrow ? 15 : 20;
  const stripCurrency = (text: string) => text.replace(/^(R\$|US\$|€)\s?/, '').trim();
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = CHART_HEIGHT - padding.top - padding.bottom;
  const xFor = (index: number) => chartMonths.length <= 1 ? padding.left + plotWidth / 2 : padding.left + (index / (chartMonths.length - 1)) * plotWidth;
  const yFor = (value: number) => padding.top + plotHeight - (maxValue > 0 ? (value / maxValue) * plotHeight : 0);
  const series = selectedCategories.map((category) => ({
    category,
    points: chartMonths.map((month, index) => {
      const value = centsToAmount(getCardCategoryAmountCents(month, category));
      return { x: xFor(index), y: yFor(value), value };
    }),
  }));
  const gridValues = [0, 0.5, 1].map((ratio) => maxValue * ratio);

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('cardSpendingByCategory')}</h3>
          <div style={{ marginTop: 5, fontSize: 12, color: '#8b8b8b' }}>{t('lastFourMonthsHint')}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {availableCategories.map((category) => {
            const selected = selectedCategories.includes(category);
            const limitReached = selectedCategories.length === 3 && !selected;
            return (
              <button className={`theme-chart-toggle ${selected ? 'is-selected' : ''}`} key={category} type="button" onClick={() => toggleCategory(category)} disabled={limitReached} style={{ display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${selected ? categoryColor(category) : '#242424'}`, background: selected ? `${categoryColor(category)}18` : '#151515', borderRadius: 5, color: selected ? '#e0e0e0' : '#9a9a9a', cursor: limitReached ? 'not-allowed' : 'pointer', opacity: limitReached ? 0.45 : 1, padding: '7px 9px', fontSize: 11, transition: 'all 0.15s' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: categoryColor(category), flexShrink: 0 }} />
                {categoryLabel(category)}
              </button>
            );
          })}
        </div>
      </div>

      {selectedCategories.length === 0 ? (
        <div className="chart-empty" style={{ border: '1px dashed #242424', borderRadius: 8, padding: 28, textAlign: 'center', color: '#8b8b8b', fontSize: 12 }}>{t('selectCategoryToCompare')}</div>
      ) : chartMonths.length === 0 ? (
        <div className="chart-empty" style={{ border: '1px dashed #242424', borderRadius: 8, padding: 28, textAlign: 'center', color: '#8b8b8b', fontSize: 12 }}>{t('noCardPurchasesYet')}</div>
      ) : (
        <div>
          <svg viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`} width="100%" role="img" aria-label="Evolução mensal dos gastos no cartão por categoria" style={{ display: 'block' }}>
            {gridValues.map((value) => {
              const y = yFor(value);
              return (
                <g key={value}>
                  <line className="chart-grid" x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} stroke="#202020" strokeDasharray="3 5" />
                  <text className="chart-axis-label" x={padding.left - 8} y={y + 4} textAnchor="end" fill="#8f8f8f" fontSize={axisFontSize}>{hideValues ? '•••' : stripCurrency(formatMoney(value))}</text>
                </g>
              );
            })}
            <line className="chart-axis" x1={padding.left} x2={chartWidth - padding.right} y1={padding.top + plotHeight} y2={padding.top + plotHeight} stroke="#292929" />
            {chartMonths.map((month, index) => (
              <g key={month.id}>
                <text className="chart-month-label" x={xFor(index)} y={CHART_HEIGHT - (narrow ? 22 : 29)} textAnchor={index === 0 ? 'start' : index === chartMonths.length - 1 ? 'end' : 'middle'} fill="#777" fontSize={monthFontSize} fontWeight="600">{formatMonthShort(month.name, month.year)}</text>
              </g>
            ))}
            {series.map(({ category, points }, seriesIndex) => (
              <g key={category}>
                <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={categoryColor(category)} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {points.map((point, index) => (
                  <g key={`${category}-${index}`}>
                    <text x={point.x} y={Math.max(narrow ? 12 : 18, point.y - (narrow ? 12 : 16) - seriesIndex * valueStagger)} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fill={categoryColor(category)} fontSize={valueFontSize} fontWeight="700">
                      {hideValues ? '•••' : narrow ? stripCurrency(formatMoney(point.value)) : formatMoney(point.value)}
                    </text>
                    <circle className="chart-point" cx={point.x} cy={point.y} r="4.5" fill="#111" stroke={categoryColor(category)} strokeWidth="2" />
                  </g>
                ))}
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
};
