import React from 'react';
import {
  type Bill,
  type BillCategory,
  BILL_CATEGORY_LABELS,
  BILL_CATEGORY_COLORS,
  formatCurrency,
} from '../types';

interface Props {
  bills: Bill[];
  hideValues?: boolean;
}

interface CategoryData {
  category: BillCategory;
  label: string;
  color: string;
  amount: number;
  pct: number;
}

export const CategoryChart: React.FC<Props> = ({ bills, hideValues }) => {
  const map = new Map<BillCategory, number>();
  bills.forEach((b) => { map.set(b.category, (map.get(b.category) || 0) + b.amount); });

  const total = bills.reduce((s, b) => s + b.amount, 0);
  if (total === 0) return <div style={{ textAlign: 'center', color: '#333', fontSize: 12, padding: 20 }}>Nenhum gasto para exibir.</div>;

  const data: CategoryData[] = Array.from(map.entries())
    .map(([category, amount]) => ({ category, label: BILL_CATEGORY_LABELS[category], color: BILL_CATEGORY_COLORS[category], amount, pct: (amount / total) * 100 }))
    .sort((a, b) => b.amount - a.amount);

  const size = 130;
  const strokeWidth = 18;
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
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1a1a1a" strokeWidth={strokeWidth} />
            {segments.map((s, i) => (
              <circle key={i} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={s.color} strokeWidth={strokeWidth} strokeDasharray={`${s.dashArray} ${circumference - s.dashArray}`} strokeDashoffset={-s.offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'all 0.4s ease' }} />
            ))}
          </svg>
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#d4d4d4', marginTop: 1, transition: 'color 0.2s' }}>{hideValues ? 'R$ ••••' : formatCurrency(total)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {data.map((d) => (
          <div key={d.category} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6 }}>
            <div style={{ width: 3, height: 24, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, color: '#b0b0b0', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</div>
              <div style={{ fontSize: 10, color: '#3a3a3a' }}>{d.pct.toFixed(1)}%</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: hideValues ? '#1a1a1a' : '#d4d4d4', flexShrink: 0, transition: 'color 0.2s' }}>
              {hideValues ? 'R$ ••••' : formatCurrency(d.amount)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
