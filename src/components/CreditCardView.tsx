import React, { useState } from 'react';
import {
  type BillCategory,
  BILL_CATEGORY_LABELS,
  formatCurrency,
  formatMonthShort,
  parseBRL,
} from '../types';
import { type CreditCardPurchase, type MonthInfo } from '../store/useDashboard';
import { BillRow } from './BillRow';
import { type Bill } from '../types';

interface Props {
  selectedMonthName: string;
  selectedMonthYear: number;
  creditCardBills: Bill[];
  linkedFixedBills: Bill[];
  allMonths: { id: string; name: string; year: number; bills: Bill[] }[];
  onTogglePaid: (id: string) => void;
  onSaveBill: (bill: Bill) => void;
  onDeleteBill: (id: string) => void;
  onAddPurchase: (p: CreditCardPurchase) => void;
  getAffectedMonths: (cur: number, total: number) => MonthInfo[];
  onPayCreditCard: () => void;
  onUnpayCreditCard: () => void;
  hideValues?: boolean;
}

const fieldStyle: React.CSSProperties = {
  background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 6, color: '#e0e0e0', padding: '8px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'block',
};

export const CreditCardView: React.FC<Props> = ({
  selectedMonthName, selectedMonthYear, creditCardBills, linkedFixedBills, allMonths,
  onTogglePaid, onSaveBill, onDeleteBill, onAddPurchase, getAffectedMonths, onPayCreditCard, onUnpayCreditCard, hideValues,
}) => {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [category, setCategory] = useState<BillCategory>('compras');
  const [curInstallment, setCurInstallment] = useState('1');
  const [totalInstallment, setTotalInstallment] = useState('12');
  const [formOpen, setFormOpen] = useState(() => {
    try { const saved = localStorage.getItem('financa_sections_v1'); if (saved) { return JSON.parse(saved)['creditCardForm'] ?? false; } } catch { /* ignore */ }
    return false;
  });

  const toggleForm = () => {
    setFormOpen((prev: boolean) => {
      const next = !prev;
      try { const saved = localStorage.getItem('financa_sections_v1'); const s = saved ? JSON.parse(saved) : {}; s['creditCardForm'] = next; localStorage.setItem('financa_sections_v1', JSON.stringify(s)); } catch { /* ignore */ }
      return next;
    });
  };

  const cur = parseInt(curInstallment) || 1;
  const total = parseInt(totalInstallment) || 1;
  const affected = getAffectedMonths(Math.min(cur, total), Math.max(cur, total));

  const totalDebt = allMonths.reduce((sum, m) => sum + m.bills.filter((b) => b.type === 'parcela' && b.category !== 'financiamento' && !b.isPaid).reduce((s, b) => s + b.amount, 0), 0);
  const monthlyFromCard = creditCardBills.reduce((s, b) => s + b.amount, 0);
  const linkedTotal = linkedFixedBills.reduce((s, b) => s + b.amount, 0);
  const faturaTotal = monthlyFromCard + linkedTotal;
  const allCardPaid = creditCardBills.length > 0 && creditCardBills.every((b) => b.isPaid) && linkedFixedBills.every((b) => b.isPaid);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed || !amount) return;
    const c = Math.max(1, Math.min(cur, total));
    const t = Math.max(c, total);
    onAddPurchase({ name: trimmed, amount: parseBRL(amount), dueDay: Math.max(1, Math.min(31, parseInt(dueDay) || 10)), category, installmentCurrent: c, installmentTotal: t });
    setName(''); setAmount(''); setCurInstallment('1'); setTotalInstallment('12');
  };

  const masked = 'R$ ••••';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Fatura do mês — toggle simples */}
      {(creditCardBills.length > 0 || linkedFixedBills.length > 0) && (
        <div style={{ background: '#131313', border: `1px solid ${allCardPaid ? '#10b98122' : '#1e1e1e'}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, opacity: allCardPaid ? 0.55 : 1, transition: 'all 0.15s' }}>
          {/* Bolinha de pago */}
          <button
            onClick={allCardPaid ? onUnpayCreditCard : onPayCreditCard}
            style={{
              width: 20, height: 20, borderRadius: '50%',
              border: `2px solid ${allCardPaid ? '#10b981' : '#2d2d2d'}`,
              background: allCardPaid ? '#10b981' : 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, transition: 'all 0.15s', padding: 0,
            }}
          >
            {allCardPaid && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0, opacity: 0.8 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: allCardPaid ? '#555' : '#d4d4d4', textDecoration: allCardPaid ? 'line-through' : 'none' }}>Fatura do mês</span>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#444' }}>
                {creditCardBills.length} parcela{creditCardBills.length !== 1 ? 's' : ''}
                {linkedFixedBills.length > 0 && ` + ${linkedFixedBills.length} fixa${linkedFixedBills.length !== 1 ? 's' : ''}`}
              </span>
            </div>
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: hideValues ? '#1a1a1a' : (allCardPaid ? '#10b981' : '#d4d4d4'), flexShrink: 0, letterSpacing: '-0.01em', transition: 'color 0.2s' }}>
            {hideValues ? masked : formatCurrency(faturaTotal)}
          </span>
        </div>
      )}

      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: '#131313', border: '1px solid #1e1e1e', borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#ef4444', borderRadius: '12px 0 0 12px' }} />
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>Parcelas</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#e8e8e8', transition: 'color 0.2s' }}>{hideValues ? masked : formatCurrency(monthlyFromCard)}</div>
          <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 4 }}>{creditCardBills.length} parcela(s)</div>
        </div>
        <div style={{ background: '#131313', border: '1px solid #1e1e1e', borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#f59e0b', borderRadius: '12px 0 0 12px' }} />
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>Dívida total</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#e8e8e8', transition: 'color 0.2s' }}>{hideValues ? masked : formatCurrency(totalDebt)}</div>
          <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 4 }}>Parcelas em aberto</div>
        </div>
      </div>

      {/* Form */}
      <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }}>
        <button onClick={toggleForm} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', padding: '14px 18px', cursor: 'pointer', color: '#c0c0c0' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Lançar compra no cartão</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: formOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M2 4l4 4 4-4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {formOpen && (
          <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ height: 1, background: '#1a1a1a', marginBottom: 4 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={labelStyle}>Nome da compra</label><input style={fieldStyle} placeholder="Ex: Tênis Nike" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} /></div>
              <div><label style={labelStyle}>Categoria</label><select style={fieldStyle} value={category} onChange={(e) => setCategory(e.target.value as BillCategory)}>{(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((c) => (<option key={c} value={c}>{BILL_CATEGORY_LABELS[c]}</option>))}</select></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div><label style={labelStyle}>Valor da parcela</label><input style={fieldStyle} inputMode="decimal" pattern="[0-9.,]*" placeholder="211,00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} /></div>
              <div><label style={labelStyle}>Parcela atual</label><input style={fieldStyle} inputMode="numeric" pattern="[0-9]*" value={curInstallment} onChange={(e) => setCurInstallment(e.target.value.replace(/[^0-9]/g, ''))} /></div>
              <div><label style={labelStyle}>Total parcelas</label><input style={fieldStyle} inputMode="numeric" pattern="[0-9]*" value={totalInstallment} onChange={(e) => setTotalInstallment(e.target.value.replace(/[^0-9]/g, ''))} /></div>
            </div>
            <div style={{ maxWidth: 200 }}><label style={labelStyle}>Dia do vencimento</label><input style={fieldStyle} inputMode="numeric" pattern="[0-9]*" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/[^0-9]/g, ''))} /></div>

            {affected.length > 0 && (
              <div style={{ background: '#0a1a0a', border: '1px solid #152515', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: '#4ade80', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Lançamento em {affected.length} {affected.length === 1 ? 'mês' : 'meses'}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {affected.map((mi, i) => (
                    <span key={`${mi.name}-${mi.year}-${i}`} style={{ background: i === 0 ? '#16a34a15' : '#131313', border: `1px solid ${i === 0 ? '#16a34a33' : '#1e1e1e'}`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: i === 0 ? '#4ade80' : '#555', fontWeight: i === 0 ? 600 : 400 }}>
                      {formatMonthShort(mi.name, mi.year)}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#333', marginTop: 8 }}>Total comprometido: <strong style={{ color: '#777' }}>{formatCurrency(parseBRL(amount) * affected.length)}</strong></div>
              </div>
            )}

            <button onClick={handleAdd} disabled={!name.trim() || !amount} style={{ background: name.trim() && amount ? '#3b82f6' : '#151520', border: 'none', borderRadius: 6, color: name.trim() && amount ? '#fff' : '#3a4a5a', cursor: name.trim() && amount ? 'pointer' : 'not-allowed', padding: '10px 20px', fontSize: 13, fontWeight: 600, alignSelf: 'flex-start', transition: 'all 0.15s' }}>
              Lançar {affected.length > 1 ? `nos ${affected.length} meses` : 'no mês'}
            </button>
          </div>
        )}
      </div>

      {/* Parcelas do mês */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Parcelas em {selectedMonthName}</h3>
          <span style={{ fontSize: 10, color: '#444', background: '#151515', border: '1px solid #1e1e1e', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{creditCardBills.length}</span>
        </div>
        {creditCardBills.length === 0 ? (
          <div style={{ background: '#111', border: '1px dashed #1e1e1e', borderRadius: 10, padding: 24, textAlign: 'center', color: '#333', fontSize: 12 }}>Nenhuma parcela neste mês.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {creditCardBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} showPaidToggle={false} />))}
          </div>
        )}
      </div>

      {/* Contas fixas vinculadas ao cartão */}
      {linkedFixedBills.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Fixas vinculadas ao cartão</h3>
            <span style={{ fontSize: 10, color: '#60a5fa', background: '#111520', border: '1px solid #1e2a3e', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{linkedFixedBills.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {linkedFixedBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} showPaidToggle={false} />))}
          </div>
          <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 8, paddingLeft: 4 }}>Essas contas são pagas junto com a fatura do cartão.</div>
        </div>
      )}

      {/* Visão geral */}
      <div>
        <h3 style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Visão geral por mês</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {allMonths
            .filter((m) => m.bills.some((b) => b.type === 'parcela' && b.category !== 'financiamento'))
            .map((m) => {
              const totalAmt = m.bills.filter((b) => b.type === 'parcela' && b.category !== 'financiamento').reduce((s, b) => s + b.amount, 0);
              const paid = m.bills.filter((b) => b.type === 'parcela' && b.category !== 'financiamento' && b.isPaid).reduce((s, b) => s + b.amount, 0);
              const pct = totalAmt > 0 ? (paid / totalAmt) * 100 : 0;
              const isSelected = m.name.toLowerCase() === selectedMonthName.toLowerCase() && m.year === selectedMonthYear;
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: isSelected ? '#111520' : '#111', border: `1px solid ${isSelected ? '#1e2a3e' : '#1a1a1a'}`, borderRadius: 8, padding: '10px 14px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: isSelected ? '#60a5fa' : '#777', minWidth: 55 }}>{formatMonthShort(m.name, m.year)}</div>
                  <div style={{ flex: 1, background: '#1a1a1a', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#10b981', borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#c0c0c0', minWidth: 85, textAlign: 'right', transition: 'color 0.2s' }}>{hideValues ? 'R$ ••••' : formatCurrency(totalAmt)}</div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
