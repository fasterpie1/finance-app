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
  const size = 140;
  const strokeWidth = 20;
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
      {/* Gráfico centralizado */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e1e1e" strokeWidth={strokeWidth} />
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
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f0f0', marginTop: 1 }}>{formatCurrency(total)}</div>
          </div>
        </div>
      </div>

      {/* Legenda — layout vertical compacto */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {data.map((d) => (
          <div
            key={d.category}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              background: '#111',
              borderRadius: 8,
            }}
          >
            {/* Barra de cor proporcional */}
            <div style={{ width: 4, height: 28, borderRadius: 2, background: d.color, flexShrink: 0 }} />

            {/* Ícone + Nome */}
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, color: '#e0e0e0', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.icon} {d.label}
              </div>
              <div style={{ fontSize: 10, color: '#555' }}>{d.pct.toFixed(1)}%</div>
            </div>

            {/* Valor */}
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0', flexShrink: 0 }}>
              {formatCurrency(d.amount)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
