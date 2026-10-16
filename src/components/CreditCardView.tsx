import React, { useEffect, useRef, useState } from 'react';
import {
  type CategoryId,
  type CreditCardInvoice,
  type CreditCardTransaction,
  type ExpenseOwner,
  getMonthIndex,
} from '../types';
import { type CreditCardPurchase, type MonthInfo } from '../store/useDashboard';
import { amountToCents, centsToAmount, describeDuplicateMatch, formatTransactionDay, getCardCharges, getCardTotalWithPendingBillsCents, getInvoiceTotalCents, getOwnerLabel, getThirdPartyTotalsCents, getTransactionDay, setTransactionDay, sortInvoiceTransactions } from '../services/cardTransactions';
import { findDuplicateTransaction } from '../services/transactionDuplicates';
import { getCardDueDay, getInvoiceCardLabel, getPaymentCardLabel, groupInvoicesByCard, type PaymentCard, resolveBillCardId } from '../services/paymentCards';
import { BillRow } from './BillRow';
import { CardSelect } from './CardSelect';
import { CategorySelect } from './CategorySelect';
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
  onImportInvoice: (invoice: CreditCardInvoice, forceDuplicateIds?: string[]) => void;
  onUpdateInvoice: (invoice: CreditCardInvoice) => void;
  getAffectedMonths: (cur: number, total: number) => MonthInfo[];
  /** Sem argumentos é "pagar tudo do cartão"; com ids, marca somente aquele cartão. */
  onPayCreditCard: (invoiceIds?: string[], billIds?: string[], cardId?: string) => void;
  onUnpayCreditCard: (invoiceIds?: string[], billIds?: string[]) => void;
  creditCardDueDay?: number;
  onUpdateCreditCardDueDay: (dueDay: number, cardId?: string) => void;
  hideValues?: boolean;
  invoiceCalendarEventId?: string;
  invoiceCalendarEventIds?: Record<string, string>;
  onInvoiceCalendarReminder?: (cardId?: string) => void;
  invoiceCalendarReminderLoading?: boolean;
  /** Cartões cadastrados nesta conta; com um só cartão a tela continua com uma barra única. */
  paymentCards: PaymentCard[];
}

const fieldStyle: React.CSSProperties = {
  background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 6, color: '#e0e0e0', padding: '8px 12px', fontSize: 13, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 10, color: '#8f8f8f', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, display: 'block',
};

/** 'person:Marcos' filtra uma pessoa nomeada; os demais valores são o dono do lançamento. */
type OwnerFilter = 'ALL' | ExpenseOwner | `person:${string}`;

/** Uma coisa por vez na tela: a fatura do cartão, o que saiu à vista, digitar uma compra ou importar a fatura. */
type CardSection = 'fatura' | 'debito_pix' | 'lancar' | 'importar';

interface OwnerChip {
  value: OwnerFilter;
  label: string;
  cents: number;
}

const getOwnerOptions = (t: (key: string) => string): Array<{ value: ExpenseOwner; label: string }> => [
  { value: 'ME', label: t('me') },
  { value: 'THIRD_PARTY', label: t('thirdParty') },
  { value: 'SHARED', label: t('shared') },
];

/** O que cada barra de fatura representa: um cartão, ou o conjunto sem cartão cadastrado. */
interface InvoiceBar {
  key: string;
  label: string;
  /** Total deste cartão no mês, para a barra mostrar de quanto ela é responsável. */
  cents: number;
  dueDay?: number;
  isPaid: boolean;
  hasItems: boolean;
  calendarAdded: boolean;
  calendarLoading: boolean;
  /** O que pertence a esta barra: com mais de um cartão, isto vira o corpo do bloco retrátil. */
  invoices: CreditCardInvoice[];
  bills: Bill[];
  /** Os controles viajam com a barra porque só ela sabe quais faturas e contas são suas. */
  onTogglePaid: () => void;
  onSaveDueDay: (dueDay: number) => void;
  onCalendarReminder?: () => void;
}

/**
 * Qual bloco de cartão está aberto. O padrão é fechado: a fatura inteira na tela empurra o
 * resto do mês para baixo, e quem quer ver as compras abre. É preferência de tela, não dado,
 * então vai no mesmo blob (sem sufixo de conta) que guarda a seção escolhida.
 */
function useCollapsedCardGroups() {
  const [open, setOpen] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('financa_sections_v1');
      const keys = saved ? JSON.parse(saved)['cardGroupsOpen'] : undefined;
      return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
    } catch { return []; }
  });
  useEffect(() => {
    try {
      const saved = localStorage.getItem('financa_sections_v1');
      const settings = saved ? JSON.parse(saved) : {};
      settings['cardGroupsOpen'] = open;
      localStorage.setItem('financa_sections_v1', JSON.stringify(settings));
    } catch { /* ignore */ }
  }, [open]);
  const toggle = (key: string) => setOpen((current) => (
    current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
  ));
  const isExpanded = (key: string) => open.includes(key);
  return { toggle, isExpanded };
}

interface DueBarProps {
  label: string;
  cents: number;
  dueDay?: number;
  isPaid: boolean;
  hasItems: boolean;
  calendarAdded: boolean;
  calendarLoading: boolean;
  hideValues?: boolean;
  onTogglePaid: () => void;
  onSaveDueDay: (dueDay: number) => void;
  onCalendarReminder?: () => void;
  /** Com as compras do cartão dentro, a barra vira o bloco retrátil do banco: cabeçalho + corpo. */
  children?: React.ReactNode;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

/** Uma barra por cartão: marcar a fatura daquele cartão como paga, o vencimento dele e o lembrete dele. */
function InvoiceDueBar({ label, cents, dueDay, isPaid, hasItems, calendarAdded, calendarLoading, hideValues, onTogglePaid, onSaveDueDay, onCalendarReminder, children, expanded, onToggleExpand }: DueBarProps) {
  const { formatMoney, t } = usePreferences();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(dueDay ?? ''));
  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(String(dueDay ?? '')), 0);
    return () => window.clearTimeout(timer);
  }, [dueDay]);
  const save = () => {
    const value = Number(draft);
    if (value < 1 || value > 31) return;
    onSaveDueDay(value);
    setEditing(false);
  };

  const amount = hasItems ? (
    <span className="privacy-mask" style={{ fontSize: 14, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#e8e8e8', whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
      {hideValues ? '••••' : formatMoney(centsToAmount(cents))}
    </span>
  ) : null;

  const header = (
    <div className="theme-card-due-setting" style={{ opacity: isPaid ? 0.6 : 1, flexWrap: 'wrap' }}>
      {hasItems && (
        <button type="button"
          role="checkbox"
          aria-checked={isPaid}
          aria-label={isPaid ? t('markAsUnpaid') : t('markAsPaid')}
          title={isPaid ? t('markAsUnpaid') : t('markAsPaid')}
          onClick={onTogglePaid}
          style={{
            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          }}
        >
          <span style={{
            width: 20, height: 20, borderRadius: '50%',
            border: `2px solid ${isPaid ? '#10b981' : '#3b82f6'}`,
            background: isPaid ? '#10b981' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}>
            {isPaid && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>
      )}
      <div style={{ flex: '1 1 120px', minWidth: 0 }}>
        {/* O alvo de abrir/fechar é a linha inteira do nome e do valor: ninguém precisa acertar a setinha. */}
        {onToggleExpand ? (
          <button
            type="button"
            className="cc-bar-toggle"
            aria-expanded={Boolean(expanded)}
            title={expanded ? t('hideCardPurchases') : t('showCardPurchases')}
            aria-label={`${expanded ? t('hideCardPurchases') : t('showCardPurchases')} — ${label}`}
            onClick={onToggleExpand}
            style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, width: '100%', margin: 0, padding: '2px 0', background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
          >
            <span className="cc-bar-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, margin: 0 }}>
              <svg className="cc-bar-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden style={{ flexShrink: 0, transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>
                <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <strong style={{ textDecoration: isPaid ? 'line-through' : 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</strong>
            </span>
            {amount}
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <strong style={{ textDecoration: isPaid ? 'line-through' : 'none' }}>{label}</strong>
            {amount}
          </div>
        )}
        {editing ? (
          <div className="theme-card-due-form">
            <input autoFocus inputMode="numeric" value={draft} onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(event) => { if (event.key === 'Enter') save(); if (event.key === 'Escape') setEditing(false); }} placeholder={t('dayPlaceholder')} aria-label={t('invoiceDueDayAria')} />
            <button type="button" onClick={save}>{t('save')}</button>
          </div>
        ) : (
          /* O dia é o próprio controle: sem um segundo CTA azul, a barra cabe numa linha no celular. */
          <button type="button" title={t('editDueDate')} className={dueDay ? 'cc-due-day-link' : 'cc-due-day-link is-empty'} onClick={() => { setDraft(String(dueDay ?? '')); setEditing(true); }}>
            {dueDay ? t('invoiceDueEveryDay', { day: dueDay }) : t('addDueDate')}
          </button>
        )}
      </div>
      {hasItems && !isPaid && onCalendarReminder && (
        <div style={{ flexShrink: 0 }}>
          <CalendarReminderButton iconOnly added={calendarAdded} loading={calendarLoading} onClick={onCalendarReminder} />
        </div>
      )}
    </div>
  );

  // Sem corpo para mostrar, a barra continua sendo só a barra de sempre.
  if (!onToggleExpand) return header;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, background: '#0c0c0c', border: '1px solid #1c1c1c', borderRadius: 10 }}>
      {header}
      {expanded && children}
    </div>
  );
}

interface InvoiceTransactionsProps {
  invoices: CreditCardInvoice[];
  monthBills: Bill[];
  /** Cada barra vem como bloco retrátil: fechado, a lista de compras não empurra o resto da tela. */
  bars?: InvoiceBar[];
  /** A conta lançada à mão precisa poder trocar de cartão sem sair da fatura. */
  paymentCards: PaymentCard[];
  userId: string | null;
  onUpdate: (invoice: CreditCardInvoice) => void;
  onTogglePaid: (id: string) => void;
  onSaveBill: (bill: Bill) => void;
  onDeleteBill: (id: string) => void;
  hideValues?: boolean;
}

function InvoiceTransactions({ invoices, monthBills, bars, paymentCards, userId, onUpdate, onTogglePaid, onSaveBill, onDeleteBill, hideValues }: InvoiceTransactionsProps) {
  const { formatMoney, parseAmount, typeLabel, categoryColor, t } = usePreferences();
  const ownerOptions = getOwnerOptions(t);
  const [filter, setFilter] = useState<OwnerFilter>('ALL');
  const [pendingRemoval, setPendingRemoval] = useState<CreditCardTransaction | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const { toggle, isExpanded } = useCollapsedCardGroups();
  const allTransactions = invoices.flatMap((invoice) => invoice.transactions);
  // Resumo e chips valem para o mês inteiro: por cartão só muda a lista que fica dentro do bloco.
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
  const transactions = sortInvoiceTransactions(allTransactions.filter(matchesFilter));
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
  // Toda conta lançada na mão que pesa na fatura mora aqui: mensal, variável ou parcela. Só a parcela
  // era listada antes, e o resto somava na barra sem aparecer em lugar nenhum.
  const pendingBillsOf = (bills: Bill[]): Bill[] => (filter === 'ALL' || filter === 'ME' ? bills : []);
  // Um chip por pessoa nomeada; os que não têm valor no mês somem para não ocupar espaço.
  const ownerChips: OwnerChip[] = [
    { value: 'ME', label: t('me'), cents: charges.personalCents },
    { value: 'THIRD_PARTY', label: t('thirdParty'), cents: charges.thirdPartyCents },
    ...getThirdPartyTotalsCents(allTransactions).map((group): OwnerChip => ({
      value: `person:${group.name}`, label: group.name, cents: group.cents,
    })),
    { value: 'SHARED', label: t('shared'), cents: charges.sharedCents },
    { value: 'ALL', label: t('all'), cents: charges.totalCents },
  ];
  const chips = ownerChips.filter((chip) => chip.value === 'ME' || chip.value === 'ALL' || chip.cents !== 0);
  const visibleCreditCardBills = pendingBillsOf(charges.pendingBills);
  // Com cartão cadastrado a lista sempre mora dentro do bloco do banco, mesmo que seja um só.
  const grouped = Boolean(bars && bars.length > 0);

  const rowsList = (rows: CreditCardTransaction[], bills: Bill[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((transaction) => (
        <div key={transaction.id} className="cc-transaction-row" style={{ background: '#131313', border: '1px solid #1e1e1e', borderRadius: 10, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
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
                <span aria-hidden style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: transaction.category ? categoryColor(transaction.category) : '#3f3f3f' }} />
                <CategorySelect value={transaction.category ?? ''} ariaLabel={t('categoryAria')} unsetLabel={t('noCategory')} onChange={(category) => updateTransaction(transaction.id, { category: category || undefined })} style={{ ...fieldStyle, width: 138, padding: '5px 8px', fontSize: 11 }} />
              </div>
              <select value={transaction.owner} onChange={(event) => updateTransaction(transaction.id, { owner: event.target.value as ExpenseOwner, personalAmountCents: event.target.value === 'SHARED' ? transaction.personalAmountCents : undefined })} style={{ ...fieldStyle, width: 150, padding: '5px 8px', fontSize: 11 }}>
                {ownerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                {/* Um lançamento salvo antes pode vir sem dono; some da lista, mas não pode ficar sem rótulo. */}
                {!ownerOptions.some((option) => option.value === transaction.owner) && <option value={transaction.owner}>{getOwnerLabel(transaction.owner)}</option>}
              </select>
              {transaction.owner === 'THIRD_PARTY' && <input value={transaction.thirdPartyName ?? ''} onChange={(event) => updateTransaction(transaction.id, { thirdPartyName: event.target.value })} placeholder={t('who')} style={{ ...fieldStyle, width: 130, padding: '5px 8px', fontSize: 11 }} />}
              {transaction.owner === 'SHARED' && <input inputMode="decimal" value={transaction.personalAmountCents == null ? '' : (transaction.personalAmountCents / 100).toFixed(2).replace('.', ',')} onChange={(event) => { const typed = event.target.value.trim(); updateTransaction(transaction.id, { personalAmountCents: typed ? Math.min(transaction.amountCents, Math.max(0, Math.round(parseAmount(typed) * 100))) : 0 }); }} placeholder={t('myShare')} style={{ ...fieldStyle, width: 110, padding: '5px 8px', fontSize: 11 }} />}
              {transaction.owner === 'SHARED' && <input value={transaction.thirdPartyName ?? ''} aria-label={t('whoPaysRest')} onChange={(event) => updateTransaction(transaction.id, { thirdPartyName: event.target.value })} placeholder={t('whoPaysRest')} style={{ ...fieldStyle, width: 130, padding: '5px 8px', fontSize: 11 }} />}
              <span className="cc-owner-badge" style={{ fontSize: 10, color: '#9a9a9a' }}>{getOwnerLabel(transaction.owner)}</span>
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
      {bills.map((bill) => (
        <BillRow key={`legacy-card-bill-${bill.id}`} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} paymentCards={paymentCards} userId={userId} showPaidToggle={false} />
      ))}
    </div>
  );

  /** O corpo de um bloco: as compras daquele cartão que passam pelo filtro, mais as parcelas postas na mão. */
  const groupBody = (bar: InvoiceBar) => {
    const rows = sortInvoiceTransactions(bar.invoices.flatMap((invoice) => invoice.transactions).filter(matchesFilter));
    const bills = pendingBillsOf(bar.bills);
    if (rows.length + bills.length === 0) {
      return <div style={{ fontSize: 11, color: '#7a7a7a', padding: '2px 4px' }}>{t('noTransactionsInFilter')}</div>;
    }
    return rowsList(rows, bills);
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Com os blocos por cartão, as somas do mês já aparecem em cima: repetir aqui é ruído. */}
      {!grouped && (
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
          [t('thirdParty'), charges.thirdPartyCents],
        ].map(([label, cents], index) => (
          <div key={String(label)} className="cc-summary-tile" style={{ minWidth: index === 0 ? 152 : 126, flex: `0 0 ${index === 0 ? 152 : 126}px`, background: '#131313', border: index === 0 ? '1px solid #23324a' : '1px solid #1e1e1e', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: index === 0 ? '#93c5fd' : '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div className="privacy-mask" style={{ marginTop: 5, fontSize: index === 0 ? 18 : 16, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#e8e8e8' }}>{hideValues ? '••••' : formatMoney(centsToAmount(Number(cents)))}</div>
          </div>
        ))}
      </div>
      )}
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
      {!grouped && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -6 }}>
          <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('invoiceItems')}</h3>
          <span className="theme-card-count" style={{ fontSize: 10, color: '#8b8b8b', background: '#151515', border: '1px solid #1e1e1e', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{transactions.length + visibleCreditCardBills.length}</span>
        </div>
      )}
      {/* Cada bloco é a fatura daquele plástico: abre e fecha como no app do banco. */}
      {grouped && bars
        ? bars.map((bar) => (
          <InvoiceDueBar
            key={bar.key}
            label={bar.label}
            cents={bar.cents}
            dueDay={bar.dueDay}
            isPaid={bar.isPaid}
            hasItems={bar.hasItems}
            calendarAdded={bar.calendarAdded}
            calendarLoading={bar.calendarLoading}
            hideValues={hideValues}
            onTogglePaid={bar.onTogglePaid}
            onSaveDueDay={bar.onSaveDueDay}
            onCalendarReminder={bar.onCalendarReminder}
            expanded={isExpanded(bar.key)}
            onToggleExpand={() => toggle(bar.key)}
          >
            {groupBody(bar)}
          </InvoiceDueBar>
        ))
        : rowsList(transactions, visibleCreditCardBills)}
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
  invoiceCalendarEventId, invoiceCalendarEventIds, onInvoiceCalendarReminder, invoiceCalendarReminderLoading, paymentCards,
}) => {
  const { formatMoney, formatMonthShort, parseAmount, t } = usePreferences();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<CategoryId>('compras');
  const [cardId, setCardId] = useState<string>(() => paymentCards[0]?.id ?? '');
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
  const [lastLaunched, setLastLaunched] = useState('');
  const [section, setSection] = useState<CardSection>(() => {
    try { const saved = localStorage.getItem('financa_sections_v1'); if (saved) { return JSON.parse(saved)['creditCardSection'] ?? 'fatura'; } } catch { /* ignore */ }
    return 'fatura';
  });

  const selectSection = (next: CardSection) => {
    setSection(next);
    try { const saved = localStorage.getItem('financa_sections_v1'); const s = saved ? JSON.parse(saved) : {}; s['creditCardSection'] = next; localStorage.setItem('financa_sections_v1', JSON.stringify(s)); } catch { /* ignore */ }
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
      date: parseInt(purchaseDay) ? formatTransactionDay(parseInt(purchaseDay), getMonthIndex(selectedMonthName)) : undefined,
    }, creditCardInvoices.flatMap((invoice) => invoice.transactions))
    : undefined;

  const charges = getCardCharges(creditCardInvoices, monthBills);
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

  // Sem cartão cadastrado a tela é exatamente a de antes: uma barra única de "Fatura do mês".
  const cardGroups = groupInvoicesByCard(creditCardInvoices, paymentCards);
  const unassignedInvoices = cardGroups.find((group) => !group.cardId)?.invoices ?? [];
  // Cada conta lançada na mão vai para a barra do cartão escolhido nela; sem escolha vale a mesma
  // herança da fatura: com um único cartão cadastrado, ela vence junto dele.
  const pendingBillsByCard = new Map<string, Bill[]>();
  const orphanPendingBills: Bill[] = [];
  charges.pendingBills.forEach((bill) => {
    const owner = resolveBillCardId(bill, paymentCards);
    if (!owner) { orphanPendingBills.push(bill); return; }
    pendingBillsByCard.set(owner, [...(pendingBillsByCard.get(owner) ?? []), bill]);
  });
  // A conta que já mora na barra do cartão não precisa de uma segunda lista embaixo. Ali ficam só as
  // fixas vinculadas que o banco já cobrou — vieram na fatura importada e por isso não somam de novo.
  const pendingBillIds = new Set(charges.pendingBills.map((bill) => bill.id));
  const unlistedLinkedBills = linkedFixedBills.filter((bill) => !pendingBillIds.has(bill.id));
  const reminderLoading = Boolean(invoiceCalendarReminderLoading);
  const unassignedPaid = unassignedInvoices.every((invoice) => invoice.isPaid) && orphanPendingBills.every((bill) => bill.isPaid);
  const invoiceBars: InvoiceBar[] = paymentCards.length === 0
    ? [{
      key: 'mes',
      label: t('monthlyInvoice'),
      cents: charges.totalCents,
      dueDay: creditCardDueDay,
      isPaid: allCardPaid,
      hasItems: hasCardItems,
      calendarAdded: Boolean(invoiceCalendarEventId),
      calendarLoading: reminderLoading,
      invoices: creditCardInvoices,
      bills: charges.pendingBills,
      // Sem ids, o toggle é o "pagar tudo" anterior ao recurso de vários cartões.
      onTogglePaid: () => (allCardPaid ? onUnpayCreditCard() : onPayCreditCard()),
      onSaveDueDay: (dueDay) => onUpdateCreditCardDueDay(dueDay),
      onCalendarReminder: onInvoiceCalendarReminder ? () => onInvoiceCalendarReminder() : undefined,
    }]
    : [
      ...paymentCards
        .filter((card) => cardGroups.some((group) => group.cardId === card.id) || pendingBillsByCard.has(card.id))
        .map((card): InvoiceBar => {
          const groupInvoices = cardGroups.find((group) => group.cardId === card.id)?.invoices ?? [];
          const groupBills = pendingBillsByCard.get(card.id) ?? [];
          const invoiceIds = groupInvoices.map((invoice) => invoice.id);
          const billIds = groupBills.map((bill) => bill.id);
          const isPaid = groupInvoices.every((invoice) => invoice.isPaid) && groupBills.every((bill) => bill.isPaid);
          return {
            key: card.id,
            label: getInvoiceCardLabel({ cardId: card.id, cardLabel: groupInvoices[0]?.cardLabel }, paymentCards),
            cents: getCardTotalWithPendingBillsCents(groupInvoices, groupBills),
            dueDay: getCardDueDay(card.id, paymentCards, creditCardDueDay),
            isPaid,
            hasItems: true,
            calendarAdded: Boolean(invoiceCalendarEventIds?.[card.id]),
            calendarLoading: reminderLoading,
            invoices: groupInvoices,
            bills: groupBills,
            onTogglePaid: () => (isPaid ? onUnpayCreditCard(invoiceIds, billIds) : onPayCreditCard(invoiceIds, billIds, card.id)),
            onSaveDueDay: (dueDay) => onUpdateCreditCardDueDay(dueDay, card.id),
            onCalendarReminder: onInvoiceCalendarReminder ? () => onInvoiceCalendarReminder(card.id) : undefined,
          };
        }),
      ...(unassignedInvoices.length > 0 || orphanPendingBills.length > 0 ? [{
        key: 'sem-cartao',
        label: t('noCardInvoice'),
        cents: getCardTotalWithPendingBillsCents(unassignedInvoices, orphanPendingBills),
        dueDay: creditCardDueDay,
        isPaid: unassignedPaid,
        hasItems: unassignedInvoices.length > 0 || orphanPendingBills.length > 0,
        calendarAdded: Boolean(invoiceCalendarEventId),
        calendarLoading: reminderLoading,
        invoices: unassignedInvoices,
        bills: orphanPendingBills,
        onTogglePaid: () => (unassignedPaid
          ? onUnpayCreditCard(unassignedInvoices.map((invoice) => invoice.id), orphanPendingBills.map((bill) => bill.id))
          : onPayCreditCard(unassignedInvoices.map((invoice) => invoice.id), orphanPendingBills.map((bill) => bill.id))),
        onSaveDueDay: (dueDay) => onUpdateCreditCardDueDay(dueDay),
        onCalendarReminder: onInvoiceCalendarReminder ? () => onInvoiceCalendarReminder() : undefined,
      } satisfies InvoiceBar] : []),
    ];
  // Com cartão cadastrado a fatura vira bloco retrátil do banco, mesmo sendo um só: fechado, o
  // resto do mês chega na tela sem rolar 40 linhas. Sem cartão, continua a lista de sempre.
  const groupedBars = paymentCards.length > 0 && invoiceBars.length > 0;
  // Cada barra já traz o total daquele cartão, então a soma repetida é ruído: "todas as faturas"
  // só serve para somar mais de uma, e "minha parte" só existe quando a fatura é dividida.
  const summaryTiles = [
    ...(invoiceBars.length > 1 ? [{ label: t('totalAllInvoices'), cents: charges.totalCents, hint: t('totalAllInvoicesHint') }] : []),
    ...(charges.personalCents !== charges.totalCents ? [{ label: t('myInvoiceShare'), cents: charges.personalCents, hint: t('myInvoiceShareHint') }] : []),
  ];

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed || !amount) return;
    const c = Math.max(1, Math.min(cur, total));
    const installmentTotalValue = Math.max(c, total);
    const parsedAmount = parseAmount(amount);
    const amountCents = Math.round(parsedAmount * 100);
    const targetCard = paymentCards.find((card) => card.id === cardId);
    onAddPurchase({ name: trimmed, amount: parsedAmount, category, dueDay: parseInt(purchaseDay) || undefined, installmentCurrent: paymentMethod === 'debito_pix' ? 1 : c, installmentTotal: paymentMethod === 'debito_pix' ? 1 : installmentTotalValue, paymentMethod, owner: paymentMethod === 'debito_pix' ? 'ME' : owner, personalAmountCents: owner === 'SHARED' ? Math.min(amountCents, Math.max(0, Math.round(parseAmount(personalAmount) * 100))) : undefined, thirdPartyName: owner === 'THIRD_PARTY' || owner === 'SHARED' ? thirdPartyName.trim() || undefined : undefined, cardId: paymentMethod === 'debito_pix' ? undefined : targetCard?.id, cardLabel: paymentMethod === 'debito_pix' || !targetCard ? undefined : getPaymentCardLabel(targetCard) });
    // O formulário limpa sozinho, então sem esta linha o usuário não tem como saber se entrou.
    setLastLaunched(`${trimmed} · ${formatMoney(parsedAmount)}${affected.length > 1 ? ` · ${t('launchMultiMonth', { count: affected.length })}` : ''}`);
    setName(''); setAmount(''); setCurInstallment('1'); setTotalInstallment('1'); setPaymentMethod('credito'); setOwner('ME'); setPersonalAmount(''); setThirdPartyName('');
  };

  const masked = '••••';
  const debitPixCents = debitPixBills.reduce((sum, bill) => sum + amountToCents(bill.amount), 0);
  const moneyTabs: Array<{ key: CardSection; label: string; cents: number; count: number }> = [
    { key: 'fatura', label: t('cardTabOnCard'), cents: charges.totalCents, count: monthlyLaunchmentCount },
    { key: 'debito_pix', label: t('debitPix'), cents: debitPixCents, count: debitPixBills.length },
  ];
  const actionTabs: Array<{ key: CardSection; label: string }> = [
    { key: 'lancar', label: `+ ${t('addEntry')}` },
    { key: 'importar', label: `+ ${t('importInvoice')}` },
  ];

  return (
    <div className="theme-card-view" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Em cima, quanto sai por forma de pagamento. Embaixo, o que fazer: digitar uma compra ou importar a fatura. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {moneyTabs.map((tabItem) => {
            const active = section === tabItem.key;
            return (
              <button key={tabItem.key} type="button" aria-pressed={active} onClick={() => selectSection(tabItem.key)} className={active ? 'cc-filter-btn is-active' : 'cc-filter-btn'} style={{ flex: '1 1 0', minWidth: 0, textAlign: 'left', background: active ? '#1e2a3e' : '#131313', border: `1px solid ${active ? '#3b82f6' : '#1e1e1e'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: active ? '#93c5fd' : '#8f8f8f' }}>{tabItem.label}</div>
                <div className="privacy-mask" style={{ marginTop: 4, fontSize: 17, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#e8e8e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hideValues ? masked : formatMoney(centsToAmount(tabItem.cents))}</div>
                <div style={{ fontSize: 10, color: '#8b8b8b', marginTop: 2 }}>{tabItem.count} lançamento(s)</div>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {actionTabs.map((tabItem) => {
            const active = section === tabItem.key;
            return (
              <button key={tabItem.key} type="button" aria-pressed={active} onClick={() => selectSection(tabItem.key)} className={active ? 'cc-filter-btn is-active' : 'cc-filter-btn'} style={{ flex: '1 1 0', minWidth: 0, background: active ? '#1e2a3e' : '#131313', border: `1px solid ${active ? '#3b82f6' : '#1e1e1e'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', color: active ? '#93c5fd' : '#c0c0c0', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {tabItem.label}
              </button>
            );
          })}
        </div>
      </div>

      {section === 'fatura' && (
        <>
      {/* Uma barra por cartão: pagar aquele cartão, ver o vencimento dele e criar o lembrete dele.
          Agrupado, cada barra desce para a lista de itens e vira o bloco retrátil do cartão. */}
      {!groupedBars && invoiceBars.map((bar) => (
        <InvoiceDueBar
          key={bar.key}
          label={bar.label}
          cents={bar.cents}
          dueDay={bar.dueDay}
          isPaid={bar.isPaid}
          hasItems={bar.hasItems}
          calendarAdded={bar.calendarAdded}
          calendarLoading={bar.calendarLoading}
          hideValues={hideValues}
          onTogglePaid={bar.onTogglePaid}
          onSaveDueDay={bar.onSaveDueDay}
          onCalendarReminder={bar.onCalendarReminder}
        />
      ))}

      {summaryTiles.length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          {summaryTiles.map((tile) => (
            <div key={tile.label} className="cc-summary-tile" style={{ flex: '1 1 0', minWidth: 0, background: '#131313', border: '1px solid #1e1e1e', borderRadius: 10, padding: '11px 14px' }}>
              <div style={{ fontSize: 10, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tile.label}</div>
              <div className="privacy-mask" style={{ marginTop: 5, fontSize: 16, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#e8e8e8', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{hideValues ? masked : formatMoney(centsToAmount(tile.cents))}</div>
              <div style={{ fontSize: 10, color: '#7a7a7a', marginTop: 4 }}>{tile.hint}</div>
            </div>
          ))}
        </div>
      )}

      {/* O que fica em aberto em todos os meses, numa linha só. */}
      {totalDebt > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#131313', border: '1px solid #1e1e1e', borderRadius: 10, padding: '11px 14px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{t('totalDebt')}</div>
            <div className="theme-muted-text" style={{ fontSize: 10, marginTop: 3 }}>{t('openInstallments')}</div>
          </div>
          <strong className="privacy-mask" style={{ fontSize: 16, fontWeight: 700, color: hideValues ? 'var(--privacy-mask)' : '#e8e8e8', whiteSpace: 'nowrap' }}>{hideValues ? masked : formatMoney(totalDebt)}</strong>
        </div>
      )}
        </>
      )}

      {section === 'lancar' && (
        <>
      {/* Form */}
      <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', color: '#c0c0c0' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('addCardPurchase')}</span>
        </div>
          <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ height: 1, background: '#1a1a1a', marginBottom: 4 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label style={labelStyle}>{t('purchaseName')}</label><input style={fieldStyle} placeholder={t('purchaseNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} /></div>
              <div><label style={labelStyle}>{t('category')}</label><CategorySelect value={category} ariaLabel={t('category')} onChange={setCategory} style={fieldStyle} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: paymentMethod === 'credito' ? '1fr 1fr 104px' : '1fr 104px', gap: 12 }}>
              <div><label style={labelStyle}>{t('paymentMethod')}</label><select style={fieldStyle} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'credito' | 'debito_pix')}><option value="credito">{t('creditCard')}</option><option value="debito_pix">{t('debitPix')}</option></select></div>
              {/* A compra declara em qual cartão cai; o cartão novo nasce aqui e fica nesta conta. */}
              {paymentMethod === 'credito' && (
                <div><label style={labelStyle}>{t('card')}</label><CardSelect userId={userId} cards={paymentCards} value={cardId} onChange={setCardId} ariaLabel={t('selectCardAria')} style={fieldStyle} /></div>
              )}
              <div><label style={labelStyle}>{t('purchaseDay')}</label><input style={fieldStyle} inputMode="numeric" pattern="[0-9]*" aria-label={t('transactionDayAria')} placeholder="--" maxLength={2} value={purchaseDay} onChange={(e) => setPurchaseDay(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && handleAdd()} /></div>
            </div>
            {paymentMethod === 'credito' && (
              <>
                <div><label style={labelStyle}>{t('responsibility')}</label><select style={fieldStyle} value={owner} onChange={(e) => setOwner(e.target.value as ExpenseOwner)}><option value="ME">{t('me')}</option><option value="THIRD_PARTY">{t('thirdParty')}</option><option value="SHARED">{t('shared')}</option></select></div>
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
                <div style={{ fontWeight: 600, marginBottom: 3 }}>{t('manualDuplicateWarning')}</div>
                <div style={{ color: '#d9a441', lineHeight: 1.45 }}>{describeDuplicateMatch(manualDuplicate, formatMoney, t)}</div>
                <div style={{ color: '#d9a441', lineHeight: 1.45, marginTop: 3 }}>{t('manualDuplicateFreeHint')}</div>
              </div>
            )}

            <button type="button" onClick={handleAdd} disabled={!name.trim() || !amount} className="cc-submit" style={{ background: name.trim() && amount ? '#3b82f6' : '#151520', border: 'none', borderRadius: 6, color: name.trim() && amount ? '#fff' : '#3a4a5a', cursor: name.trim() && amount ? 'pointer' : 'not-allowed', padding: '10px 20px', fontSize: 13, fontWeight: 600, alignSelf: 'flex-start', transition: 'all 0.15s' }}>
              {affected.length > 1 ? t('launchMultiMonth', { count: affected.length }) : t('launchSingleMonth')}
            </button>

            {lastLaunched && (
              <div className="cc-launched-ok" style={{ background: '#0a1a0a', border: '1px solid #153a1c', borderRadius: 6, padding: '8px 10px', color: '#4ade80', fontSize: 11, lineHeight: 1.45 }}>
                {t('launchConfirmed', { detail: lastLaunched })}
              </div>
            )}
          </div>
      </div>
        </>
      )}

      {section === 'importar' && (
        <StatementImportPanel userId={userId} month={selectedMonthName} year={selectedMonthYear} paymentCards={paymentCards} existingTransactions={creditCardInvoices.flatMap((invoice) => invoice.transactions)} onImport={onImportInvoice} onLaunched={() => selectSection('fatura')} />
      )}

      {section === 'fatura' && (
        <>
      {(creditCardInvoices.length > 0 || charges.pendingBills.length > 0) && <InvoiceTransactions invoices={creditCardInvoices} monthBills={monthBills} bars={groupedBars ? invoiceBars : undefined} paymentCards={paymentCards} userId={userId} onUpdate={onUpdateInvoice} onTogglePaid={onTogglePaid} onSaveBill={onSaveBill} onDeleteBill={onDeleteBill} hideValues={hideValues} />}

      {/* Contas fixas vinculadas ao cartão que já estão pagas na fatura do banco. */}
      {unlistedLinkedBills.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('linkedFixedTitle')}</h3>
            <span className="theme-card-count" style={{ fontSize: 10, color: '#60a5fa', background: '#111520', border: '1px solid #1e2a3e', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{unlistedLinkedBills.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {unlistedLinkedBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} paymentCards={paymentCards} userId={userId} showPaidToggle={false} />))}
          </div>
          <div className="theme-muted-text" style={{ fontSize: 11, marginTop: 8, paddingLeft: 4 }}>{t('linkedFixedNote')}</div>
        </div>
      )}
        </>
      )}

      {section === 'debito_pix' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('debitPixPurchases')}</h3>
            <span className="cc-debit-chip" style={{ fontSize: 10, color: '#f59e0b', background: '#1a150a', border: '1px solid #2a2010', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>{debitPixBills.length}</span>
          </div>
          {debitPixBills.length === 0 && (
            <div style={{ background: '#131313', border: '1px solid #1e1e1e', borderRadius: 10, padding: '14px', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 12, color: '#8b8b8b' }}>{t('noExpenses')}</span>
              <button type="button" onClick={() => { setPaymentMethod('debito_pix'); selectSection('lancar'); }} style={{ background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '8px 16px', fontSize: 12, fontWeight: 600 }}>+ {t('addEntry')}</button>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {debitPixBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => onTogglePaid(bill.id)} onSave={onSaveBill} onDelete={() => onDeleteBill(bill.id)} hideValues={hideValues} showPaidToggle={false} />))}
          </div>
        </div>
      )}

      {section === 'fatura' && (
        <>
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
        </>
      )}
    </div>
  );
};
