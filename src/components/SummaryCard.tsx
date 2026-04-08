import React from 'react';

interface Props {
  title: string;
  value: string;
  icon: string;
  accent?: 'green' | 'blue' | 'red' | 'yellow' | 'default';
  subtitle?: string;
  valueColor?: string;
}

const accentColors: Record<string, string> = {
  green: '#10b981',
  blue: '#3b82f6',
  red: '#ef4444',
  yellow: '#f59e0b',
  default: '#6b7280',
};

export const SummaryCard: React.FC<Props> = ({ title, value, icon, accent = 'default', subtitle, valueColor }) => {
  const color = accentColors[accent];
  return (
    <div
      style={{
        flex: 1,
        background: '#1a1a1a',
        border: `1px solid #2a2a2a`,
        borderRadius: 14,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: color, borderRadius: '14px 0 0 14px' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: valueColor || '#f0f0f0', letterSpacing: '-0.02em' }}>{value}</div>
      {subtitle && <div style={{ fontSize: 11, color: '#6b7280' }}>{subtitle}</div>}
    </div>
  );
};
