import React, { useState } from 'react';
import {
  type BillCategory,
  BILL_CATEGORY_LABELS,
  BILL_CATEGORY_ICONS,
  formatCurrency,
} from '../types';
import { type CreditCardPurchase } from '../store/useDashboard';
import { BillRow } from './BillRow';
import { type Bill } from '../types';

interface Props {
  selectedMonthName: string;
  creditCardBills: Bill[];
  allMonths: { id: string; name: string; bills: Bill[] }[];
  onTogglePaid: (id: string) => void;
  onSaveBill: (bill: Bill) => void;
  onDeleteBill: (id: string) => void;
  onAddPurchase: (p: CreditCardPurchase) => void;
  getAffectedMonths: (cur: number, total: number) => string[];
}

const fieldStyle: React.CSSProperties = {
  background: '#111',
  border: '1px solid #2d2d2d',
  borderRadius: 8,
  color: '#e0e0e0',
  padding: '8px 12px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#6b7280',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 4,
  display: 'block',
};

export const CreditCardView: React.FC<Props> = ({
  selectedMonthName,
  creditCardBills,
  allMonths,
  onTogglePaid,
  onSaveBill,
  onDeleteBill,
  onAddPurchase,
  getAffectedMonths,
}) => {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [category, setCategory] = useState<BillCategory>('financiamento');
  const [curInstallment, setCurInstallment] = useState('1');
  const [totalInstallment, setTotalInstallment] = useState('12');
  const [formOpen, setFormOpen] = useState(true);

  const cur = parseInt(curInstallment) || 1;
  const total = parseInt(totalInstallment) || 1;
  const affected = getAffectedMonths(Math.min(cur, total), Math.max(cur, total));

  // Estatísticas globais: soma de todas as parcelas em meses futuros
  const totalDebt = allMonths.reduce((sum, m) => {
    return sum + m.bills
      .filter((b) => b.type === 'parcela' && b.category !== 'financiamento' && !b.isPaid)
      .reduce((s, b) => s + b.amount, 0);
  }, 0);

  const monthlyFromCard = creditCardBills.reduce((s, b) => s + b.amount, 0);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed || !amount) return;
    const c = Math.max(1, Math.min(cur, total));
    const t = Math.max(c, total);
    onAddPurchase({
      name: trimmed,
      amount: parseFloat(amount) || 0,
      dueDay: Math.max(1, Math.min(31, parseInt(dueDay) || 10)),
      category,
      installmentCurrent: c,
      installmentTotal: t,
    });
    setName('');
    setAmount('');
    setCurInstallment('1');
    setTotalInstallment('12');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Resumo do cartão */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 14, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#ef4444', borderRadius: '14px 0 0 14px' }} />
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>Este mês no cartão</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0' }}>{formatCurrency(monthlyFromCard)}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{creditCardBills.length} parcela(s) em {selectedMonthName}</div>
        </div>
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 14, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#f59e0b', borderRadius: '14px 0 0 14px' }} />
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>Dívida total (todos meses)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0' }}>{formatCurrency(totalDebt)}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Parcelas em aberto</div>
        </div>
      </div>

      {/* Formulário de lançamento */}
      <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 16, overflow: 'hidden' }}>
        <button
          onClick={() => setFormOpen((p) => !p)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'transparent',
            border: 'none',
            padding: '14px 18px',
            cursor: 'pointer',
            color: '#e0e0e0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>💳</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Lançar compra no cartão</span>
          </div>
          <span style={{ fontSize: 18, color: '#555', transform: formOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>⌄</span>
        </button>

        {formOpen && (
          <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ height: 1, background: '#1e1e1e', marginBottom: 4 }} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Nome da compra</label>
                <input
                  style={fieldStyle}
                  placeholder="Ex: Tênis Nike"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <div>
                <label style={labelStyle}>Categoria</label>
                <select
                  style={{ ...fieldStyle, appearance: 'none' }}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as BillCategory)}
                >
                  {(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((c) => (
                    <option key={c} value={c}>{BILL_CATEGORY_ICONS[c]} {BILL_CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Valor da parcela (R$)</label>
                <input
                  style={fieldStyle}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="211,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <div>
                <label style={labelStyle}>Parcela atual</label>
                <input
                  style={fieldStyle}
                  type="number"
                  min="1"
                  value={curInstallment}
                  onChange={(e) => setCurInstallment(e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>Total de parcelas</label>
                <input
                  style={fieldStyle}
                  type="number"
                  min="1"
                  value={totalInstallment}
                  onChange={(e) => setTotalInstallment(e.target.value)}
                />
              </div>
            </div>

            <div style={{ maxWidth: 200 }}>
              <label style={labelStyle}>Dia do vencimento</label>
              <input
                style={fieldStyle}
                type="number"
                min="1"
                max="31"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
              />
            </div>

            {/* Preview dos meses afetados */}
            {affected.length > 0 && (
              <div style={{ background: '#0f1f0f', border: '1px solid #1a3a1a', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  ✓ Será lançado automaticamente em {affected.length} {affected.length === 1 ? 'mês' : 'meses'}:
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {affected.map((m, i) => (
                    <span
                      key={m + i}
                      style={{
                        background: i === 0 ? '#16a34a22' : '#1a1a1a',
                        border: `1px solid ${i === 0 ? '#16a34a44' : '#2a2a2a'}`,
                        borderRadius: 6,
                        padding: '3px 10px',
                        fontSize: 12,
                        color: i === 0 ? '#4ade80' : '#6b7280',
                        fontWeight: i === 0 ? 600 : 400,
                      }}
                    >
                      {m}
                      {i === 0 && <span style={{ fontSize: 10, marginLeft: 4 }}>← atual</span>}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>
                  Total comprometido: <strong style={{ color: '#9ca3af' }}>{formatCurrency((parseFloat(amount) || 0) * affected.length)}</strong>
                </div>
              </div>
            )}

            <button
              onClick={handleAdd}
              disabled={!name.trim() || !amount}
              style={{
                background: name.trim() && amount ? '#3b82f6' : '#1a2a3a',
                border: 'none',
                borderRadius: 8,
                color: name.trim() && amount ? '#fff' : '#4b6a8a',
                cursor: name.trim() && amount ? 'pointer' : 'not-allowed',
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 600,
                alignSelf: 'flex-start',
                transition: 'all 0.15s',
              }}
            >
              💳 Lançar {affected.length > 1 ? `nos ${affected.length} meses` : 'no mês'}
            </button>
          </div>
        )}
      </div>

      {/* Lista de parcelas do mês */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Parcelas em {selectedMonthName}
          </h3>
          <span style={{ fontSize: 11, color: '#555', background: '#1e1e1e', border: '1px solid #2d2d2d', borderRadius: 20, padding: '1px 8px' }}>
            {creditCardBills.length}
          </span>
        </div>

        {creditCardBills.length === 0 ? (
          <div style={{ background: '#141414', border: '1px dashed #2a2a2a', borderRadius: 12, padding: '24px', textAlign: 'center', color: '#444', fontSize: 13 }}>
            Nenhuma parcela de cartão em {selectedMonthName}. Use o formulário acima para lançar uma compra.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {creditCardBills.map((bill) => (
              <BillRow
                key={bill.id}
                bill={bill}
                onTogglePaid={() => onTogglePaid(bill.id)}
                onSave={onSaveBill}
                onDelete={() => onDeleteBill(bill.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Visão geral por mês */}
      <div>
        <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Parcelas por mês (visão geral)
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {allMonths
            .filter((m) => m.bills.some((b) => b.type === 'parcela' && b.category !== 'financiamento'))
            .map((m) => {
              const total = m.bills.filter((b) => b.type === 'parcela' && b.category !== 'financiamento').reduce((s, b) => s + b.amount, 0);
              const paid = m.bills.filter((b) => b.type === 'parcela' && b.category !== 'financiamento' && b.isPaid).reduce((s, b) => s + b.amount, 0);
              const pct = total > 0 ? (paid / total) * 100 : 0;
              const isSelected = m.name.toLowerCase() === selectedMonthName.toLowerCase();
              return (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: isSelected ? '#1a2a3a' : '#141414',
                    border: `1px solid ${isSelected ? '#3b82f633' : '#1e1e1e'}`,
                    borderRadius: 10,
                    padding: '10px 14px',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? '#60a5fa' : '#9ca3af', minWidth: 80 }}>{m.name}</div>
                  <div style={{ flex: 1, background: '#222', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#10b981', borderRadius: 4, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e0e0e0', minWidth: 90, textAlign: 'right' }}>{formatCurrency(total)}</div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
