import React, { useEffect, useRef, useState } from 'react';
import {
  type BillCategory,
  type CreditCardInvoice,
  type CreditCardTransaction,
  type ExpenseOwner,
  BILL_CATEGORY_COLORS,
  BILL_CATEGORY_LABELS,
  getMonthIndex,
} from '../types';
import { type CreditCardPurchase, type MonthInfo } from '../store/useDashboard';
import { amountToCents, centsToAmount, getCardCharges, getInvoiceTotalCents, getOwnerLabel, getThirdPartyTotalsCents, getTransactionDay, setTransactionDay } from '../services/cardTransactions';
import { findDuplicateTransaction } from '../services/transactionDuplicates';
import { BillRow } from './BillRow';
import { ConfirmDialog } from './ConfirmDialog';
import { StatementImportPanel } from './StatementImportPanel';
import { type Bill } from '../types';
import { CalendarReminderButton } from './CalendarReminderButton';
import { usePreferences } from '../i18n';

interface Props {
  userId: string | null;
  selectedMonthName: string;
  selectedMonthYear: number;
  creditCardInvoices: CreditCardInvoice[];
  debitPixBills: Bill[];
  linkedFixedBills: Bill[];
  monthBills: Bill[];
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
  fontSize: 10, color: '#8f8f8f', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'block',
};

/** 'person:Marcos' filtra uma pessoa nomeada; os demais valores são o dono do lançamento. */
type OwnerFilter = 'ALL' | ExpenseOwner | `person:${string}`;

interface OwnerChip {
  value: OwnerFilter;
  label: string;
  cents: number;
}

const getOwnerOptions = (t: (key: string) => string): Array<{ value: ExpenseOwner; label: string }> => [
  { value: 'ME', label: t('me') },
  { value: 'THIRD_PARTY', label: t('thirdParty') },
  { value: 'SHARED', label: t('shared') },
  { value: 'UNCLASSIFIED', label: t('unclassified') },
];

function InvoiceTransactions({ invoices, monthBills, onUpdate, onTogglePaid, onSaveBill, onDeleteBill, hideValues }: { invoices: CreditCardInvoice[]; monthBills: Bill[]; onUpdate: (invoice: CreditCardInvoice) => void; onTogglePaid: (id: string) => void; onSaveBill: (bill: Bill) => void; onDeleteBill: (id: string) => void; hideValues?: boolean }) {
  const { formatMoney, parseAmount, typeLabel, categoryLabel, t } = usePreferences();
  const ownerOptions = getOwnerOptions(t);
  const [filter, setFilter] = useState<OwnerFilter>('ALL');
  const [pendingRemoval, setPendingRemoval] = useState<CreditCardTransaction | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const allTransactions = invoices.flatMap((invoice) => invoice.transactions);
  const charges = getCardCharges(invoices, monthBills);
  // O "Eu" traz o compartilhado junto: a parte pessoal dele também é minha.
  const matchesFilter = (transaction: CreditCardTransaction) => {
    if (filter === 'ALL') return true;
    if (filter === 'ME') return transaction.owner === 'ME' || transaction.owner === 'SHARED';
    if (filter.startsWith('person:')) {
      const person = filter.slice('person:'.length);
      const named = transaction.thirdPartyName?.trim().toLowerCase() === person.toLowerCase();
      // O chip da pessoa mostra também a parte dela numa compra compartilhada.
      return named && (transaction.owner === 'THIRD_PARTY' || transaction.owner === 'SHARED');
    }
    return transaction.owner === filter;
  };
  const transactions = allTransactions.filter(matchesFilter);
  const updateTransaction = (id: string, patch: Partial<CreditCardInvoice['transactions'][number]>, remove = false) => {
    const invoice = invoices.find((item) => item.transactions.some((transaction) => transaction.id === id));
    if (!invoice) return;
    onUpdate({ ...invoice, transactions: remove
      ? invoice.transactions.filter((transaction) => transaction.id !== id)
      : invoice.transactions.map((transaction) => transaction.id === id ? { ...transaction, ...patch } : transaction) });
  };
  // Sem mês na data importada, o mês da própria fatura é o do lançamento.
  const invoiceMonthIndex = (id: string) => {
    const invoice = invoices.find((item) => item.transactions.some((transaction) => transaction.id === id));
    const index = getMonthIndex(invoice?.month ?? '');
    return index >= 0 ? index : new Date().getMonth();
  };
  // Só as parcelas lançadas na mão que ainda não vieram na fatura; a fixa vinculada tem seção própria abaixo.
  const visibleCreditCardBills = filter === 'ALL' || filter === 'ME'
    ? charges.pendingBills.filter((bill) => bill.type === 'parcela')
    : [];
  // Um chip por pessoa nomeada; os que não têm valor no mês somem para não ocupar espaço.
  const ownerChips: OwnerChip[] = [
    { value: 'ME', label: t('me'), cents: charges.personalCents },
    { value: 'THIRD_PARTY', label: t('thirdParty'), cents: charges.thirdPartyCents },
    ...getThirdPartyTotalsCents(allTransactions).map((group): OwnerChip => ({
      value: `person:${group.name}`, label: group.name, cents: group.cents,
    })),
    { value: 'SHARED', label: t('shared'), cents: charges.sharedCents },
    { value: 'UNCLASSIFIED', label: t('unclassified'), cents: charges.unclassifiedCents },
    { value: 'ALL', label: t('all'), cents: charges.totalCents },
  ];
  const chips = ownerChips.filter((chip) => chip.value === 'ME' || chip.value === 'ALL' || chip.cents !== 0);

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
          [t('mySpending'), charges.personalCents],
          [t('invoice'), charges.totalCents],
          [t('thirdParty'), charges.thirdPartyCents],
          [t('unclassified'), charges.unclassifiedCents],
        ].map(([label, cents], index) => (
          <div key={String(label)} className="cc-summary-tile" style={{ minWidth: index === 0 ? 152 : 126, flex: `0 0 ${index === 0 ? 152 : 126}px`, background: '#131313', border: index === 0 ? '1px solid #23324a' : '1px solid #1e1e1e', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: index === 0 ? '#93c5fd' : '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div className="privacy-mask" style={{ marginTop: 5, fontSize: index === 0 ? 18 : 16, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#e8e8e8' }}>{hideValues ? '••••' : formatMoney(centsToAmount(Number(cents)))}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, touchAction: 'pan-x' }}>
        {chips.map((chip) => {
          const active = filter === chip.value;
          return (
            <button key={chip.value} type="button" aria-pressed={active} onClick={() => setFilter(chip.value)} className={active ? 'cc-filter-btn is-active' : 'cc-filter-btn'} style={{ flexShrink: 0, whiteSpace: 'nowrap', background: active ? '#1e2a3e' : '#151515', border: `1px solid ${active ? '#3b82f6' : '#242424'}`, borderRadius: 5, color: active ? '#93c5fd' : '#9a9a9a', cursor: 'pointer', padding: '6px 9px', fontSize: 11 }}>
              {chip.label}
              <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.82, fontVariantNumeric: 'tabular-nums' }}>{hideValues ? '••••' : formatMoney(centsToAmount(chip.cents))}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -6 }}>
        <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('invoiceItems')}</h3>
        <span className="theme-card-count" style={{ fontSize: 10, color: '#8b8b8b', background: '#151515', border: '1px solid #1e1e1e', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{transactions.length + visibleCreditCardBills.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {transactions.map((transaction) => (
          <div key={transaction.id} className="cc-transaction-row" style={{ background: '#131313', border: `1px solid ${transaction.owner === 'UNCLASSIFIED' ? '#3a2a12' : '#1e1e1e'}`, borderRadius: 10, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong className="cc-merchant" style={{ fontSize: 13, color: '#d4d4d4' }}>{transaction.merchant}</strong>
                {transaction.installmentCurrent && transaction.installmentTotal && transaction.installmentTotal > 1 && <span style={{ fontSize: 10, color: '#9a9a9a' }}>{typeLabel('parcela')} {transaction.installmentCurrent}/{transaction.installmentTotal}</span>}
                <span style={{ fontSize: 10, color: '#9a9a9a' }}>{transaction.type}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('dayPlaceholder')}</span>
                  <input inputMode="numeric" pattern="[0-9]*" aria-label={`${t('transactionDayAria')} — ${transaction.merchant}`} placeholder="--" value={getTransactionDay(transaction.date) ?? ''} onChange={(event) => updateTransaction(transaction.id, { date: setTransactionDay(transaction.date, parseInt(event.target.value) || undefined, invoiceMonthIndex(transaction.id)) })} style={{ ...fieldStyle, width: 42, padding: '5px 6px', fontSize: 11, textAlign: 'center' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span aria-hidden style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: transaction.category ? BILL_CATEGORY_COLORS[transaction.category] : '#3f3f3f' }} />
                  <select value={transaction.category ?? ''} aria-label={t('categoryAria')} onChange={(event) => updateTransaction(transaction.id, { category: (event.target.value || undefined) as BillCategory | undefined })} style={{ ...fieldStyle, width: 138, padding: '5px 8px', fontSize: 11 }}>
                    <option value="">{t('noCategory')}</option>
                    {(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((key) => <option key={key} value={key}>{categoryLabel(key)}</option>)}
                  </select>
                </div>
                <select value={transaction.owner} onChange={(event) => updateTransaction(transaction.id, { owner: event.target.value as ExpenseOwner, personalAmountCents: event.target.value === 'SHARED' ? transaction.personalAmountCents : undefined })} style={{ ...fieldStyle, width: 150, padding: '5px 8px', fontSize: 11 }}>
                  {ownerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                {transaction.owner === 'THIRD_PARTY' && <input value={transaction.thirdPartyName ?? ''} onChange={(event) => updateTransaction(transaction.id, { thirdPartyName: event.target.value })} placeholder={t('who')} style={{ ...fieldStyle, width: 130, padding: '5px 8px', fontSize: 11 }} />}
                {transaction.owner === 'SHARED' && <input inputMode="decimal" value={transaction.personalAmountCents == null ? '' : (transaction.personalAmountCents / 100).toFixed(2).replace('.', ',')} onChange={(event) => { const typed = event.target.value.trim(); updateTransaction(transaction.id, { personalAmountCents: typed ? Math.min(transaction.amountCents, Math.max(0, Math.round(parseAmount(typed) * 100))) : 0 }); }} placeholder={t('myShare')} style={{ ...fieldStyle, width: 110, padding: '5px 8px', fontSize: 11 }} />}
                {transaction.owner === 'SHARED' && <input value={transaction.thirdPartyName ?? ''} aria-label={t('whoPaysRest')} onChange={(event) => updateTransaction(transaction.id, { thirdPartyName: event.target.value })} placeholder={t('whoPaysRest')} style={{ ...fieldStyle, width: 130, padding: '5px 8px', fontSize: 11 }} />}
                <span className={transaction.owner === 'UNCLASSIFIED' ? 'cc-owner-badge is-warning' : 'cc-owner-badge'} style={{ fontSize: 10, color: transaction.owner === 'UNCLASSIFIED' ? '#f59e0b' : '#9a9a9a' }}>{getOwnerLabel(transaction.owner)}</span>
              </div>
            </div>
            <strong className={transaction.type === 'REFUND' ? 'cc-amount-refund' : 'cc-amount'} style={{ fontSize: 14, color: transaction.type === 'REFUND' ? '#10b981' : '#d4d4d4', whiteSpace: 'nowrap' }}>{hideValues ? '••••' : formatMoney(centsToAmount(transaction.amountCents))}</strong>
            <button
              type="button"
              title={t('removeTransaction')}
              aria-label={`${t('removeTransaction')} ${transaction.merchant}`}
              onClick={() => setPendingRemoval(transaction)}
              className="cc-transaction-remove"
              style={{ background: 'transparent', border: '1px solid #2a1a1a', borderRadius: 6, color: '#e57373', cursor: 'pointer', width: 36, height: 36, fontSize: 18, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        ))}
        {visibleCreditCardBills.map((bill) => (
          <BillRow key={`legacy-card-bill-${bill.id}`} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} showPaidToggle={false} />
        ))}
      </div>
      <ConfirmDialog
        open={pendingRemoval !== null}
        title={t('removeTransaction')}
        message={t('removeFromInvoice', { merchant: pendingRemoval?.merchant ?? '' })}
        confirmLabel={t('deleteBill')}
        cancelLabel={t('cancel')}
        tone="danger"
        onClose={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) updateTransaction(pendingRemoval.id, {}, true);
          setPendingRemoval(null);
        }}
      />
    </section>
  );
}

export const CreditCardView: React.FC<Props> = ({
  userId, selectedMonthName, selectedMonthYear, creditCardInvoices, debitPixBills, linkedFixedBills, monthBills, allMonths,
  onTogglePaid, onSaveBill, onDeleteBill, onAddPurchase, onImportInvoice, onUpdateInvoice, getAffectedMonths, onPayCreditCard, onUnpayCreditCard, creditCardDueDay, onUpdateCreditCardDueDay, hideValues,
  invoiceCalendarEventId, onInvoiceCalendarReminder, invoiceCalendarReminderLoading,
}) => {
  const { formatMoney, formatMonthShort, parseAmount, categoryLabel, t } = usePreferences();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<BillCategory>('compras');
  const [paymentMethod, setPaymentMethod] = useState<'credito' | 'debito_pix'>('credito');
  const [owner, setOwner] = useState<ExpenseOwner>('ME');
  const [personalAmount, setPersonalAmount] = useState('');
  const [thirdPartyName, setThirdPartyName] = useState('');
  const [purchaseDay, setPurchaseDay] = useState(() => {
    const today = new Date();
    const isCurrentMonth = selectedMonthYear === today.getFullYear() && getMonthIndex(selectedMonthName) === today.getMonth();
    return isCurrentMonth ? String(today.getDate()) : '';
  });
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
      amountCents: Math.round(parseAmount(amount) * 100),
      type: total > 1 ? 'INSTALLMENT' : 'PURCHASE',
      installmentCurrent: paymentMethod === 'debito_pix' ? 1 : cur,
      installmentTotal: paymentMethod === 'debito_pix' ? 1 : total,
    }, creditCardInvoices.flatMap((invoice) => invoice.transactions))
    : undefined;

  const charges = getCardCharges(creditCardInvoices, monthBills);
  const pendingInstallments = charges.pendingBills.filter((bill) => bill.type === 'parcela');
  const pendingFixedCount = charges.pendingBills.length - pendingInstallments.length;
  // Tudo que cai no cartão é a fatura do mês: as contas fixas vinculadas entram aqui também.
  const faturaTotal = centsToAmount(charges.totalCents);
  const monthlyLaunchmentCount = charges.pendingBills.length
    + creditCardInvoices.reduce((sum, invoice) => sum + invoice.transactions.filter((transaction) => transaction.type !== 'PAYMENT').length, 0);
  const totalDebt = centsToAmount(allMonths.reduce((sum, m) => {
    const monthCharges = getCardCharges(m.creditCardInvoices ?? [], m.bills);
    return sum
      + monthCharges.pendingBills.filter((bill) => !bill.isPaid)
        .reduce((s, bill) => s + amountToCents(bill.amount), 0)
      + (m.creditCardInvoices ?? []).filter((invoice) => !invoice.isPaid)
        .reduce((s, invoice) => s + getInvoiceTotalCents(invoice), 0);
  }, 0));
  const hasCardItems = charges.pendingBills.length > 0 || creditCardInvoices.length > 0;
  const allCardPaid = hasCardItems
    && charges.pendingBills.every((bill) => bill.isPaid)
    && creditCardInvoices.every((invoice) => invoice.isPaid);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed || !amount) return;
    const c = Math.max(1, Math.min(cur, total));
    const t = Math.max(c, total);
    const parsedAmount = parseAmount(amount);
    const amountCents = Math.round(parsedAmount * 100);
    onAddPurchase({ name: trimmed, amount: parsedAmount, category, dueDay: parseInt(purchaseDay) || undefined, installmentCurrent: paymentMethod === 'debito_pix' ? 1 : c, installmentTotal: paymentMethod === 'debito_pix' ? 1 : t, paymentMethod, owner: paymentMethod === 'debito_pix' ? 'ME' : owner, personalAmountCents: owner === 'SHARED' ? Math.min(amountCents, Math.max(0, Math.round(parseAmount(personalAmount) * 100))) : undefined, thirdPartyName: owner === 'THIRD_PARTY' || owner === 'SHARED' ? thirdPartyName.trim() || undefined : undefined });
    setName(''); setAmount(''); setCurInstallment('1'); setTotalInstallment('1'); setPaymentMethod('credito'); setOwner('ME'); setPersonalAmount(''); setThirdPartyName('');
  };

  const masked = '••••';

  return (
    <div className="theme-card-view" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Fatura do mês — toggle simples */}
      {hasCardItems && (
        <div style={{ background: '#131313', border: `1px solid ${allCardPaid ? '#10b98122' : '#1e1e1e'}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, opacity: allCardPaid ? 0.55 : 1, transition: 'all 0.15s' }}>
          {/* Bolinha de pago */}
          <button type="button"
            role="checkbox"
            aria-checked={allCardPaid}
            aria-label={allCardPaid ? t('markAsUnpaid') : t('markAsPaid')}
            title={allCardPaid ? t('markAsUnpaid') : t('markAsPaid')}
            onClick={allCardPaid ? onUnpayCreditCard : onPayCreditCard}
            style={{
              width: 44, height: 44, margin: -12, borderRadius: '50%',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, padding: 0,
            }}
          >
            <span style={{
              width: 20, height: 20, borderRadius: '50%',
              border: `2px solid ${allCardPaid ? '#10b981' : '#2d2d2d'}`,
              background: allCardPaid ? '#10b981' : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}>
            {allCardPaid && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            </span>
          </button>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0, opacity: 0.8 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="cc-merchant" style={{ fontSize: 13, fontWeight: 600, color: allCardPaid ? '#8f8f8f' : '#d4d4d4', textDecoration: allCardPaid ? 'line-through' : 'none' }}>{t('monthlyInvoice')}</span>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#8b8b8b' }}>
                {pendingInstallments.length} {pendingInstallments.length !== 1 ? t('installmentPlural') : t('installmentSingular')}
                {pendingFixedCount > 0 && ` + ${pendingFixedCount} ${pendingFixedCount !== 1 ? t('fixedPlural') : t('fixedSingular')}`}
              </span>
            </div>
          </div>
          <span className="privacy-mask" style={{ fontSize: 14, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : (allCardPaid ? '#10b981' : '#d4d4d4'), flexShrink: 0, letterSpacing: '-0.01em', transition: 'color 0.2s' }}>
            {hideValues ? masked : formatMoney(faturaTotal)}
          </span>
          {onInvoiceCalendarReminder && !allCardPaid && (
            <CalendarReminderButton added={Boolean(invoiceCalendarEventId)} loading={invoiceCalendarReminderLoading} onClick={onInvoiceCalendarReminder} />
          )}
        </div>
      )}

      <div className="theme-card-due-setting">
        <div>
          <strong>{t('invoiceDueDate')}</strong>
          <span>{creditCardDueDay ? t('invoiceDueEveryDay', { day: creditCardDueDay }) : t('setInvoiceDueDayHint')}</span>
        </div>
        {invoiceDueDayEditing ? (
          <div className="theme-card-due-form">
            <input autoFocus inputMode="numeric" value={invoiceDueDayInput} onChange={(event) => setInvoiceDueDayInput(event.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(event) => { if (event.key === 'Enter') { const value = Number(invoiceDueDayInput); if (value >= 1 && value <= 31) { onUpdateCreditCardDueDay(value); setInvoiceDueDayEditing(false); } } if (event.key === 'Escape') setInvoiceDueDayEditing(false); }} placeholder={t('dayPlaceholder')} aria-label={t('invoiceDueDayAria')} />
            <button type="button" onClick={() => { const value = Number(invoiceDueDayInput); if (value >= 1 && value <= 31) { onUpdateCreditCardDueDay(value); setInvoiceDueDayEditing(false); } }}>{t('save')}</button>
          </div>
        ) : (
          <button type="button" onClick={() => { setInvoiceDueDayInput(String(creditCardDueDay ?? '')); setInvoiceDueDayEditing(true); }}>{creditCardDueDay ? t('editDueDate') : t('addDueDate')}</button>
        )}
      </div>

      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ background: '#131313', border: '1px solid #1e1e1e', borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#ef4444', borderRadius: '12px 0 0 12px' }} />
          <div style={{ fontSize: 10, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>{t('installments')}</div>
          <div className="privacy-mask" style={{ fontSize: 20, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#e8e8e8', transition: 'color 0.2s' }}>{hideValues ? masked : formatMoney(faturaTotal)}</div>
          <div className="theme-muted-text" style={{ fontSize: 11, marginTop: 4 }}>{monthlyLaunchmentCount} lançamento(s)</div>
        </div>
        <div style={{ background: '#131313', border: '1px solid #1e1e1e', borderRadius: 12, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#f59e0b', borderRadius: '12px 0 0 12px' }} />
          <div style={{ fontSize: 10, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 6 }}>{t('totalDebt')}</div>
          <div className="privacy-mask" style={{ fontSize: 20, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#e8e8e8', transition: 'color 0.2s' }}>{hideValues ? masked : formatMoney(totalDebt)}</div>
          <div className="theme-muted-text" style={{ fontSize: 11, marginTop: 4 }}>{t('openInstallments')}</div>
        </div>
      </div>

      {/* Form */}
      <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }}>
        <button type="button" onClick={toggleForm} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', padding: '14px 18px', cursor: 'pointer', color: '#c0c0c0' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('addCardPurchase')}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: formOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <path d="M2 4l4 4 4-4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {formOpen && (
          <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ height: 1, background: '#1a1a1a', marginBottom: 4 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={labelStyle}>{t('purchaseName')}</label><input style={fieldStyle} placeholder={t('purchaseNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} /></div>
              <div><label style={labelStyle}>{t('category')}</label><select style={fieldStyle} value={category} onChange={(e) => setCategory(e.target.value as BillCategory)}>{(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((c) => (<option key={c} value={c}>{categoryLabel(c)}</option>))}</select></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 104px', gap: 12 }}>
              <div><label style={labelStyle}>{t('paymentMethod')}</label><select style={fieldStyle} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'credito' | 'debito_pix')}><option value="credito">{t('creditCard')}</option><option value="debito_pix">{t('debitPix')}</option></select></div>
              <div><label style={labelStyle}>{t('purchaseDay')}</label><input style={fieldStyle} inputMode="numeric" pattern="[0-9]*" aria-label={t('transactionDayAria')} placeholder="--" maxLength={2} value={purchaseDay} onChange={(e) => setPurchaseDay(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} /></div>
            </div>
            {paymentMethod === 'credito' && (
              <>
                <div><label style={labelStyle}>{t('responsibility')}</label><select style={fieldStyle} value={owner} onChange={(e) => setOwner(e.target.value as ExpenseOwner)}><option value="ME">{t('me')}</option><option value="THIRD_PARTY">{t('thirdParty')}</option><option value="SHARED">{t('shared')}</option><option value="UNCLASSIFIED">{t('unclassified')}</option></select></div>
                {owner === 'THIRD_PARTY' && <div><label style={labelStyle}>{t('thirdPartyOptional')}</label><input style={fieldStyle} placeholder={t('personNamePlaceholder')} value={thirdPartyName} onChange={(e) => setThirdPartyName(e.target.value)} /></div>}
                {owner === 'SHARED' && <div><label style={labelStyle}>{t('myShare')}</label><input style={fieldStyle} inputMode="decimal" placeholder="0,00" value={personalAmount} onChange={(e) => setPersonalAmount(e.target.value.replace(/[^0-9.,]/g, ''))} /></div>}
                {owner === 'SHARED' && <div><label style={labelStyle}>{t('whoPaysRest')}</label><input style={fieldStyle} placeholder={t('personNamePlaceholder')} value={thirdPartyName} onChange={(e) => setThirdPartyName(e.target.value)} /></div>}
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, opacity: paymentMethod === 'debito_pix' ? 0.45 : 1 }}>
              <div><label style={labelStyle}>{t('installmentAmount')}</label><input style={fieldStyle} inputMode="decimal" pattern="[0-9.,]*" placeholder="211,00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} /></div>
              <div><label style={labelStyle}>{t('currentInstallment')}</label><input disabled={paymentMethod === 'debito_pix'} style={fieldStyle} inputMode="numeric" pattern="[0-9]*" value={paymentMethod === 'debito_pix' ? '1' : curInstallment} onChange={(e) => setCurInstallment(e.target.value.replace(/[^0-9]/g, ''))} /></div>
              <div><label style={labelStyle}>{t('totalInstallments')}</label><input disabled={paymentMethod === 'debito_pix'} style={fieldStyle} inputMode="numeric" pattern="[0-9]*" value={paymentMethod === 'debito_pix' ? '1' : totalInstallment} onChange={(e) => setTotalInstallment(e.target.value.replace(/[^0-9]/g, ''))} /></div>
            </div>
            {affected.length > 0 && (
              <div className="cc-charged-panel" style={{ background: '#0a1a0a', border: '1px solid #152515', borderRadius: 8, padding: '10px 14px' }}>
                <div className="cc-charged-label" style={{ fontSize: 10, color: '#4ade80', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('chargedIn')} {affected.length} {affected.length === 1 ? t('monthUnit') : t('monthsUnit')}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {affected.map((mi, i) => (
                    <span key={`${mi.name}-${mi.year}-${i}`} className={i === 0 ? 'cc-month-chip is-first' : 'cc-month-chip'} style={{ background: i === 0 ? '#16a34a15' : '#131313', border: `1px solid ${i === 0 ? '#16a34a33' : '#1e1e1e'}`, borderRadius: 5, padding: '3px 10px', fontSize: 11, color: i === 0 ? '#4ade80' : '#8f8f8f', fontWeight: i === 0 ? 600 : 400 }}>
                      {formatMonthShort(mi.name, mi.year)}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#8b8b8b', marginTop: 8 }}>{t('totalCommitted')}: <strong style={{ color: '#777' }}>{formatMoney(parseAmount(amount) * affected.length)}</strong></div>
              </div>
            )}

            {manualDuplicate && (
              <div className="cc-dup-warning" style={{ background: '#241a0b', border: '1px solid #5a3b12', borderRadius: 6, padding: '8px 10px', color: '#f59e0b', fontSize: 11 }}>
                {t('manualDuplicateWarning')}
              </div>
            )}

            <button type="button" onClick={handleAdd} disabled={!name.trim() || !amount} className="cc-submit" style={{ background: name.trim() && amount ? '#3b82f6' : '#151520', border: 'none', borderRadius: 6, color: name.trim() && amount ? '#fff' : '#3a4a5a', cursor: name.trim() && amount ? 'pointer' : 'not-allowed', padding: '10px 20px', fontSize: 13, fontWeight: 600, alignSelf: 'flex-start', transition: 'all 0.15s' }}>
              {affected.length > 1 ? t('launchMultiMonth', { count: affected.length }) : t('launchSingleMonth')}
            </button>
          </div>
        )}
      </div>

      {/* Importar da fatura */}
      <StatementImportPanel userId={userId} month={selectedMonthName} year={selectedMonthYear} existingTransactions={creditCardInvoices.flatMap((invoice) => invoice.transactions)} onImport={onImportInvoice} />

      {(creditCardInvoices.length > 0 || charges.pendingBills.length > 0) && <InvoiceTransactions invoices={creditCardInvoices} monthBills={monthBills} onUpdate={onUpdateInvoice} onTogglePaid={onTogglePaid} onSaveBill={onSaveBill} onDeleteBill={onDeleteBill} hideValues={hideValues} />}

      {/* Contas fixas vinculadas ao cartão */}
      {linkedFixedBills.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('linkedFixedTitle')}</h3>
            <span className="theme-card-count" style={{ fontSize: 10, color: '#60a5fa', background: '#111520', border: '1px solid #1e2a3e', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{linkedFixedBills.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {linkedFixedBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} showPaidToggle={false} />))}
          </div>
          <div className="theme-muted-text" style={{ fontSize: 11, marginTop: 8, paddingLeft: 4 }}>{t('linkedFixedNote')}</div>
        </div>
      )}

      {debitPixBills.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('debitPixPurchases')}</h3>
            <span className="cc-debit-chip" style={{ fontSize: 10, color: '#f59e0b', background: '#1a150a', border: '1px solid #2a2010', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{debitPixBills.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {debitPixBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} showPaidToggle={false} />))}
          </div>
        </div>
      )}

      {/* Visão geral */}
      <div>
        <h3 style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('monthlyOverview')}</h3>
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
                  <div className="theme-progress-track" style={{ flex: 1, background: '#1a1a1a', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#10b981', borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                  <div className="privacy-mask" style={{ fontSize: 12, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#c0c0c0', minWidth: 85, textAlign: 'right', transition: 'color 0.2s' }}>{hideValues ? '••••' : formatMoney(totalAmt)}</div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
