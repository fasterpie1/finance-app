import React, { useMemo, useState } from 'react';
import {
  type Bill,
  type BillCategory,
  BILL_CATEGORY_COLORS,
  BILL_CATEGORY_LABELS,
  formatCurrency,
  formatMonthShort,
} from '../types';

interface MonthData {
  id: string;
  name: string;
  year: number;
  bills: Bill[];
}

interface Props {
  months: MonthData[];
  selectedMonthName: string;
  selectedMonthYear: number;
  hideValues?: boolean;
}

const STORAGE_KEY = 'financa_card_chart_categories_v1';
const CHART_WIDTH = 680;
const CHART_HEIGHT = 250;
const PADDING = { top: 18, right: 18, bottom: 42, left: 58 };

function loadCategories(available: BillCategory[]): BillCategory[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown;
    if (Array.isArray(saved)) {
      const valid = saved.filter((category): category is BillCategory => available.includes(category as BillCategory));
      if (valid.length > 0) return valid.slice(0, 3);
    }
  } catch { /* ignore */ }
  return available.slice(0, 3);
}

export const CardSpendingChart: React.FC<Props> = ({ months, selectedMonthName, selectedMonthYear, hideValues }) => {
  const cardBills = (month: MonthData) => month.bills.filter((bill) =>
    (bill.type === 'parcela' && bill.category !== 'financiamento') || bill.isOnCreditCard === true
  );

  const availableCategories = useMemo(() => {
    const categories = new Set<BillCategory>();
    months.forEach((month) => cardBills(month).forEach((bill) => categories.add(bill.category)));
    return Array.from(categories).sort((a, b) => BILL_CATEGORY_LABELS[a].localeCompare(BILL_CATEGORY_LABELS[b], 'pt-BR'));
  }, [months]);
  const [selectedCategories, setSelectedCategories] = useState<BillCategory[]>(() => loadCategories(availableCategories));

  const toggleCategory = (category: BillCategory) => {
    setSelectedCategories((current) => {
      const next = current.includes(category)
        ? current.filter((item) => item !== category)
        : current.length < 3 ? [...current, category] : current;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const selectedIndex = months.findIndex((month) => month.name.toLowerCase() === selectedMonthName.toLowerCase() && month.year === selectedMonthYear);
  const monthsUntilSelected = months.slice(0, selectedIndex >= 0 ? selectedIndex + 1 : months.length);
  const chartMonths = monthsUntilSelected.slice(-5);
  const values = selectedCategories.flatMap((category) => chartMonths.map((month) =>
    cardBills(month).filter((bill) => bill.category === category).reduce((total, bill) => total + bill.amount, 0)
  ));
  const maxValue = Math.max(...values, 0);
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const xFor = (index: number) => chartMonths.length <= 1 ? PADDING.left + plotWidth / 2 : PADDING.left + (index / (chartMonths.length - 1)) * plotWidth;
  const yFor = (value: number) => PADDING.top + plotHeight - (maxValue > 0 ? (value / maxValue) * plotHeight : 0);
  const series = selectedCategories.map((category) => ({
    category,
    points: chartMonths.map((month, index) => {
      const value = cardBills(month).filter((bill) => bill.category === category).reduce((total, bill) => total + bill.amount, 0);
      return { x: xFor(index), y: yFor(value), value };
    }),
  }));
  const gridValues = [0, 0.5, 1].map((ratio) => maxValue * ratio);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Gastos no cartão por categoria</h3>
          <div style={{ marginTop: 5, fontSize: 11, color: '#3a3a3a' }}>Evolução mensal · selecione até 3 categorias</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {availableCategories.map((category) => {
            const selected = selectedCategories.includes(category);
            const limitReached = selectedCategories.length === 3 && !selected;
            return (
              <button key={category} type="button" onClick={() => toggleCategory(category)} disabled={limitReached} style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${selected ? BILL_CATEGORY_COLORS[category] : '#242424'}`, background: selected ? `${BILL_CATEGORY_COLORS[category]}18` : '#151515', borderRadius: 5, color: selected ? '#d4d4d4' : '#555', cursor: limitReached ? 'not-allowed' : 'pointer', opacity: limitReached ? 0.45 : 1, padding: '5px 8px', fontSize: 10, transition: 'all 0.15s' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: BILL_CATEGORY_COLORS[category] }} />
                {BILL_CATEGORY_LABELS[category]}
              </button>
            );
          })}
        </div>
      </div>

      {selectedCategories.length === 0 ? (
        <div style={{ border: '1px dashed #242424', borderRadius: 8, padding: 28, textAlign: 'center', color: '#444', fontSize: 12 }}>Selecione uma categoria para visualizar a evolução.</div>
      ) : chartMonths.length === 0 ? (
        <div style={{ border: '1px dashed #242424', borderRadius: 8, padding: 28, textAlign: 'center', color: '#444', fontSize: 12 }}>Ainda não há lançamentos de cartão suficientes para comparar.</div>
      ) : (
        <div style={{ margin: '0 -4px' }}>
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} width="100%" role="img" aria-label="Evolução mensal dos gastos no cartão por categoria" style={{ display: 'block' }}>
            {gridValues.map((value) => {
              const y = yFor(value);
              return (
                <g key={value}>
                  <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={y} y2={y} stroke="#202020" strokeDasharray="3 5" />
                  <text x={PADDING.left - 8} y={y + 3} textAnchor="end" fill="#444" fontSize="10">{hideValues ? '•••' : formatCurrency(value).replace('R$', '').trim()}</text>
                </g>
              );
            })}
            <line x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={PADDING.top + plotHeight} y2={PADDING.top + plotHeight} stroke="#292929" />
            {chartMonths.map((month, index) => (
              <g key={month.id}>
                <text x={xFor(index)} y={CHART_HEIGHT - 23} textAnchor="middle" fill="#555" fontSize="10">{formatMonthShort(month.name, month.year)}</text>
                <text x={xFor(index)} y={CHART_HEIGHT - 9} textAnchor="middle" fill="#777" fontSize="9">{hideValues ? '•••' : formatCurrency(selectedCategories.reduce((total, category) => total + cardBills(month).filter((bill) => bill.category === category).reduce((sum, bill) => sum + bill.amount, 0), 0))}</text>
              </g>
            ))}
            {series.map(({ category, points }) => (
              <g key={category}>
                <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={BILL_CATEGORY_COLORS[category]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {points.map((point, index) => <circle key={`${category}-${index}`} cx={point.x} cy={point.y} r="4" fill="#111" stroke={BILL_CATEGORY_COLORS[category]} strokeWidth="2" />)}
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
};
