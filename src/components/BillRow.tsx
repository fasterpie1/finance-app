import React, { useState, useRef, useEffect } from 'react';
import {
  type Bill,
  type BillCategory,
  type BillType,
  BILL_CATEGORY_LABELS,
  BILL_CATEGORY_ICONS,
  BILL_TYPE_LABELS,
  formatCurrency,
} from '../types';

interface Props {
  bill: Bill;
  onTogglePaid: () => void;
  onSave: (bill: Bill) => void;
  onDelete: () => void;
}

type EditField = 'name' | 'amount' | 'dueDay' | 'category' | 'type' | null;

const editInputStyle: React.CSSProperties = {
  background: '#111',
  border: '1px solid #3b82f6',
  borderRadius: 6,
  color: '#e0e0e0',
  padding: '2px 7px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
};

export const BillRow: React.FC<Props> = ({ bill, onTogglePaid, onSave, onDelete }) => {
  const [editField, setEditField] = useState<EditField>(null);
  const [editStr, setEditStr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (editField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editField]);

  const startEdit = (field: 'name' | 'amount' | 'dueDay') => {
    if (field === 'name') setEditStr(bill.name);
    else if (field === 'amount') setEditStr(String(bill.amount));
    else if (field === 'dueDay') setEditStr(String(bill.dueDay));
    setEditField(field);
  };

  const commit = () => {
    if (!editField) return;
    let updated = { ...bill };
    if (editField === 'name') updated = { ...updated, name: editStr.trim() || bill.name };
    else if (editField === 'amount') updated = { ...updated, amount: parseFloat(editStr) || 0 };
    else if (editField === 'dueDay') updated = { ...updated, dueDay: Math.max(1, Math.min(31, parseInt(editStr) || 1)) };
    onSave(updated);
    setEditField(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditField(null);
  };

  const editableStyle = (active: boolean): React.CSSProperties => ({
    cursor: 'text',
    borderBottom: active ? '1px solid #3b82f6' : hovered ? '1px dashed #333' : '1px solid transparent',
    paddingBottom: 1,
    transition: 'border-color 0.15s',
    borderRadius: 2,
  });

  // Pre-calculados fora das branches para evitar narrowing do TypeScript
  const isEditingName = editField === 'name';
  const isEditingAmount = editField === 'amount';
  const isEditingDueDay = editField === 'dueDay';
  const isEditingType = editField === 'type';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: editField ? '#1e1e1e' : '#1a1a1a',
        border: `1px solid ${editField ? '#3b82f622' : hovered ? '#2d2d2d' : '#252525'}`,
        borderRadius: 12,
        padding: '11px 14px',
        opacity: bill.isPaid ? 0.6 : 1,
        transition: 'all 0.15s',
      }}
    >
      {/* Toggle pago */}
      <button
        onClick={onTogglePaid}
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: `2px solid ${bill.isPaid ? '#10b981' : '#383838'}`,
          background: bill.isPaid ? '#10b981' : 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.15s',
          padding: 0,
        }}
      >
        {bill.isPaid && (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Ícone da categoria */}
      <span style={{ fontSize: 15, flexShrink: 0 }}>{BILL_CATEGORY_ICONS[bill.category]}</span>

      {/* Nome — clique para editar */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {editField === 'name' ? (
            <input
              ref={inputRef}
              value={editStr}
              onChange={(e) => setEditStr(e.target.value)}
              onBlur={commit}
              onKeyDown={onKeyDown}
              style={{ ...editInputStyle, width: 160, fontWeight: 600 }}
            />
          ) : (
            <span
              onClick={() => startEdit('name')}
              title="Clique para editar"
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: bill.isPaid ? '#6b7280' : '#e0e0e0',
                textDecoration: bill.isPaid ? 'line-through' : 'none',
                ...editableStyle(isEditingName),
              }}
            >
              {bill.name}
            </span>
          )}

          {bill.installmentCurrent != null && bill.installmentTotal != null && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#6b7280',
                background: '#252525',
                border: '1px solid #333',
                borderRadius: 20,
                padding: '1px 7px',
              }}
            >
              {bill.installmentCurrent}/{bill.installmentTotal}
            </span>
          )}
        </div>

        {/* Meta info */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Categoria — clique para editar */}
          {editField === 'category' ? (
            <select
              autoFocus
              value={bill.category}
              onChange={(e) => { onSave({ ...bill, category: e.target.value as BillCategory }); setEditField(null); }}
              onBlur={() => setEditField(null)}
              style={{ ...editInputStyle, fontSize: 11, padding: '1px 5px' }}
            >
              {(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((c) => (
                <option key={c} value={c}>{BILL_CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          ) : (
            <span
              onClick={() => setEditField('category')}
              title="Clique para mudar categoria"
              style={{ fontSize: 11, color: '#555', background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 5, padding: '1px 6px', cursor: 'pointer' }}
            >
              {BILL_CATEGORY_LABELS[bill.category]}
            </span>
          )}

          <span style={{ fontSize: 11, color: '#3a3a3a' }}>·</span>

          {/* Dia — clique para editar */}
          {editField === 'dueDay' ? (
            <input
              ref={inputRef}
              type="number"
              min={1}
              max={31}
              value={editStr}
              onChange={(e) => setEditStr(e.target.value)}
              onBlur={commit}
              onKeyDown={onKeyDown}
              style={{ ...editInputStyle, width: 48, fontSize: 11 }}
            />
          ) : (
            <span
              onClick={() => startEdit('dueDay')}
              title="Clique para editar o dia"
              style={{ fontSize: 11, color: '#555', cursor: 'text', ...editableStyle(isEditingDueDay) }}
            >
              Dia {bill.dueDay}
            </span>
          )}

          <span style={{ fontSize: 11, color: '#3a3a3a' }}>·</span>

          {/* Tipo — clique para editar */}
          {editField === 'type' ? (
            <select
              autoFocus
              value={bill.type}
              onChange={(e) => { onSave({ ...bill, type: e.target.value as BillType }); setEditField(null); }}
              onBlur={() => setEditField(null)}
              style={{ ...editInputStyle, fontSize: 11, padding: '1px 5px' }}
            >
              {(Object.keys(BILL_TYPE_LABELS) as BillType[]).map((t) => (
                <option key={t} value={t}>{BILL_TYPE_LABELS[t]}</option>
              ))}
            </select>
          ) : (
            <span
              onClick={() => setEditField('type')}
              title="Clique para mudar tipo"
              style={{ fontSize: 11, color: '#555', cursor: 'pointer', ...editableStyle(isEditingType) }}
            >
              {BILL_TYPE_LABELS[bill.type]}
            </span>
          )}

          {bill.note && (
            <>
              <span style={{ fontSize: 11, color: '#3a3a3a' }}>·</span>
              <span style={{ fontSize: 11, color: '#444', fontStyle: 'italic' }}>{bill.note}</span>
            </>
          )}
        </div>
      </div>

      {/* Valor — clique para editar */}
      {editField === 'amount' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>R$</span>
          <input
            ref={inputRef}
            type="number"
            step="0.01"
            min="0"
            value={editStr}
            onChange={(e) => setEditStr(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            style={{ ...editInputStyle, width: 90, fontWeight: 700, fontSize: 15 }}
          />
        </div>
      ) : (
        <span
          onClick={() => startEdit('amount')}
          title="Clique para editar o valor"
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: bill.isPaid ? '#10b981' : '#e0e0e0',
            flexShrink: 0,
            cursor: 'text',
            letterSpacing: '-0.01em',
            ...editableStyle(isEditingAmount),
          }}
        >
          {formatCurrency(bill.amount)}
        </span>
      )}

      {/* Deletar */}
      <button
        onClick={onDelete}
        style={{
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 7,
          color: hovered ? '#ef444488' : '#2a2a2a',
          cursor: 'pointer',
          padding: '3px 7px',
          fontSize: 13,
          transition: 'all 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#ef444433'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = hovered ? '#ef444488' : '#2a2a2a'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'; }}
      >
        🗑
      </button>
    </div>
  );
};
