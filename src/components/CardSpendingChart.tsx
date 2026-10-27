import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Bill,
  type CategoryId,
  type CreditCardInvoice,
} from '../types';
import { usePreferences } from '../i18n';
import { safeSetItem } from '../services/safeStorage';
import { centsToAmount } from '../services/cardTransactions';
import { type LineChartSource, getCardCategoryAmountCents, getCardChartCategories, getCardChartMonths } from '../services/financeCharts';

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
const WINDOW_STORAGE_KEY = 'financa_card_chart_window_v1';
const CHART_WINDOWS = [4, 6, 12] as const;
type ChartWindow = (typeof CHART_WINDOWS)[number];
/** A partir desta janela o gráfico fica apertado demais para um rótulo de valor por mês. */
const DENSE_WINDOW = 6;

function loadWindow(): ChartWindow {
  try {
    const saved = Number(localStorage.getItem(WINDOW_STORAGE_KEY));
    if (CHART_WINDOWS.includes(saved as ChartWindow)) return saved as ChartWindow;
  } catch { /* ignore */ }
  return 4;
}

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

/** Duas categorias com valores parecidos no mesmo mês colocavam um rótulo sobre o outro.
 *  Cada rótulo sobe o mínimo necessário para manter o espaçamento, sem nunca passar do topo. */
function layoutValueLabels(desiredYs: number[], top: number, gap: number): number[] {
  const ordered = desiredYs
    .map((y, seriesIndex) => ({ seriesIndex, y: Math.max(top, y) }))
    .sort((a, b) => a.y - b.y);
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    ordered[index].y = Math.max(top, Math.min(ordered[index].y, ordered[index + 1].y - gap));
  }
  const positions = new Array<number>(desiredYs.length);
  ordered.forEach((row) => { positions[row.seriesIndex] = row.y; });
  return positions;
}

export const CardSpendingChart: React.FC<Props> = ({ months, selectedMonthName, selectedMonthYear, hideValues }) => {
  const { formatMoney, formatMonthShort, categoryLabel, categoryColor, locale, t } = usePreferences();
  const [source, setSource] = useState<LineChartSource>('card');
  const [windowSize, setWindowSize] = useState<ChartWindow>(loadWindow);
  const categoriesFor = useCallback((next: LineChartSource) => {
    return getCardChartCategories(months, next).sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b), locale === 'en' ? 'en-US' : 'pt-BR'));
  }, [months, categoryLabel, locale]);
  const availableCategories = useMemo(() => categoriesFor(source), [categoriesFor, source]);
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

  const switchSource = (next: LineChartSource) => {
    if (next === source) return;
    setSource(next);
    setSelectedCategories(loadCategories(categoriesFor(next)));
  };

  const switchWindow = (next: ChartWindow) => {
    if (next === windowSize) return;
    setWindowSize(next);
    safeSetItem(WINDOW_STORAGE_KEY, String(next));
  };

  const chartMonths = getCardChartMonths(months, selectedMonthName, selectedMonthYear, windowSize);
  const showEveryValue = chartMonths.length <= DENSE_WINDOW;
  /** Com muitos meses os rótulos do eixo se atropelam: mostra um sim, um não, sempre com o último. */
  const monthLabelStep = chartMonths.length > 8 ? 2 : 1;
  const values = selectedCategories.flatMap((category) => chartMonths.map((month) =>
    centsToAmount(getCardCategoryAmountCents(month, category, source))
  ));
  const maxValue = Math.max(...values, 0);
  const chartWidth = measuredWidth > 0 ? Math.round(measuredWidth) : DEFAULT_CHART_WIDTH;
  const narrow = chartWidth < 480;
  const padding = narrow ? NARROW_PADDING : PADDING;
  const axisFontSize = narrow ? 10 : 14;
  const monthFontSize = narrow ? 11 : 15;
  const valueFontSize = narrow ? 10 : 14;
  const stripCurrency = (text: string) => text.replace(/^(R\$|US\$|€)\s?/, '').trim();
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = CHART_HEIGHT - padding.top - padding.bottom;
  const xFor = (index: number) => chartMonths.length <= 1 ? padding.left + plotWidth / 2 : padding.left + (index / (chartMonths.length - 1)) * plotWidth;
  const yFor = (value: number) => padding.top + plotHeight - (maxValue > 0 ? (value / maxValue) * plotHeight : 0);
  const series = selectedCategories.map((category) => ({
    category,
    points: chartMonths.map((month, index) => {
      const value = centsToAmount(getCardCategoryAmountCents(month, category, source));
      return { x: xFor(index), y: yFor(value), value };
    }),
  }));
  const gridValues = [0, 0.5, 1].map((ratio) => maxValue * ratio);
  const labelTop = narrow ? 12 : 18;
  const labelYs = chartMonths.map((_, monthIndex) => layoutValueLabels(
    series.map((item) => item.points[monthIndex].y - (narrow ? 12 : 16)),
    labelTop,
    valueFontSize + 2,
  ));
  const title = source === 'card' ? t('cardSpendingByCategory') : t('accountSpendingByCategory');
  const sourceOptions: { id: LineChartSource; label: string }[] = [
    { id: 'card', label: t('creditCard') },
    { id: 'account', label: t('debitPix') },
  ];

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</h3>
          <div className="theme-muted-text" style={{ marginTop: 5, fontSize: 12, color: '#8b8b8b' }}>{t('lastMonthsHint', { count: windowSize })}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div className="chart-controls" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div className="chart-source-toggle" role="group" aria-label={t('chartSourceToggleLabel')} style={{ display: 'flex', gap: 6 }}>
              {sourceOptions.map((option) => {
                const selected = source === option.id;
                return (
                  <button key={option.id} className={`theme-chart-toggle ${selected ? 'is-selected' : ''}`} type="button" aria-pressed={selected} onClick={() => switchSource(option.id)} style={{ minHeight: 32, border: `1px solid ${selected ? '#60a5fa' : '#242424'}`, background: selected ? '#111520' : '#151515', borderRadius: 5, color: selected ? '#60a5fa' : '#8b8b8b', cursor: 'pointer', fontSize: 11, fontWeight: selected ? 700 : 500, padding: '6px 10px', transition: 'all 0.15s' }}>
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="chart-window-toggle" role="group" aria-label={t('chartWindowLabel')} style={{ display: 'flex', gap: 4 }}>
              {CHART_WINDOWS.map((size) => {
                const selected = windowSize === size;
                return (
                  <button key={size} className={`theme-chart-toggle ${selected ? 'is-selected' : ''}`} type="button" aria-pressed={selected} onClick={() => switchWindow(size)} style={{ minHeight: 32, minWidth: 38, border: `1px solid ${selected ? '#60a5fa' : '#242424'}`, background: selected ? '#111520' : '#151515', borderRadius: 5, color: selected ? '#60a5fa' : '#8b8b8b', cursor: 'pointer', fontSize: 11, fontWeight: selected ? 700 : 500, padding: '6px 8px', transition: 'all 0.15s' }}>
                    {t('chartWindowMonths', { count: size })}
                  </button>
                );
              })}
            </div>
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
      </div>

      {selectedCategories.length === 0 ? (
        <div className="chart-empty" style={{ border: '1px dashed #242424', borderRadius: 8, padding: 28, textAlign: 'center', color: '#8b8b8b', fontSize: 12 }}>{availableCategories.length === 0 ? t('noExpenses') : t('selectCategoryToCompare')}</div>
      ) : chartMonths.length === 0 ? (
        <div className="chart-empty" style={{ border: '1px dashed #242424', borderRadius: 8, padding: 28, textAlign: 'center', color: '#8b8b8b', fontSize: 12 }}>{source === 'card' ? t('noCardPurchasesYet') : t('noExpenses')}</div>
      ) : (
        <div>
          <svg viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`} width="100%" role="img" aria-label={title} style={{ display: 'block' }}>
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
              index % monthLabelStep === 0 || index === chartMonths.length - 1 ? (
                <g key={month.id}>
                  <text className="chart-month-label" x={xFor(index)} y={CHART_HEIGHT - (narrow ? 22 : 29)} textAnchor={index === 0 ? 'start' : index === chartMonths.length - 1 ? 'end' : 'middle'} fill="#777" fontSize={monthFontSize} fontWeight="600">{formatMonthShort(month.name, month.year)}</text>
                </g>
              ) : null
            ))}
            {series.map(({ category, points }, seriesIndex) => (
              <g key={category}>
                <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={categoryColor(category)} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {points.map((point, index) => (
                  <g key={`${category}-${index}`}>
                    {(showEveryValue || index === points.length - 1) && (
                      <text className="chart-value-label" x={point.x} y={labelYs[index][seriesIndex]} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fill={categoryColor(category)} fontSize={valueFontSize} fontWeight="700">
                        {hideValues ? '•••' : narrow ? stripCurrency(formatMoney(point.value)) : formatMoney(point.value)}
                      </text>
                    )}
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
