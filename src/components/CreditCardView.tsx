import React, { useEffect, useRef, useState } from 'react';
import {
  type BillCategory,
  type CreditCardInvoice,
  type ExpenseOwner,
  BILL_CATEGORY_LABELS,
  formatCurrency,
  formatMonthShort,
  parseBRL,
} from '../types';
import { type CreditCardPurchase, type MonthInfo } from '../store/useDashboard';
import { centsToAmount, getInvoiceChargeTotalCents, getInvoicePersonalTotalCents, getInvoiceThirdPartyTotalCents, getInvoiceUnclassifiedTotalCents, getInvoiceTotalCents, getOwnerLabel } from '../services/cardTransactions';
import { findDuplicateTransaction } from '../services/transactionDuplicates';
import { BillRow } from './BillRow';
import { StatementImportPanel } from './StatementImportPanel';
import { type Bill } from '../types';
import { CalendarReminderButton } from './CalendarReminderButton';

interface Props {
  userId: string | null;
  selectedMonthName: string;
  selectedMonthYear: number;
  creditCardBills: Bill[];
  creditCardInvoices: CreditCardInvoice[];
  debitPixBills: Bill[];
  linkedFixedBills: Bill[];
  allMonths: { id: string; name: string; year: number; bills: Bill[]; creditCardInvoices?: CreditCardInvoice[] }[];
  onTogglePaid: (id: string) => void;
  onSaveBill: (bill: Bill) => void;
  onDeleteBill: (id: string) => void;
  onAddPurchase: (p: CreditCardPurchase) => void;
  onImportInvoice: (invoice: CreditCardInvoice) => void;
  onUpdateInvoice: (invoice: CreditCardInvoice) => void;
  getAffectedMonths: (cur: number, total: number) => MonthInfo[];
  onPayCreditCard: () => void;
  onUnpayCreditCard: () => void;
  creditCardDueDay?: number;
  onUpdateCreditCardDueDay: (dueDay: number) => void;
  hideValues?: boolean;
  invoiceCalendarEventId?: string;
  onInvoiceCalendarReminder?: () => void;
  invoiceCalendarReminderLoading?: boolean;
}

const fieldStyle: React.CSSProperties = {
  background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 6, color: '#e0e0e0', padding: '8px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'block',
};

const ownerOptions: Array<{ value: ExpenseOwner; label: string }> = [
  { value: 'ME', label: 'Eu' },
  { value: 'THIRD_PARTY', label: 'Terceiro' },
  { value: 'SHARED', label: 'Compartilhado' },
  { value: 'UNCLASSIFIED', label: 'Não classificado' },
];

function InvoiceTransactions({ invoices, onUpdate, hideValues }: { invoices: CreditCardInvoice[]; onUpdate: (invoice: CreditCardInvoice) => void; hideValues?: boolean }) {
  const [filter, setFilter] = useState<'ALL' | ExpenseOwner>('ALL');
  const summaryRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const transactions = invoices.flatMap((invoice) => invoice.transactions).filter((transaction) => filter === 'ALL' || transaction.owner === filter);
  const updateTransaction = (id: string, patch: Partial<CreditCardInvoice['transactions'][number]>, remove = false) => {
    const invoice = invoices.find((item) => item.transactions.some((transaction) => transaction.id === id));
    if (!invoice) return;
    onUpdate({ ...invoice, transactions: remove
      ? invoice.transactions.filter((transaction) => transaction.id !== id)
      : invoice.transactions.map((transaction) => transaction.id === id ? { ...transaction, ...patch } : transaction) });
  };
  const totals = invoices.reduce((summary, invoice) => ({
    total: summary.total + getInvoiceTotalCents(invoice),
    personal: summary.personal + getInvoicePersonalTotalCents(invoice),
    thirdParty: summary.thirdParty + getInvoiceThirdPartyTotalCents(invoice),
    unclassified: summary.unclassified + getInvoiceUnclassifiedTotalCents(invoice),
  }), { total: 0, personal: 0, thirdParty: 0, unclassified: 0 });

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        ref={summaryRef}
        className="theme-invoice-summary"
        onPointerDown={(event) => {
          if (!summaryRef.current) return;
          dragRef.current = { active: true, startX: event.clientX, scrollLeft: summaryRef.current.scrollLeft };
          summaryRef.current.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!dragRef.current.active || !summaryRef.current) return;
          summaryRef.current.scrollLeft = dragRef.current.scrollLeft - (event.clientX - dragRef.current.startX);
        }}
        onPointerUp={(event) => {
          dragRef.current.active = false;
          summaryRef.current?.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { dragRef.current.active = false; }}
        style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, cursor: 'grab', touchAction: 'pan-x', userSelect: 'none' }}
      >
        {[
          ['Fatura', totals.total],
          ['Meu gasto', totals.personal],
          ['Terceiros', totals.thirdParty],
          ['Não classificados', totals.unclassified],
        ].map(([label, cents]) => (
          <div key={String(label)} style={{ minWidth: 126, flex: '0 0 126px', background: '#131313', border: '1px solid #1e1e1e', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div style={{ marginTop: 5, fontSize: 16, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#e8e8e8' }}>{hideValues ? 'R$ ••••' : formatCurrency(centsToAmount(Number(cents)))}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {([{ value: 'ALL', label: 'Todos' }, ...ownerOptions] as Array<{ value: 'ALL' | ExpenseOwner; label: string }>).map((option) => (
          <button key={option.value} type="button" onClick={() => setFilter(option.value)} style={{ background: filter === option.value ? '#1e2a3e' : '#151515', border: `1px solid ${filter === option.value ? '#3b82f6' : '#242424'}`, borderRadius: 5, color: filter === option.value ? '#93c5fd' : '#666', cursor: 'pointer', padding: '6px 9px', fontSize: 11 }}>{option.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {transactions.map((transaction) => (
          <div key={transaction.id} style={{ background: '#131313', border: `1px solid ${transaction.owner === 'UNCLASSIFIED' ? '#3a2a12' : '#1e1e1e'}`, borderRadius: 10, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13, color: '#d4d4d4' }}>{transaction.merchant}</strong>
                {transaction.installmentCurrent && transaction.installmentTotal && transaction.installmentTotal > 1 && <span style={{ fontSize: 10, color: '#777' }}>Parcela {transaction.installmentCurrent}/{transaction.installmentTotal}</span>}
                <span style={{ fontSize: 10, color: '#777' }}>{transaction.type}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
                <select value={transaction.owner} onChange={(event) => updateTransaction(transaction.id, { owner: event.target.value as ExpenseOwner, personalAmountCents: event.target.value === 'SHARED' ? transaction.personalAmountCents : undefined })} style={{ ...fieldStyle, width: 150, padding: '5px 8px', fontSize: 11 }}>
                  {ownerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {transaction.owner === 'THIRD_PARTY' && <input value={transaction.thirdPartyName ?? ''} onChange={(event) => updateTransaction(transaction.id, { thirdPartyName: event.target.value })} placeholder="Quem?" style={{ ...fieldStyle, width: 130, padding: '5px 8px', fontSize: 11 }} />}
                {transaction.owner === 'SHARED' && <input inputMode="decimal" value={transaction.personalAmountCents == null ? '' : (transaction.personalAmountCents / 100).toFixed(2).replace('.', ',')} onChange={(event) => updateTransaction(transaction.id, { personalAmountCents: Math.round(parseBRL(event.target.value) * 100) })} placeholder="Minha parte" style={{ ...fieldStyle, width: 110, padding: '5px 8px', fontSize: 11 }} />}
                <span style={{ fontSize: 10, color: transaction.owner === 'UNCLASSIFIED' ? '#f59e0b' : '#555' }}>{getOwnerLabel(transaction.owner)}</span>
              </div>
            </div>
            <strong style={{ fontSize: 14, color: transaction.type === 'REFUND' ? '#10b981' : '#d4d4d4', whiteSpace: 'nowrap' }}>{hideValues ? 'R$ ••••' : formatCurrency(centsToAmount(transaction.amountCents))}</strong>
            <button
              type="button"
              title="Remover lançamento"
              aria-label={`Remover lançamento ${transaction.merchant}`}
              onClick={() => {
                if (window.confirm(`Remover ${transaction.merchant} da fatura?`)) {
                  updateTransaction(transaction.id, {}, true);
                }
              }}
              style={{ background: 'transparent', border: '1px solid #2a1a1a', borderRadius: 6, color: '#a55', cursor: 'pointer', width: 28, height: 28, fontSize: 16, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export const CreditCardView: React.FC<Props> = ({
  userId, selectedMonthName, selectedMonthYear, creditCardBills, creditCardInvoices, debitPixBills, linkedFixedBills, allMonths,
  onTogglePaid, onSaveBill, onDeleteBill, onAddPurchase, onImportInvoice, onUpdateInvoice, getAffectedMonths, onPayCreditCard, onUnpayCreditCard, creditCardDueDay, onUpdateCreditCardDueDay, hideValues,
  invoiceCalendarEventId, onInvoiceCalendarReminder, invoiceCalendarReminderLoading,
}) => {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<BillCategory>('compras');
  const [paymentMethod, setPaymentMethod] = useState<'credito' | 'debito_pix'>('credito');
  const [owner, setOwner] = useState<ExpenseOwner>('ME');
  const [personalAmount, setPersonalAmount] = useState('');
  const [thirdPartyName, setThirdPartyName] = useState('');
  const [curInstallment, setCurInstallment] = useState('1');
  const [totalInstallment, setTotalInstallment] = useState('1');
  const [invoiceDueDayInput, setInvoiceDueDayInput] = useState(String(creditCardDueDay ?? ''));
  const [invoiceDueDayEditing, setInvoiceDueDayEditing] = useState(false);
  const [formOpen, setFormOpen] = useState(() => {
    try { const saved = localStorage.getItem('financa_sections_v1'); if (saved) { return JSON.parse(saved)['creditCardForm'] ?? false; } } catch { /* ignore */ }
    return false;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setInvoiceDueDayInput(String(creditCardDueDay ?? '')), 0);
    return () => window.clearTimeout(timer);
  }, [creditCardDueDay]);

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
  const manualDuplicate = name.trim() && amount
    ? findDuplicateTransaction({
      amountCents: Math.round(parseBRL(amount) * 100),
      type: total > 1 ? 'INSTALLMENT' : 'PURCHASE',
      installmentCurrent: paymentMethod === 'debito_pix' ? 1 : cur,
      installmentTotal: paymentMethod === 'debito_pix' ? 1 : total,
    }, creditCardInvoices.flatMap((invoice) => invoice.transactions))
    : undefined;

  const totalDebt = allMonths.reduce((sum, m) => sum
    + m.bills.filter((b) => b.type === 'parcela' && b.category !== 'financiamento' && !b.isPaid).reduce((s, b) => s + b.amount, 0)
    + (m.creditCardInvoices ?? []).filter((invoice) => !invoice.isPaid).reduce((s, invoice) => s + centsToAmount(getInvoiceChargeTotalCents(invoice)), 0), 0);
  const importedMonthlyTotal = creditCardInvoices.reduce((sum, invoice) => sum + centsToAmount(getInvoiceChargeTotalCents(invoice)), 0);
  const monthlyFromCard = creditCardBills.reduce((s, b) => s + b.amount, 0) + importedMonthlyTotal;
  const linkedTotal = linkedFixedBills.reduce((s, b) => s + b.amount, 0);
  const importedInvoiceTotal = creditCardInvoices.reduce((total, invoice) => total + centsToAmount(getInvoiceTotalCents(invoice)), 0);
  const faturaTotal = monthlyFromCard + linkedTotal + importedInvoiceTotal;
  const hasCardItems = creditCardBills.length > 0 || linkedFixedBills.length > 0 || creditCardInvoices.length > 0;
  const allCardPaid = hasCardItems
    && creditCardBills.every((b) => b.isPaid)
    && linkedFixedBills.every((b) => b.isPaid)
    && creditCardInvoices.every((invoice) => invoice.isPaid);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed || !amount) return;
    const c = Math.max(1, Math.min(cur, total));
    const t = Math.max(c, total);
    const amountCents = Math.round(parseBRL(amount) * 100);
    onAddPurchase({ name: trimmed, amount: parseBRL(amount), category, installmentCurrent: paymentMethod === 'debito_pix' ? 1 : c, installmentTotal: paymentMethod === 'debito_pix' ? 1 : t, paymentMethod, owner: paymentMethod === 'debito_pix' ? 'ME' : owner, personalAmountCents: owner === 'SHARED' ? Math.min(amountCents, Math.max(0, Math.round(parseBRL(personalAmount) * 100))) : undefined, thirdPartyName: owner === 'THIRD_PARTY' ? thirdPartyName.trim() || undefined : undefined });
    setName(''); setAmount(''); setCurInstallment('1'); setTotalInstallment('1'); setPaymentMethod('credito'); setOwner('ME'); setPersonalAmount(''); setThirdPartyName('');
  };

  const masked = 'R$ ••••';

  return (
    <div className="theme-card-view" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
          {onInvoiceCalendarReminder && !allCardPaid && (
            <CalendarReminderButton added={Boolean(invoiceCalendarEventId)} loading={invoiceCalendarReminderLoading} onClick={onInvoiceCalendarReminder} />
          )}
        </div>
      )}

      <div className="theme-card-due-setting">
        <div>
          <strong>Vencimento da fatura</strong>
          <span>{creditCardDueDay ? `Todo dia ${creditCardDueDay} · replicado para o próximo mês` : 'Defina o dia em que a fatura será paga'}</span>
        </div>
        {invoiceDueDayEditing ? (
          <div className="theme-card-due-form">
            <input autoFocus inputMode="numeric" value={invoiceDueDayInput} onChange={(event) => setInvoiceDueDayInput(event.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(event) => { if (event.key === 'Enter') { const value = Number(invoiceDueDayInput); if (value >= 1 && value <= 31) { onUpdateCreditCardDueDay(value); setInvoiceDueDayEditing(false); } } if (event.key === 'Escape') setInvoiceDueDayEditing(false); }} placeholder="Dia" aria-label="Dia de vencimento da fatura" />
            <button type="button" onClick={() => { const value = Number(invoiceDueDayInput); if (value >= 1 && value <= 31) { onUpdateCreditCardDueDay(value); setInvoiceDueDayEditing(false); } }}>Salvar</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setInvoiceDueDayInput(String(creditCardDueDay ?? '')); setInvoiceDueDayEditing(true); }}>{creditCardDueDay ? 'Editar vencimento' : 'Adicionar vencimento'}</button>
        )}
      </div>

      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: '#131313', border: '1px solid #1e1e1e', borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#ef4444', borderRadius: '12px 0 0 12px' }} />
          <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>Parcelas</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#e8e8e8', transition: 'color 0.2s' }}>{hideValues ? masked : formatCurrency(monthlyFromCard)}</div>
          <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 4 }}>{creditCardBills.length + creditCardInvoices.flatMap((invoice) => invoice.transactions).filter((transaction) => transaction.type !== 'PAYMENT').length} lançamento(s)</div>
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
            <div><label style={labelStyle}>Forma de pagamento</label><select style={fieldStyle} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'credito' | 'debito_pix')}><option value="credito">Cartão de crédito</option><option value="debito_pix">Débito/Pix</option></select></div>
            {paymentMethod === 'credito' && (
              <>
                <div><label style={labelStyle}>Responsabilidade</label><select style={fieldStyle} value={owner} onChange={(e) => setOwner(e.target.value as ExpenseOwner)}><option value="ME">Eu</option><option value="THIRD_PARTY">Terceiro</option><option value="SHARED">Compartilhado</option><option value="UNCLASSIFIED">Não classificado</option></select></div>
                {owner === 'THIRD_PARTY' && <div><label style={labelStyle}>Terceiro (opcional)</label><input style={fieldStyle} placeholder="Nome da pessoa" value={thirdPartyName} onChange={(e) => setThirdPartyName(e.target.value)} /></div>}
                {owner === 'SHARED' && <div><label style={labelStyle}>Minha parte</label><input style={fieldStyle} inputMode="decimal" placeholder="0,00" value={personalAmount} onChange={(e) => setPersonalAmount(e.target.value.replace(/[^0-9.,]/g, ''))} /></div>}
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, opacity: paymentMethod === 'debito_pix' ? 0.45 : 1 }}>
              <div><label style={labelStyle}>Valor da parcela</label><input style={fieldStyle} inputMode="decimal" pattern="[0-9.,]*" placeholder="211,00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} /></div>
              <div><label style={labelStyle}>Parcela atual</label><input disabled={paymentMethod === 'debito_pix'} style={fieldStyle} inputMode="numeric" pattern="[0-9]*" value={paymentMethod === 'debito_pix' ? '1' : curInstallment} onChange={(e) => setCurInstallment(e.target.value.replace(/[^0-9]/g, ''))} /></div>
              <div><label style={labelStyle}>Total parcelas</label><input disabled={paymentMethod === 'debito_pix'} style={fieldStyle} inputMode="numeric" pattern="[0-9]*" value={paymentMethod === 'debito_pix' ? '1' : totalInstallment} onChange={(e) => setTotalInstallment(e.target.value.replace(/[^0-9]/g, ''))} /></div>
            </div>
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

            {manualDuplicate && (
              <div style={{ background: '#241a0b', border: '1px solid #5a3b12', borderRadius: 6, padding: '8px 10px', color: '#f59e0b', fontSize: 11 }}>
                Possível duplicado: já existe um lançamento com o mesmo valor, tipo e parcela. Confirme antes de salvar.
              </div>
            )}

            <button onClick={handleAdd} disabled={!name.trim() || !amount} style={{ background: name.trim() && amount ? '#3b82f6' : '#151520', border: 'none', borderRadius: 6, color: name.trim() && amount ? '#fff' : '#3a4a5a', cursor: name.trim() && amount ? 'pointer' : 'not-allowed', padding: '10px 20px', fontSize: 13, fontWeight: 600, alignSelf: 'flex-start', transition: 'all 0.15s' }}>
              Lançar {affected.length > 1 ? `nos ${affected.length} meses` : 'no mês'}
            </button>
          </div>
        )}
      </div>

      {/* Importar da fatura */}
      <StatementImportPanel userId={userId} month={selectedMonthName} year={selectedMonthYear} existingTransactions={creditCardInvoices.flatMap((invoice) => invoice.transactions)} onImport={onImportInvoice} />

      {creditCardInvoices.length > 0 && <InvoiceTransactions invoices={creditCardInvoices} onUpdate={onUpdateInvoice} hideValues={hideValues} />}

      {/* Parcelas do mês */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Parcelas em {selectedMonthName}</h3>
          <span className="theme-card-count" style={{ fontSize: 10, color: '#444', background: '#151515', border: '1px solid #1e1e1e', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{creditCardBills.length}</span>
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
            <span className="theme-card-count" style={{ fontSize: 10, color: '#60a5fa', background: '#111520', border: '1px solid #1e2a3e', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{linkedFixedBills.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {linkedFixedBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} showPaidToggle={false} />))}
          </div>
          <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 8, paddingLeft: 4 }}>Essas contas são pagas junto com a fatura do cartão.</div>
        </div>
      )}

      {debitPixBills.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Compras no débito/Pix</h3>
            <span style={{ fontSize: 10, color: '#f59e0b', background: '#1a150a', border: '1px solid #2a2010', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{debitPixBills.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {debitPixBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} showPaidToggle={false} />))}
          </div>
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
                <div key={m.id} className={isSelected ? 'theme-month-overview theme-month-overview-active' : 'theme-month-overview'} style={{ display: 'flex', alignItems: 'center', gap: 12, background: isSelected ? '#111520' : '#111', border: `1px solid ${isSelected ? '#1e2a3e' : '#1a1a1a'}`, borderRadius: 8, padding: '10px 14px' }}>
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
