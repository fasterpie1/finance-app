import React, { useState, useRef, useEffect } from 'react';
import {
  type Bill,
  type BillCategory,
  type BillType,
  BILL_CATEGORY_LABELS,
  BILL_CATEGORY_ICONS,
  BILL_TYPE_LABELS,
} from '../types';

interface Props {
  monthName: string;
  onSave: (bill: Bill) => void;
  onCancel: () => void;
  defaultType?: BillType;
}

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const fieldStyle: React.CSSProperties = {
  background: '#111',
  border: '1px solid #2d2d2d',
  borderRadius: 7,
  color: '#e0e0e0',
  padding: '6px 10px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
};

const focusStyle = `
  .inline-add-input:focus { border-color: #3b82f6 !important; }
  .inline-add-select:focus { border-color: #3b82f6 !important; }
`;

export const InlineAddRow: React.FC<Props> = ({ monthName, onSave, onCancel, defaultType = 'mensal' }) => {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('1');
  const [category, setCategory] = useState<BillCategory>('outros');
  const [type, setType] = useState<BillType>(defaultType);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const styleEl = document.createElement('style');
    styleEl.textContent = focusStyle;
    document.head.appendChild(styleEl);
    return () => { document.head.removeChild(styleEl); };
  }, []);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) { nameRef.current?.focus(); return; }
    const parsed = parseFloat(amount);
    onSave({
      id: uuid(),
      name: trimmed,
      category,
      amount: isNaN(parsed) ? 0 : parsed,
      dueDay: Math.max(1, Math.min(31, parseInt(dueDay) || 1)),
      type,
      isPaid: false,
      month: monthName,
      note: '',
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#141414',
        border: '1px dashed #3b82f655',
        borderRadius: 12,
        padding: '10px 12px',
        flexWrap: 'wrap',
      }}
    >
      {/* Ícone dinâmico */}
      <span style={{ fontSize: 16, flexShrink: 0 }}>{BILL_CATEGORY_ICONS[category]}</span>

      {/* Nome */}
      <input
        ref={nameRef}
        className="inline-add-input"
        placeholder="Nome da conta..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        style={{ ...fieldStyle, flex: '1 1 140px', minWidth: 120 }}
      />

      {/* Valor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: '#555' }}>R$</span>
        <input
          className="inline-add-input"
          type="number"
          step="0.01"
          min="0"
          placeholder="0,00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={onKeyDown}
          style={{ ...fieldStyle, width: 90 }}
        />
      </div>

      {/* Dia */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: '#555' }}>Dia</span>
        <input
          className="inline-add-input"
          type="number"
          min={1}
          max={31}
          value={dueDay}
          onChange={(e) => setDueDay(e.target.value)}
          onKeyDown={onKeyDown}
          style={{ ...fieldStyle, width: 48 }}
        />
      </div>

      {/* Categoria */}
      <select
        className="inline-add-select"
        value={category}
        onChange={(e) => setCategory(e.target.value as BillCategory)}
        style={{ ...fieldStyle, appearance: 'none', paddingRight: 24, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' fill=\'none\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%23666\' stroke-width=\'1.5\' stroke-linecap=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', minWidth: 100 }}
      >
        {(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((c) => (
          <option key={c} value={c}>{BILL_CATEGORY_LABELS[c]}</option>
        ))}
      </select>

      {/* Tipo */}
      <select
        className="inline-add-select"
        value={type}
        onChange={(e) => setType(e.target.value as BillType)}
        style={{ ...fieldStyle, appearance: 'none', paddingRight: 24, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' fill=\'none\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%23666\' stroke-width=\'1.5\' stroke-linecap=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', minWidth: 90 }}
      >
        {(Object.keys(BILL_TYPE_LABELS) as BillType[]).map((t) => (
          <option key={t} value={t}>{BILL_TYPE_LABELS[t]}</option>
        ))}
      </select>

      {/* Botões */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={handleSave}
          style={{
            background: '#3b82f6',
            border: 'none',
            borderRadius: 7,
            color: '#fff',
            cursor: 'pointer',
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ✓ Salvar
        </button>
        <button
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: '1px solid #2d2d2d',
            borderRadius: 7,
            color: '#6b7280',
            cursor: 'pointer',
            padding: '6px 10px',
            fontSize: 13,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
};
