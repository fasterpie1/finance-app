import React from 'react';
import {
  type Bill,
  type BillCategory,
  BILL_CATEGORY_LABELS,
  BILL_CATEGORY_ICONS,
  BILL_CATEGORY_COLORS,
  formatCurrency,
} from '../types';

interface Props {
  bills: Bill[];
}

interface CategoryData {
  category: BillCategory;
  label: string;
  icon: string;
  color: string;
  amount: number;
  pct: number;
}

export const CategoryChart: React.FC<Props> = ({ bills }) => {
  // Agrupar por categoria
  const map = new Map<BillCategory, number>();
  bills.forEach((b) => {
    map.set(b.category, (map.get(b.category) || 0) + b.amount);
  });

  const total = bills.reduce((s, b) => s + b.amount, 0);
  if (total === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#444', fontSize: 13, padding: 20 }}>
        Nenhum gasto para exibir o gráfico.
      </div>
    );
  }

  const data: CategoryData[] = Array.from(map.entries())
    .map(([category, amount]) => ({
      category,
      label: BILL_CATEGORY_LABELS[category],
      icon: BILL_CATEGORY_ICONS[category],
      color: BILL_CATEGORY_COLORS[category],
      amount,
      pct: (amount / total) * 100,
    }))
    .sort((a, b) => b.amount - a.amount);

  // SVG Donut
  const size = 150;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = data.map((d) => {
    const dashArray = (d.pct / 100) * circumference;
    const currentOffset = offset;
    offset += dashArray;
    return { ...d, dashArray, offset: currentOffset };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Gráfico + Centro */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Fundo */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#1e1e1e"
              strokeWidth={strokeWidth}
            />
            {/* Segmentos */}
            {segments.map((s, i) => (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${s.dashArray} ${circumference - s.dashArray}`}
                strokeDashoffset={-s.offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: 'all 0.4s ease' }}
              />
            ))}
          </svg>
          {/* Texto central */}
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f0f0f0', marginTop: 2 }}>{formatCurrency(total)}</div>
          </div>
        </div>

        {/* Legenda */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 140 }}>
          {data.map((d) => (
            <div
              key={d.category}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 0',
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#9ca3af', flex: 1 }}>
                {d.icon} {d.label}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0', textAlign: 'right', minWidth: 70 }}>
                {formatCurrency(d.amount)}
              </span>
              <span style={{ fontSize: 10, color: '#555', minWidth: 35, textAlign: 'right' }}>
                {d.pct.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
