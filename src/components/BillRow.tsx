import React, { useState, useRef, useEffect } from 'react';
import {
  type Bill,
  type BillCategory,
  type BillType,
  BILL_CATEGORY_LABELS,
  BILL_CATEGORY_COLORS,
  BILL_TYPE_LABELS,
} from '../types';
import { CalendarReminderButton } from './CalendarReminderButton';
import { usePreferences } from '../i18n';

interface Props {
  bill: Bill;
  onTogglePaid: () => void;
  onSave: (bill: Bill) => void;
  onDelete: () => void;
  hideValues?: boolean;
  /** Mostrar o botão de marcar como pago (padrão: true) */
  showPaidToggle?: boolean;
  /** Mostrar a opção de vincular ao cartão (para contas fixas) */
  showCreditCardToggle?: boolean;
  onCalendarReminder?: () => void;
  calendarReminderLoading?: boolean;
}

type EditField = 'name' | 'amount' | 'dueDay' | 'category' | 'type' | null;

const editInputStyle: React.CSSProperties = {
  background: '#0e0e0e',
  border: '1px solid #333',
  borderRadius: 6,
  color: '#e0e0e0',
  padding: '2px 7px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
};

export const BillRow: React.FC<Props> = ({ bill, onTogglePaid, onSave, onDelete, hideValues, showPaidToggle = true, showCreditCardToggle = false, onCalendarReminder, calendarReminderLoading = false }) => {
  const { formatMoney, parseAmount, categoryLabel, typeLabel, currencySymbol, t } = usePreferences();
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
    else if (editField === 'amount') updated = { ...updated, amount: parseAmount(editStr) };
    else if (editField === 'dueDay') updated = { ...updated, dueDay: Math.max(1, Math.min(31, parseInt(editStr) || 1)) };
    onSave(updated);
    setEditField(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditField(null);
  };

  const openEditOnKey = (open: () => void) => (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };

  const categoryColor = BILL_CATEGORY_COLORS[bill.category];
  const isCardInstallment = bill.type === 'parcela' && bill.category !== 'financiamento' && bill.cardPaymentMethod !== 'debito_pix';

  return (
    <div
      className="theme-bill-row"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: editField ? '#161616' : '#131313',
        border: `1px solid ${editField ? '#252525' : hovered ? '#222' : '#1a1a1a'}`,
        borderRadius: 10,
        padding: '10px 14px',
        opacity: bill.isPaid ? 0.55 : 1,
        transition: 'all 0.15s',
      }}
    >
      {/* Toggle pago — alvo de 44px com círculo visual de 20px dentro */}
      {showPaidToggle ? (
        <button
          onClick={onTogglePaid}
          role="checkbox"
          aria-checked={bill.isPaid}
          aria-label={bill.isPaid ? t('markAsUnpaid') : t('markAsPaid')}
          title={bill.isPaid ? t('markAsUnpaid') : t('markAsPaid')}
          style={{
            width: 44,
            height: 44,
            margin: -12,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            padding: 0,
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: `2px solid ${bill.isPaid ? '#10b981' : '#6b6b6b'}`,
              background: bill.isPaid ? '#10b981' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            {bill.isPaid && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>
      ) : (
        <div
          style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          role="img"
          aria-label={bill.isPaid ? t('paid') : t('unpaid')}
        >
          {bill.isPaid ? (
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 6l3 3 5-5" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <div aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: '#6b6b6b' }} />
          )}
        </div>
      )}

      {/* Color dot */}
      <div aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: categoryColor, flexShrink: 0, opacity: 0.8 }} />

      {/* Nome */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {editField === 'name' ? (
            <input ref={inputRef} value={editStr} onChange={(e) => setEditStr(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} style={{ ...editInputStyle, width: 160, fontWeight: 600 }} />
          ) : (
            <span role="button" tabIndex={0} onClick={() => startEdit('name')} onKeyDown={openEditOnKey(() => startEdit('name'))} style={{ fontSize: 13, fontWeight: 600, color: bill.isPaid ? '#8b8b8b' : '#d4d4d4', textDecoration: bill.isPaid ? 'line-through' : 'none', cursor: 'text' }}>
              {bill.name}
            </span>
          )}
          {bill.installmentCurrent != null && bill.installmentTotal != null && (
            <span className="theme-installment-pill" style={{ fontSize: 10, fontWeight: 600, color: '#8b8b8b', background: '#1a1a1a', border: '1px solid #252525', borderRadius: 4, padding: '1px 6px' }}>
              {bill.installmentCurrent}/{bill.installmentTotal}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {editField === 'category' ? (
            <select autoFocus value={bill.category} onChange={(e) => { onSave({ ...bill, category: e.target.value as BillCategory }); setEditField(null); }} onBlur={() => setEditField(null)} style={{ ...editInputStyle, fontSize: 11, padding: '1px 5px' }}>
              {(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((c) => (
                <option key={c} value={c}>{categoryLabel(c)}</option>
              ))}
            </select>
          ) : (
            <span className="theme-category-pill" role="button" tabIndex={0} onClick={() => setEditField('category')} onKeyDown={openEditOnKey(() => setEditField('category'))} style={{ fontSize: 10, color: '#8b8b8b', background: '#151515', border: '1px solid #1e1e1e', borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}>
              {categoryLabel(bill.category)}
            </span>
          )}

          {!isCardInstallment && (
            <>
              <span style={{ fontSize: 10, color: '#5a5a5a' }}>·</span>
              {editField === 'dueDay' ? (
                <input ref={inputRef} inputMode="numeric" pattern="[0-9]*" value={editStr} onChange={(e) => setEditStr(e.target.value.replace(/[^0-9]/g, ''))} onBlur={commit} onKeyDown={onKeyDown} style={{ ...editInputStyle, width: 48, fontSize: 11 }} />
              ) : (
                <span role="button" tabIndex={0} onClick={() => startEdit('dueDay')} onKeyDown={openEditOnKey(() => startEdit('dueDay'))} style={{ fontSize: 10, color: '#8b8b8b', cursor: 'text' }}>
                  {t('dueDate')} {bill.dueDay}
                </span>
              )}
              <span style={{ fontSize: 10, color: '#5a5a5a' }}>·</span>
            </>
          )}

          {editField === 'type' ? (
            <select autoFocus value={bill.type} onChange={(e) => { onSave({ ...bill, type: e.target.value as BillType }); setEditField(null); }} onBlur={() => setEditField(null)} style={{ ...editInputStyle, fontSize: 11, padding: '1px 5px' }}>
              {(Object.keys(BILL_TYPE_LABELS) as BillType[]).map((type) => (
                <option key={type} value={type}>{typeLabel(type)}</option>
              ))}
            </select>
          ) : (
            <span role="button" tabIndex={0} onClick={() => setEditField('type')} onKeyDown={openEditOnKey(() => setEditField('type'))} style={{ fontSize: 10, color: '#8b8b8b', cursor: 'pointer' }}>
              {typeLabel(bill.type)}
            </span>
          )}

          {/* Tag Cartão — para contas fixas vinculadas ao cartão */}
          {showCreditCardToggle && (
            <>
              <span style={{ fontSize: 10, color: '#5a5a5a' }}>·</span>
              <span
                role="button"
                tabIndex={0}
                onClick={() => onSave({ ...bill, isOnCreditCard: !bill.isOnCreditCard })}
                onKeyDown={openEditOnKey(() => onSave({ ...bill, isOnCreditCard: !bill.isOnCreditCard }))}
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: bill.isOnCreditCard ? '#60a5fa' : '#8b8b8b',
                  background: bill.isOnCreditCard ? '#111520' : '#151515',
                  border: `1px solid ${bill.isOnCreditCard ? '#1e2a3e' : '#1e1e1e'}`,
                  borderRadius: 4,
                  padding: '1px 6px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  userSelect: 'none',
                }}
                title={bill.isOnCreditCard ? t('linkedToCardTitle') : t('linkToCardTitle')}
              >
                {bill.isOnCreditCard ? t('cardLinkedLabel') : t('cardLinkLabel')}
              </span>
            </>
          )}
          {/* Indicador visual quando está no cartão (fora do modo edit) */}
          {!showCreditCardToggle && bill.isOnCreditCard && (
            <>
              <span style={{ fontSize: 10, color: '#5a5a5a' }}>·</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: '#60a5fa', background: '#111520', border: '1px solid #1e2a3e', borderRadius: 4, padding: '1px 6px' }}>💳</span>
            </>
          )}
        </div>
        {onCalendarReminder && !bill.isPaid && (
          <div style={{ marginTop: 2, alignSelf: 'flex-start' }}>
            <CalendarReminderButton added={Boolean(bill.calendarEventId)} loading={calendarReminderLoading} onClick={onCalendarReminder} />
          </div>
        )}
      </div>

      {/* Valor */}
      {editField === 'amount' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#8b8b8b' }}>{currencySymbol}</span>
          <input ref={inputRef} inputMode="decimal" pattern="[0-9.,]*" value={editStr} onChange={(e) => setEditStr(e.target.value.replace(/[^0-9.,]/g, ''))} onBlur={commit} onKeyDown={onKeyDown} style={{ ...editInputStyle, width: 90, fontWeight: 700, fontSize: 14 }} />
        </div>
      ) : (
        <span className="privacy-mask" role="button" tabIndex={0} onClick={() => startEdit('amount')} onKeyDown={openEditOnKey(() => startEdit('amount'))} style={{ fontSize: 14, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : (bill.isPaid ? '#10b981' : '#d4d4d4'), flexShrink: 0, cursor: 'text', letterSpacing: '-0.01em', transition: 'color 0.2s' }}>
          {hideValues ? '••••' : formatMoney(bill.amount)}
        </span>
      )}

      {/* Deletar — ícone sempre visível e alvo de 44px: invisível só no hover
          quebrava o uso por toque e o botão não tinha nome acessível. */}
      <button
        onClick={onDelete}
        aria-label={t('deleteBill')}
        title={t('deleteBill')}
        style={{ background: 'transparent', border: 'none', borderRadius: 6, color: '#8b8b8b', cursor: 'pointer', padding: 0, width: 44, height: 44, fontSize: 12, transition: 'color 0.15s', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#8b8b8b'; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </button>
    </div>
  );
};
