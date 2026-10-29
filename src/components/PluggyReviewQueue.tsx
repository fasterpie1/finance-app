import React, { useMemo, useState } from 'react';
import { type CategoryId, type CreditCardTransaction, type ExpenseOwner, MONTH_NAMES } from '../types';
import { type PendingPluggyTransaction } from '../services/pluggy';
import { findDuplicateTransaction } from '../services/transactionDuplicates';
import { describeDuplicateMatch } from '../services/cardTransactions';
import { type PaymentCard } from '../services/paymentCards';
import { useModalA11y } from '../hooks/useModalA11y';
import { usePreferences } from '../i18n';
import { CardSelect } from './CardSelect';
import { CategorySelect } from './CategorySelect';

export interface PluggyTransactionReview {
  outcome: 'imported' | 'duplicate' | 'dismissed';
  category: CategoryId;
  owner: ExpenseOwner;
  personalAmountCents?: number;
  thirdPartyName?: string;
  cardId?: string;
}

interface Props {
  userId: string | null;
  transactions: PendingPluggyTransaction[];
  existingTransactions: CreditCardTransaction[];
  paymentCards: PaymentCard[];
  hideValues?: boolean;
  onReview: (transaction: PendingPluggyTransaction, review: PluggyTransactionReview) => Promise<void>;
}

const copy = {
  'pt-BR': {
    pending: 'Compras do Open Finance para revisar',
    review: 'Revisar compras',
    title: 'Confirme esta compra',
    account: 'Conta/cartão',
    invoice: 'Fatura de',
    billTotal: 'Total da fatura informado pelo banco',
    bankSync: 'A compra veio do Pluggy. Confira o cartão, a categoria e quem é responsável antes de adicionar à fatura.',
    markDuplicate: 'Já está lançada',
    addAnyway: 'É outra compra; adicionar',
    confirm: 'Confirmar e adicionar',
    dismiss: 'Ignorar compra',
    close: 'Fechar',
    noCard: 'Selecione ou cadastre o cartão correspondente.',
    sharedAmount: 'Minha parte',
    thirdPartyName: 'Nome da pessoa',
    duplicate: 'Possível lançamento existente:',
    error: 'Não foi possível concluir a revisão.',
  },
  en: {
    pending: 'Open Finance purchases to review',
    review: 'Review purchases',
    title: 'Confirm this purchase',
    account: 'Account/card',
    invoice: 'Invoice for',
    billTotal: 'Invoice total reported by the bank',
    bankSync: 'This purchase came from Pluggy. Check the card, category, and owner before adding it to the invoice.',
    markDuplicate: 'Already added',
    addAnyway: 'It is another purchase; add it',
    confirm: 'Confirm and add',
    dismiss: 'Ignore purchase',
    close: 'Close',
    noCard: 'Select or create the matching card.',
    sharedAmount: 'My share',
    thirdPartyName: 'Person name',
    duplicate: 'Possible existing transaction:',
    error: 'Could not complete the review.',
  },
} as const;

const fieldStyle: React.CSSProperties = {
  background: '#0e0e0e',
  border: '1px solid #1e1e1e',
  borderRadius: 6,
  color: '#e0e0e0',
  padding: '9px 10px',
  fontSize: 12,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

function invoiceMonthLabel(value: string, locale: string): string {
  const [yearText, monthText] = value.split('-');
  const monthIndex = Number(monthText) - 1;
  const month = MONTH_NAMES[monthIndex];
  if (!month || !/^\d{4}$/.test(yearText)) return value;
  const displayMonth = locale === 'en'
    ? new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(yearText), monthIndex, 1)))
    : month;
  return `${displayMonth} ${yearText}`;
}

function initialCardId(transaction: PendingPluggyTransaction, cards: PaymentCard[]): string {
  const last4Match = transaction.cardLast4
    ? cards.find((card) => card.last4 === transaction.cardLast4)
    : undefined;
  if (last4Match) return last4Match.id;
  const accountName = transaction.accountName.toLowerCase();
  return cards.find((card) => accountName.includes(card.bank.toLowerCase()))?.id ?? '';
}

export const PluggyReviewQueue: React.FC<Props> = ({
  userId,
  transactions,
  existingTransactions,
  paymentCards,
  hideValues,
  onReview,
}) => {
  const { locale, formatMoney, parseAmount, t } = usePreferences();
  const text = copy[locale];
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [category, setCategory] = useState<CategoryId>('compras');
  const [owner, setOwner] = useState<ExpenseOwner>('ME');
  const [personalAmount, setPersonalAmount] = useState('');
  const [thirdPartyName, setThirdPartyName] = useState('');
  const [cardId, setCardId] = useState('');
  const [working, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const dialogRef = useModalA11y<HTMLDivElement>(open, () => setOpen(false));
  const activeTransaction = transactions.find((transaction) => transaction.providerTransactionId === activeId)
    ?? transactions[0];

  const resetReview = (transaction: PendingPluggyTransaction) => {
    setCategory('compras');
    setOwner('ME');
    setPersonalAmount('');
    setThirdPartyName('');
    setCardId(initialCardId(transaction, paymentCards));
    setErrorMessage('');
  };

  const duplicateMatch = useMemo(() => {
    if (!activeTransaction) return undefined;
    return findDuplicateTransaction({
      amountCents: activeTransaction.amountCents,
      type: activeTransaction.type,
      date: activeTransaction.date,
      cardLast4: activeTransaction.cardLast4,
      installmentCurrent: activeTransaction.installmentCurrent,
      installmentTotal: activeTransaction.installmentTotal,
    }, existingTransactions);
  }, [activeTransaction, existingTransactions]);

  const submitReview = async (outcome: PluggyTransactionReview['outcome']) => {
    if (!activeTransaction) return;
    if (outcome === 'imported' && !cardId) {
      setErrorMessage(text.noCard);
      return;
    }
    setWorking(true);
    setErrorMessage('');
    try {
      const personalAmountCents = owner === 'SHARED'
        ? Math.min(activeTransaction.amountCents, Math.max(0, Math.round(parseAmount(personalAmount) * 100)))
        : undefined;
      await onReview(activeTransaction, {
        outcome,
        category,
        owner,
        personalAmountCents,
        thirdPartyName: thirdPartyName.trim() || undefined,
        cardId: cardId || undefined,
      });
      const nextTransaction = transactions.find((transaction) => (
        transaction.providerTransactionId !== activeTransaction.providerTransactionId
      ));
      if (nextTransaction) {
        setActiveId(nextTransaction.providerTransactionId);
        resetReview(nextTransaction);
      } else {
        setOpen(false);
        setActiveId(null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : text.error);
    } finally {
      setWorking(false);
    }
  };

  if (transactions.length === 0) return null;

  return (
    <div style={{ background: '#111520', border: '1px solid #1e2a3e', borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong style={{ display: 'block', color: '#dbeafe', fontSize: 12 }}>{text.pending}</strong>
          <small style={{ color: '#93a3b8' }}>{transactions.length}</small>
        </div>
        <button type="button" className="settings-action" style={{ width: 'auto', padding: '8px 12px' }} onClick={() => { setActiveId(transactions[0].providerTransactionId); resetReview(transactions[0]); setOpen(true); }}>
          <span>{text.review}</span><span className="settings-action-arrow">→</span>
        </button>
      </div>

      {open && activeTransaction && (
        <div className="confirm-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            ref={dialogRef}
            className="confirm-card theme-confirm"
            role="dialog"
            aria-modal="true"
            aria-label={text.title}
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 520, width: 'calc(100vw - 32px)', maxHeight: '90vh', overflowY: 'auto' }}
          >
            <h2 className="confirm-title" style={{ margin: '0 0 8px', color: '#e0e0e0', fontSize: 16 }}>{text.title}</h2>
            <p style={{ margin: '0 0 14px', color: '#a3a3a3', fontSize: 12, lineHeight: 1.5 }}>{text.bankSync}</p>
            <div style={{ background: '#0d0d0d', border: '1px solid #242424', borderRadius: 8, padding: 12, marginBottom: 14 }}>
              <strong style={{ color: '#f0f0f0', fontSize: 14 }}>{activeTransaction.merchant}</strong>
              <div style={{ color: '#c4c4c4', fontSize: 13, marginTop: 6 }}>
                {hideValues ? 'R$ ••••' : formatMoney(activeTransaction.amountCents / 100)}
                {' · '}{activeTransaction.date}
                {activeTransaction.installmentTotal > 1
                  ? ` · ${activeTransaction.installmentCurrent}/${activeTransaction.installmentTotal}`
                  : ''}
              </div>
              <small style={{ display: 'block', color: '#777', marginTop: 6 }}>
                {text.account}: {activeTransaction.accountName}
                {activeTransaction.cardLast4 ? ` · ${activeTransaction.cardLast4}` : ''}
              </small>
              <small style={{ display: 'block', color: '#777', marginTop: 4 }}>
                {text.invoice}: {invoiceMonthLabel(activeTransaction.billMonth, locale)}
              </small>
              {activeTransaction.statementTotalCents !== undefined && (
                <small style={{ display: 'block', color: '#777', marginTop: 4 }}>
                  {text.billTotal}: {hideValues ? 'R$ ••••' : formatMoney(activeTransaction.statementTotalCents / 100)}
                </small>
              )}
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ color: '#aaa', fontSize: 11 }}>
                {t('card')}
                <div style={{ marginTop: 5 }}>
                  <CardSelect userId={userId} cards={paymentCards} value={cardId} onChange={setCardId} ariaLabel={t('selectCardAria')} style={fieldStyle} />
                </div>
              </label>
              <label style={{ color: '#aaa', fontSize: 11 }}>
                {t('category')}
                <div style={{ marginTop: 5 }}>
                  <CategorySelect value={category} onChange={setCategory} ariaLabel={t('categoryAria')} style={fieldStyle} />
                </div>
              </label>
              <label style={{ color: '#aaa', fontSize: 11 }}>
                {t('responsibility')}
                <select value={owner} onChange={(event) => setOwner(event.target.value as ExpenseOwner)} style={{ ...fieldStyle, marginTop: 5 }}>
                  <option value="ME">{t('me')}</option>
                  <option value="THIRD_PARTY">{t('thirdParty')}</option>
                  <option value="SHARED">{t('shared')}</option>
                </select>
              </label>
              {owner === 'THIRD_PARTY' && (
                <label style={{ color: '#aaa', fontSize: 11 }}>
                  {text.thirdPartyName}
                  <input value={thirdPartyName} onChange={(event) => setThirdPartyName(event.target.value)} style={{ ...fieldStyle, marginTop: 5 }} />
                </label>
              )}
              {owner === 'SHARED' && (
                <>
                  <label style={{ color: '#aaa', fontSize: 11 }}>
                    {text.sharedAmount}
                    <input
                      inputMode="decimal"
                      value={personalAmount}
                      onChange={(event) => setPersonalAmount(event.target.value.replace(/[^0-9.,]/g, ''))}
                      style={{ ...fieldStyle, marginTop: 5 }}
                    />
                  </label>
                  <label style={{ color: '#aaa', fontSize: 11 }}>
                    {text.thirdPartyName}
                    <input value={thirdPartyName} onChange={(event) => setThirdPartyName(event.target.value)} style={{ ...fieldStyle, marginTop: 5 }} />
                  </label>
                </>
              )}
            </div>

            {duplicateMatch && (
              <div style={{ background: '#241a0b', border: '1px solid #5a3b12', borderRadius: 6, padding: 9, color: '#f59e0b', fontSize: 11, marginTop: 12 }}>
                <strong>{text.duplicate}</strong>
                <div style={{ color: '#d9a441', marginTop: 4 }}>
                  {describeDuplicateMatch(duplicateMatch, formatMoney, t)}
                </div>
              </div>
            )}
            {errorMessage && <div role="alert" style={{ color: '#f87171', fontSize: 12, marginTop: 10 }}>{errorMessage}</div>}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="confirm-cancel" onClick={() => setOpen(false)} disabled={working}>{text.close}</button>
              <button type="button" className="confirm-cancel" onClick={() => void submitReview('dismissed')} disabled={working}>
                {text.dismiss}
              </button>
              {duplicateMatch && (
                <button type="button" className="confirm-cancel" onClick={() => void submitReview('duplicate')} disabled={working}>
                  {text.markDuplicate}
                </button>
              )}
              <button type="button" className="confirm-submit" onClick={() => void submitReview('imported')} disabled={working || !cardId}>
                {working ? t('loading') : duplicateMatch ? text.addAnyway : text.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
