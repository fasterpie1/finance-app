import React, { useState, useRef, useEffect } from 'react';
import {
  type Bill,
  type BillCategory,
  type BillType,
  BILL_CATEGORY_LABELS,
  BILL_CATEGORY_COLORS,
  BILL_TYPE_LABELS,
  parseBRL,
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
  background: '#0e0e0e',
  border: '1px solid #222',
  borderRadius: 6,
  color: '#e0e0e0',
  padding: '6px 10px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
};

export const InlineAddRow: React.FC<Props> = ({ monthName, onSave, onCancel, defaultType = 'mensal' }) => {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('1');
  const [category, setCategory] = useState<BillCategory>('outros');
  const [type, setType] = useState<BillType>(defaultType);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) { nameRef.current?.focus(); return; }
    onSave({
      id: uuid(),
      name: trimmed,
      category,
      amount: parseBRL(amount),
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

  const categoryColor = BILL_CATEGORY_COLORS[category];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#111', border: '1px dashed #2a2a2a', borderRadius: 10, padding: '10px 12px', flexWrap: 'wrap' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: categoryColor, flexShrink: 0, opacity: 0.8 }} />
      <input ref={nameRef} placeholder="Nome da conta..." value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKeyDown} style={{ ...fieldStyle, flex: '1 1 140px', minWidth: 120 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#444' }}>R$</span>
        <input inputMode="decimal" pattern="[0-9.,]*" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} onKeyDown={onKeyDown} style={{ ...fieldStyle, width: 90 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: '#444' }}>Dia</span>
        <input inputMode="numeric" pattern="[0-9]*" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={onKeyDown} style={{ ...fieldStyle, width: 48 }} />
      </div>
      <select value={category} onChange={(e) => setCategory(e.target.value as BillCategory)} style={{ ...fieldStyle, minWidth: 100 }}>
        {(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((c) => (
          <option key={c} value={c}>{BILL_CATEGORY_LABELS[c]}</option>
        ))}
      </select>
      <select value={type} onChange={(e) => setType(e.target.value as BillType)} style={{ ...fieldStyle, minWidth: 90 }}>
        {(Object.keys(BILL_TYPE_LABELS) as BillType[]).map((t) => (
          <option key={t} value={t}>{BILL_TYPE_LABELS[t]}</option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button onClick={handleSave} style={{ background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '6px 14px', fontSize: 12, fontWeight: 600 }}>Salvar</button>
        <button onClick={onCancel} style={{ background: 'transparent', border: '1px solid #222', borderRadius: 6, color: '#555', cursor: 'pointer', padding: '6px 10px', fontSize: 12 }}>×</button>
      </div>
    </div>
  );
};
