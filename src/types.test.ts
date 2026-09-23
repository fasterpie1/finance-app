import { describe, expect, it } from 'vitest';
import { formatCurrency, formatMonthShort, getBillReminderStart, getMonthIndex, parseBRL } from './types';
import { normalizePreferences } from './i18n';
import { getBillNotifications, getMonthsFrom } from './store/useDashboard';
import type { BudgetMonth } from './types';
import { getInvoicePersonalTotalCents, getInvoiceTotalCents, getPersonalImpactCents } from './services/cardTransactions';
import { extractStatementTotalCents } from './services/statementTotals';
import { parsePdfTransactionFallback, parseExtractedPurchases } from './services/statementParser';
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

  it('computes the invoice total from charges, excluding payments and netting refunds', () => {
    const invoice: CreditCardInvoice = {
      id: 'i1', month: 'Agosto', year: 2026, transactions: [
        transaction({ amountCents: 10000, type: 'PURCHASE' }),
        transaction({ id: 't2', amountCents: 5000, type: 'REFUND' }),
        transaction({ id: 't3', amountCents: 3000, type: 'PAYMENT' }),
      ],
    };
    // 10000 purchase − 5000 refund = 5000; the 3000 payment is not a charge.
    expect(getInvoiceTotalCents(invoice)).toBe(5000);
  });

  it('prefers the official statement total over the computed fallback', () => {
    const invoice: CreditCardInvoice = {
      id: 'i1', month: 'Agosto', year: 2026, statementTotalCents: 7777, transactions: [
        transaction({ amountCents: 10000, type: 'PURCHASE' }),
      ],
    };
    expect(getInvoiceTotalCents(invoice)).toBe(7777);
  });

  it('extracts the official statement total instead of summing payments', () => {
    expect(extractStatementTotalCents('Inclusao de Pagamento 3.455,09\nTotal a pagar R$ 3.251,16')).toBe(325116);
  });

  it('prefers the official invoice total over financing offer totals', () => {
    expect(extractStatementTotalCents(`
      Total desta fatura 2.351,61
      Total a pagar: R$ 2.270,73
      O total da sua fatura é: R$ 2.351,61
    `)).toBe(235161);
  });

  it('extracts Itaú numeric-date transactions without importing future summaries', () => {
    const parsed = parsePdfTransactionFallback(`
      Lançamentos: compras e saques
      25/01 beautyglam 08/09 56,36
      09/02 AMAZON BR 07/12 31,59
      01/08 DL*UberRidesSao PauloBR 38,72
      Compras parceladas - próximas faturas
      25/01 beautyglam 09/09 56,36
      Próxima fatura 289,06
    `);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ name: 'beautyglam', amount: 56.36, installmentCurrent: 8, installmentTotal: 9 });
    expect(parsed[2].name).toBe('DL*UberRidesSao PauloBR');
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

  it('derives the card invoice reminder from creditCardInvoices, not legacy bills', () => {
    const months: BudgetMonth[] = [{
      id: '1', name: 'Setembro', year: 2026, income: 5000, creditCardDueDay: 10,
      bills: [],
      creditCardInvoices: [{
        id: 'inv1', month: 'Setembro', year: 2026, isPaid: false,
        transactions: [transaction({ amountCents: 20000, type: 'PURCHASE', owner: 'ME' })],
      }],
    }];
    // Setembro's invoice is due the 10th of the next month (Outubro). On Oct 8 that
    // is 2 days away — inside the 3-day notification window.
    const notifications = getBillNotifications(months, new Date(2026, 9, 8));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].name).toBe('Fatura do cartão');
    expect(notifications[0].amount).toBe(200);
    expect(notifications[0].isOverdue).toBe(false);
  });

  it('does not notify a card invoice that is already paid', () => {
    const months: BudgetMonth[] = [{
      id: '1', name: 'Setembro', year: 2026, income: 5000, creditCardDueDay: 10,
      bills: [],
      creditCardInvoices: [{
        id: 'inv1', month: 'Setembro', year: 2026, isPaid: true,
        transactions: [transaction({ amountCents: 20000, type: 'PURCHASE', owner: 'ME' })],
      }],
    }];
    expect(getBillNotifications(months, new Date(2026, 9, 8))).toHaveLength(0);
  });

  it('formats currency in Brazilian locale', () => {
    expect(formatCurrency(1234.56)).toContain('1.234,56');
    expect(getMonthIndex('Setembro')).toBe(8);
  });

  it('formats display currency without changing the stored numeric value', () => {
    const storedValue = 1234.56;
    expect(formatCurrency(storedValue, 'BRL', 'pt-BR')).toContain('R$');
    expect(formatCurrency(storedValue, 'USD', 'en-US')).toContain('$1,234.56');
    expect(formatCurrency(storedValue, 'EUR', 'en-US')).toContain('€1,234.56');
    expect(storedValue).toBe(1234.56);
    expect(formatMonthShort('Setembro', 2026, 'en')).toBe('Sep 26');
  });

  it('normalizes and falls back language and currency preferences', () => {
    expect(normalizePreferences({})).toEqual({ locale: 'pt-BR', currency: 'BRL' });
    expect(normalizePreferences({ locale: 'en', currency: 'USD' })).toEqual({ locale: 'en', currency: 'USD' });
    expect(normalizePreferences({ locale: 'fr' as 'en', currency: 'GBP' as 'USD' })).toEqual({ locale: 'pt-BR', currency: 'BRL' });
  });

  it('calculates the reminder on the previous day of the following month', () => {
    expect(getBillReminderStart('Setembro', 2026, 7)).toEqual(new Date(2026, 9, 6, 9));
    expect(getBillReminderStart('Dezembro', 2026, 1)).toEqual(new Date(2026, 11, 31, 9));
  });

  it('clamps the reminder when the due day exceeds the month length', () => {
    // Março/2026 vence em abril (30 dias): dia 31 vira 30, lembrete em 29/04.
    expect(getBillReminderStart('Março', 2026, 31)).toEqual(new Date(2026, 3, 29, 9));
    // Janeiro/2026 vence em fevereiro (28 dias): dia 31 vira 28, lembrete em 27/02.
    expect(getBillReminderStart('Janeiro', 2026, 31)).toEqual(new Date(2026, 1, 27, 9));
  });
});

describe('parseExtractedPurchases', () => {
  const parse = (purchases: unknown[]) =>
    parseExtractedPurchases(JSON.stringify({ purchases }));

  it('parses pt-BR and decimal amount strings', () => {
    const result = parse([
      { name: 'Mercado', amount: '1.234,56', type: 'PURCHASE' },
      { name: 'Farmácia', amount: '89.90', type: 'PURCHASE' },
      { name: 'Loja', amount: 42.5, type: 'PURCHASE' },
    ]);
    expect(result.map((p) => p.amount)).toEqual([1234.56, 89.9, 42.5]);
  });

  it('prefers explicit installment numbers over a date-like name', () => {
    const [purchase] = parse([
      { name: 'Compra 08/09/2026', amount: 50, installmentCurrent: 1, installmentTotal: 1, type: 'PURCHASE' },
    ]);
    expect(purchase.installmentCurrent).toBe(1);
    expect(purchase.installmentTotal).toBe(1);
  });

  it('falls back to name-encoded installments when none are explicit', () => {
    const [purchase] = parse([
      { name: 'beautyglam 8/9', amount: '56,36', type: 'PURCHASE' },
    ]);
    expect(purchase.installmentCurrent).toBe(8);
    expect(purchase.installmentTotal).toBe(9);
    expect(purchase.name).toBe('beautyglam');
  });
});
