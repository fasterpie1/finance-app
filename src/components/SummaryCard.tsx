import React from 'react';

interface Props {
  title: string;
  value: string;
  accent?: 'green' | 'blue' | 'red' | 'yellow' | 'default';
  subtitle?: string;
  valueColor?: string;
  hidden?: boolean;
}

const accentColors: Record<string, string> = {
  green: '#10b981',
  blue: '#3b82f6',
  red: '#ef4444',
  yellow: '#f59e0b',
  default: '#333',
};

export const SummaryCard: React.FC<Props> = ({ title, value, accent = 'default', subtitle, valueColor, hidden }) => {
  const color = accentColors[accent];
  const valueTone = valueColor === '#ef4444' ? 'red' : valueColor === '#10b981' ? 'green' : accent;
  return (
    <div
      className="theme-summary-card"
      style={{
        flex: 1,
        background: '#131313',
        border: '1px solid #1e1e1e',
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        className={`theme-summary-value theme-summary-value-${valueTone}`}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 3,
          height: '100%',
          background: color,
          borderRadius: '12px 0 0 12px',
        }}
      />
      <span
        style={{
          fontSize: 10,
          color: '#555',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
        }}
      >
        {title}
      </span>
      <div className="privacy-mask"
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: hidden ? 'var(--privacy-mask)' : (valueColor || '#e8e8e8'),
          letterSpacing: '-0.02em',
          transition: 'color 0.2s',
        }}
      >
        {hidden ? '••••' : value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: '#444' }}>{subtitle}</div>
      )}
    </div>
  );
};
