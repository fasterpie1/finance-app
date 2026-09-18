import { describe, expect, it } from 'vitest';
import { formatCurrency, getBillReminderStart, getMonthIndex, parseBRL } from './types';
import { getBillNotifications, getMonthsFrom } from './store/useDashboard';
import type { BudgetMonth } from './types';
import { getInvoicePersonalTotalCents, getPersonalImpactCents } from './services/cardTransactions';
import { extractStatementTotalCents } from './services/statementTotals';
import { findDuplicateTransaction } from './services/transactionDuplicates';
import type { CreditCardInvoice, CreditCardTransaction } from './types';

describe('financial helpers', () => {
  const transaction = (overrides: Partial<CreditCardTransaction> = {}): CreditCardTransaction => ({
    id: 't1', invoiceId: 'i1', merchant: 'Teste', amountCents: 10000, type: 'PURCHASE', owner: 'ME', ...overrides,
  });

  it('calculates personal impact by responsibility and transaction type', () => {
    expect(getPersonalImpactCents(transaction())).toBe(10000);
    expect(getPersonalImpactCents(transaction({ owner: 'THIRD_PARTY' }))).toBe(0);
    expect(getPersonalImpactCents(transaction({ owner: 'UNCLASSIFIED' }))).toBe(0);
    expect(getPersonalImpactCents(transaction({ owner: 'SHARED', personalAmountCents: 3200 }))).toBe(3200);
    expect(getPersonalImpactCents(transaction({ type: 'PAYMENT' }))).toBe(0);
    expect(getPersonalImpactCents(transaction({ type: 'REFUND' }))).toBe(-10000);
  });

  it('does not double count installments and keeps invoice totals separate', () => {
    const invoice: CreditCardInvoice = {
      id: 'i1', month: 'Agosto', year: 2026, transactions: [
        transaction({ amountCents: 24999, type: 'INSTALLMENT', installmentCurrent: 2, installmentTotal: 2 }),
        transaction({ id: 't2', amountCents: 50000, owner: 'THIRD_PARTY' }),
      ],
    };
    expect(getInvoicePersonalTotalCents(invoice)).toBe(24999);
  });

  it('extracts the official statement total instead of summing payments', () => {
    expect(extractStatementTotalCents('Inclusao de Pagamento 3.455,09\nTotal a pagar R$ 3.251,16')).toBe(325116);
  });

  it('identifies duplicate transactions without relying on the merchant name', () => {
    const existing = [transaction({ date: '19 jul', cardLast4: '6852', installmentCurrent: 1, installmentTotal: 1 })];
    expect(findDuplicateTransaction({ amountCents: 10000, type: 'PURCHASE', date: '19 jul', cardLast4: '6852' }, existing)?.confidence).toBe('high');
    expect(findDuplicateTransaction({ amountCents: 10000, type: 'PURCHASE' }, existing)?.confidence).toBe('possible');
    expect(findDuplicateTransaction({ amountCents: 9999, type: 'PURCHASE' }, existing)).toBeUndefined();
  });
  it('parses Brazilian currency formats', () => {
    expect(parseBRL('1.234,56')).toBe(1234.56);
    expect(parseBRL('89,90')).toBe(89.9);
    expect(parseBRL('')).toBe(0);
  });

  it('creates consecutive months across a year boundary', () => {
    expect(getMonthsFrom('Novembro', 2026, 3)).toEqual([
      { name: 'Novembro', year: 2026 },
      { name: 'Dezembro', year: 2026 },
      { name: 'Janeiro', year: 2027 },
    ]);
  });

  it('notifies only unpaid bills due within three days', () => {
    const months: BudgetMonth[] = [{ id: '1', name: 'Setembro', year: 2026, income: 5000, bills: [
      { id: 'late', name: 'Conta atrasada', category: 'internet', amount: 100, dueDay: 10, type: 'mensal', isPaid: false, month: 'Setembro', note: '' },
      { id: 'paid', name: 'Conta paga', category: 'luz', amount: 50, dueDay: 10, type: 'mensal', isPaid: true, month: 'Setembro', note: '' },
    ] }];
    const notifications = getBillNotifications(months, new Date(2026, 9, 11));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].name).toBe('Conta atrasada');
    expect(notifications[0].isOverdue).toBe(true);
  });

  it('formats currency in Brazilian locale', () => {
    expect(formatCurrency(1234.56)).toContain('1.234,56');
    expect(getMonthIndex('Setembro')).toBe(8);
  });

  it('calculates the reminder on the previous day of the following month', () => {
    expect(getBillReminderStart('Setembro', 2026, 7)).toEqual(new Date(2026, 9, 6, 9));
    expect(getBillReminderStart('Dezembro', 2026, 1)).toEqual(new Date(2026, 11, 31, 9));
  });
});
