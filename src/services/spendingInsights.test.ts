import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bill, BudgetMonth, CreditCardInvoice, CreditCardTransaction } from '../types';
import { getCardCharges } from './cardTransactions';
import * as financeCharts from './financeCharts';
import type { ChartSource } from './financeCharts';
import {
  getCategoryChanges,
  getCategoryLimitState,
  getDailySpending,
  getPreviousCalendarMonth,
  getSmallPurchases,
  getSpendingEntries,
  isMonthInProgress,
  parseExpenseDate,
} from './spendingInsights';

// All fixtures are synthetic; no storage, environment, network, or real financial data.
const sources: ChartSource[] = ['account', 'card', 'all'];

function bill(id: string, overrides: Partial<Bill> = {}): Bill {
  return {
    id,
    name: `Synthetic ${id}`,
    category: 'alimentacao',
    amount: 20,
    dueDay: 28,
    type: 'variavel',
    isPaid: false,
    month: 'Janeiro',
    note: '',
    purchaseDate: '05/01',
    ...overrides,
  };
}

function transaction(id: string, overrides: Partial<CreditCardTransaction> = {}): CreditCardTransaction {
  return {
    id,
    invoiceId: 'invoice-a',
    merchant: `Synthetic ${id}`,
    amountCents: 2000,
    type: 'PURCHASE',
    owner: 'ME',
    category: 'alimentacao',
    date: '05/01',
    ...overrides,
  };
}

function invoice(transactions: CreditCardTransaction[], overrides: Partial<CreditCardInvoice> = {}): CreditCardInvoice {
  return { id: 'invoice-a', month: 'Janeiro', year: 2026, cardId: 'card-a', transactions, ...overrides };
}

function month(overrides: Partial<BudgetMonth> = {}): BudgetMonth {
  return { id: 'month-a', name: 'Janeiro', year: 2026, income: 0, bills: [], creditCardInvoices: [], ...overrides };
}

function sum(entries: ReadonlyArray<{ cents: number }>): number {
  return entries.reduce((total, entry) => total + entry.cents, 0);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

function personalMonth(): BudgetMonth {
  return month({
    bills: [
      bill('account', { amount: 12.34 }),
      bill('pending', { name: 'Papelaria Horizonte', amount: 25, isOnCreditCard: true, cardId: 'card-a' }),
      bill('matched', { name: 'Mercado Aurora', amount: 100, isOnCreditCard: true, cardId: 'card-a' }),
      bill('debit', { amount: 8.5, isOnCreditCard: true, cardPaymentMethod: 'debito_pix' }),
    ],
    creditCardInvoices: [invoice([
      transaction('shared', { merchant: 'MERCADO AURORA', amountCents: 10000, owner: 'SHARED', personalAmountCents: 4000 }),
      transaction('mine', { amountCents: 1111 }),
      transaction('refund', { amountCents: 333, type: 'REFUND' }),
      transaction('shared-refund', { amountCents: 500, type: 'REFUND', owner: 'SHARED', personalAmountCents: 123 }),
      transaction('payment', { amountCents: 99999, type: 'PAYMENT' }),
      transaction('third-party', { owner: 'THIRD_PARTY' }),
      transaction('third-party-refund', { owner: 'THIRD_PARTY', type: 'REFUND' }),
      transaction('unclassified', { owner: 'UNCLASSIFIED' }),
      transaction('shared-no-personal', { owner: 'SHARED' }),
      transaction('shared-zero', { owner: 'SHARED', personalAmountCents: 0 }),
      transaction('shared-negative', { owner: 'SHARED', personalAmountCents: -100 }),
      transaction('zero', { amountCents: 0 }),
    ])],
  });
}

function dailyMonth(): BudgetMonth {
  return month({
    name: 'Fevereiro',
    year: 2024,
    bills: [
      bill('dated', { month: 'Fevereiro', amount: 10.01, purchaseDate: '01/02', dueDay: 28 }),
      bill('undated', { month: 'Fevereiro', amount: 40, type: 'fixa', purchaseDate: undefined, dueDay: 15 }),
      bill('invalid', { month: 'Fevereiro', amount: 25, purchaseDate: '31/02' }),
      bill('installment', { month: 'Fevereiro', category: 'financiamento', amount: 70, type: 'parcela', purchaseDate: '02/02' }),
      bill('installment-total', { month: 'Fevereiro', amount: 30, installmentTotal: 3, purchaseDate: undefined, cardPaymentMethod: 'debito_pix' }),
    ],
    creditCardInvoices: [invoice([
      transaction('leap', { amountCents: 5000, date: '29/02' }),
      transaction('refund', { amountCents: 1000, type: 'REFUND', date: '2024-02-29T23:30:00-03:00' }),
      transaction('installment', { amountCents: 6000, type: 'INSTALLMENT', date: '02/02' }),
      transaction('installment-total', { amountCents: 2000, installmentTotal: 4, date: undefined }),
      transaction('previous-period', { amountCents: 2000, date: '31/01' }),
      transaction('future-period', { amountCents: 3000, date: '2024-03-01' }),
      transaction('undated', { amountCents: 1500, date: undefined }),
      transaction('invalid', { amountCents: 1200, date: '2023-02-29' }),
    ], { month: 'Fevereiro', year: 2024, dueDate: '2024-03-15' })],
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('getSpendingEntries', () => {
  it('uses my shared portion, negative refunds, and excludes payments, zeroes and non-personal owners', () => {
    expect(getSpendingEntries(personalMonth()).map(({ id, cents, source }) => ({ id, cents, source }))).toStrictEqual([
      { id: 'bill:account', cents: 1234, source: 'account' },
      { id: 'bill:debit', cents: 850, source: 'account' },
      { id: 'bill:pending', cents: 2500, source: 'card' },
      { id: 'invoice:invoice-a:shared', cents: 4000, source: 'card' },
      { id: 'invoice:invoice-a:mine', cents: 1111, source: 'card' },
      { id: 'invoice:invoice-a:refund', cents: -333, source: 'card' },
      { id: 'invoice:invoice-a:shared-refund', cents: -123, source: 'card' },
    ]);
  });

  it.each([
    ['account', 2084, ['bill:account', 'bill:debit']],
    ['card', 7155, ['bill:pending', 'invoice:invoice-a:shared', 'invoice:invoice-a:mine', 'invoice:invoice-a:refund', 'invoice:invoice-a:shared-refund']],
    ['all', 9239, ['bill:account', 'bill:debit', 'bill:pending', 'invoice:invoice-a:shared', 'invoice:invoice-a:mine', 'invoice:invoice-a:refund', 'invoice:invoice-a:shared-refund']],
  ] as const)('filters %s without treating debit/Pix as credit', (source, expectedCents, ids) => {
    const entries = getSpendingEntries(personalMonth(), source);
    expect(entries.map((entry) => entry.id)).toStrictEqual([...ids]);
    expect(sum(entries)).toBe(expectedCents);
    if (source !== 'all') expect(entries.every((entry) => entry.source === source)).toBe(true);
  });

  it('uses getCardCharges deduplication once per matching transaction and respects card identity', () => {
    const budget = month({
      bills: [
        bill('matched', { name: 'Loja Aurora', amount: 45, isOnCreditCard: true, cardId: 'card-a' }),
        bill('second-purchase', { name: 'Loja Aurora', amount: 45, isOnCreditCard: true, cardId: 'card-a' }),
        bill('other-card', { name: 'Loja Aurora', amount: 45, isOnCreditCard: true, cardId: 'card-b' }),
        bill('unmatched', { name: 'Padaria Horizonte', amount: 15, isOnCreditCard: true }),
      ],
      creditCardInvoices: [invoice([transaction('imported', { merchant: 'LOJA AURORA', amountCents: 4500 })])],
    });
    const charges = getCardCharges(budget.creditCardInvoices!, budget.bills);
    expect(charges.pendingBills.map((item) => item.id)).toStrictEqual(['second-purchase', 'other-card', 'unmatched']);
    const entries = getSpendingEntries(budget, 'card');
    expect(entries.filter((entry) => entry.id.startsWith('bill:')).map((entry) => entry.id))
      .toStrictEqual(charges.pendingBills.map((item) => `bill:${item.id}`));
    expect(entries.map((entry) => entry.id)).not.toContain('bill:matched');
    expect(sum(entries)).toBe(15000);
    expect(sum(entries)).toBe(charges.personalCents);
  });

  it('deduplicates an imported installment without losing its installment classification', () => {
    const budget = month({
      bills: [bill('installment', { name: 'Moveis Horizonte', type: 'parcela', amount: 25, installmentCurrent: 2, installmentTotal: 10 })],
      creditCardInvoices: [invoice([transaction('imported', {
        merchant: 'MOVEIS HORIZONTE', amountCents: 2500, type: 'INSTALLMENT', installmentCurrent: 2, installmentTotal: 10,
      })])],
    });
    expect(getSpendingEntries(budget)).toEqual([
      expect.objectContaining({ id: 'invoice:invoice-a:imported', cents: 2500, isInstallment: true, isPurchase: false }),
    ]);
    expect(getDailySpending(budget).installmentCents).toBe(2500);
    expect(getSmallPurchases(budget).entries).toStrictEqual([]);
  });

  it('supports absent invoices and an empty month', () => {
    const budget = month({ bills: [bill('account')], creditCardInvoices: undefined });
    expect(sum(getSpendingEntries(budget))).toBe(2000);
    expect(getSpendingEntries(budget, 'card')).toStrictEqual([]);
    expect(getSpendingEntries(month())).toStrictEqual([]);
  });
});

describe('parseExpenseDate', () => {
  it.each([
    ['31/12', 'Janeiro', 2026, '2025-12-31'],
    ['1/1', 'Janeiro', 2026, '2026-01-01'],
    [' 05/01 ', 'Janeiro', 2026, '2026-01-05'],
    ['31/12', 'Dezembro', 2025, '2025-12-31'],
    ['01/01', 'Dezembro', 2025, '2025-01-01'],
    ['31/12/2026', 'Janeiro', 2026, '2026-12-31'],
    ['01/01/2025', 'Janeiro', 2026, '2025-01-01'],
    ['2025-12-31', 'Janeiro', 2026, '2025-12-31'],
    ['2026-01-01T00:30:00+02:00', 'Janeiro', 2026, '2026-01-01'],
    ['2025-12-31T23:30:00-03:00', 'Janeiro', 2026, '2025-12-31'],
    ['29/02', 'Fevereiro', 2024, '2024-02-29'],
    ['29/02/2000', 'Janeiro', 2026, '2000-02-29'],
    ['2024-02-29', 'Fevereiro', 2024, '2024-02-29'],
    ['28/02/1900', 'Janeiro', 2026, '1900-02-28'],
    ['31/12/9999', 'Janeiro', 2026, '9999-12-31'],
  ] as const)('parses %s against %s %i without timezone rollover', (value, name, year, expected) => {
    expect(parseExpenseDate(value, name, year)).toBe(expected);
  });

  it.each([
    undefined, '', '   ', 'garbage', '2024/02/29', '29-02-2024',
    '00/01', '32/01', '31/04', '31/06', '31/09', '31/11', '30/02',
    '01/00', '01/13', '2024-00-01', '2024-13-01', '2024-01-00',
    '2024-01-32', '2024-04-31', '2023-02-29', '29/02/2023',
    '1900-02-29', '29/02/1900', '2100-02-29', '29/02/2100',
    '01/01/1899', '1899-01-01', '01/01/10000', '10000-01-01',
  ])('rejects missing, malformed or impossible date %s', (value) => {
    expect(parseExpenseDate(value, 'Fevereiro', 2024)).toBeUndefined();
  });

  it('validates the inferred year for a February date in a January invoice', () => {
    expect(parseExpenseDate('29/02', 'Janeiro', 2025)).toBe('2024-02-29');
    expect(parseExpenseDate('29/02', 'Janeiro', 2024)).toBeUndefined();
    expect(parseExpenseDate('29/02', 'Fevereiro', 2023)).toBeUndefined();
  });
});

describe('getDailySpending', () => {
  it.each([
    ['account', 1001, 6500, 10000, 0],
    ['card', 4000, 2700, 8000, 5000],
    ['all', 5001, 9200, 18000, 5000],
  ] as const)('reconciles dated days plus mutually exclusive exclusions for %s', (source, totalCents, undatedCents, installmentCents, outsidePeriodCents) => {
    const budget = dailyMonth();
    const daily = getDailySpending(budget, source);
    expect(daily).toMatchObject({ totalCents, undatedCents, installmentCents, outsidePeriodCents });
    expect(daily.days).toHaveLength(29);
    expect(daily.days[0]).toMatchObject({ day: 1, date: '2024-02-01', cents: source === 'card' ? 0 : 1001 });
    expect(daily.days[28]).toMatchObject({ day: 29, date: '2024-02-29', cents: source === 'account' ? 0 : 4000 });
    expect(sum(daily.days)).toBe(totalCents);
    expect(daily.days.every((day) => sum(day.entries) === day.cents)).toBe(true);
    const included = daily.days.flatMap((day) => day.entries);
    expect(included.every((entry) => !entry.isInstallment && entry.date?.startsWith('2024-02-'))).toBe(true);
    expect(new Set(included.map((entry) => entry.id)).size).toBe(included.length);
    expect(sum(daily.days) + daily.undatedCents + daily.installmentCents + daily.outsidePeriodCents)
      .toBe(sum(getSpendingEntries(budget, source)));
  });

  it('does not invent a purchase date from dueDay or invoice dueDate', () => {
    const daily = getDailySpending(month({
      bills: [bill('undated', { amount: 20, purchaseDate: undefined, dueDay: 5 })],
      creditCardInvoices: [invoice([transaction('undated', { date: undefined })], { dueDate: '2026-01-05' })],
    }));
    expect(daily.totalCents).toBe(0);
    expect(daily.undatedCents).toBe(4000);
    expect(daily.days.every((day) => day.cents === 0 && day.entries.length === 0)).toBe(true);
  });

  it('reads legacy Debit/Pix purchase days without treating ordinary due dates as purchases', () => {
    const budget = month({ bills: [
      bill('legacy-debit', { amount: 12.34, cardPaymentMethod: 'debito_pix', purchaseDate: undefined, dueDay: 9 }),
      bill('ordinary-variable', { amount: 20, purchaseDate: undefined, dueDay: 9 }),
      bill('ordinary-fixed', { amount: 10, type: 'fixa', purchaseDate: undefined, dueDay: 9 }),
      bill('ambiguous-first-day', { amount: 8.5, cardPaymentMethod: 'debito_pix', purchaseDate: undefined, dueDay: 1 }),
      bill('explicit-first-day', { amount: 4.5, cardPaymentMethod: 'debito_pix', purchaseDate: '01/01', dueDay: 9 }),
      bill('invalid-explicit-date', { amount: 3.5, cardPaymentMethod: 'debito_pix', purchaseDate: '31/02', dueDay: 9 }),
    ] });
    const before = JSON.stringify(budget);
    deepFreeze(budget);
    const daily = getDailySpending(budget, 'account');
    expect(daily).toMatchObject({ totalCents: 1684, undatedCents: 4200, installmentCents: 0, outsidePeriodCents: 0 });
    expect(daily.days[8].entries.map((entry) => entry.id)).toEqual(['bill:legacy-debit']);
    expect(daily.days[0].cents).toBe(450);
    expect(getDailySpending(budget, 'all').totalCents).toBe(1684);
    expect(getDailySpending(budget, 'card').totalCents).toBe(0);
    expect(JSON.stringify(budget)).toBe(before);
  });

  it('rejects impossible legacy Debit/Pix days and keeps installments outside the calendar', () => {
    const budget = month({ name: 'Fevereiro', year: 2024, bills: [
      bill('invalid-day', { amount: 10, cardPaymentMethod: 'debito_pix', purchaseDate: undefined, dueDay: 31 }),
      bill('leap-day', { amount: 20, cardPaymentMethod: 'debito_pix', purchaseDate: undefined, dueDay: 29 }),
      bill('installment', { amount: 30, cardPaymentMethod: 'debito_pix', purchaseDate: undefined, dueDay: 5, installmentTotal: 2 }),
    ] });
    expect(getDailySpending(budget, 'account')).toMatchObject({ totalCents: 2000, undatedCents: 1000, installmentCents: 3000 });
  });

  it('uses invoice period for DD/MM year inference, not the containing budget or dueDate', () => {
    const budget = month({
      name: 'Dezembro', year: 2025,
      creditCardInvoices: [invoice([
        transaction('december-local', { amountCents: 2000, date: '31/12' }),
        transaction('december-iso', { amountCents: 1500, date: '2025-12-31' }),
        transaction('january', { amountCents: 500, date: '01/01' }),
      ], { month: 'Janeiro', year: 2026, dueDate: '2026-02-10' })],
    });
    expect(getSpendingEntries(budget).map((entry) => entry.date)).toStrictEqual(['2025-12-31', '2025-12-31', '2026-01-01']);
    expect(getDailySpending(budget)).toMatchObject({ totalCents: 3500, outsidePeriodCents: 500 });
  });

  it('respects recorded card purchase competence when a yearless bill date belongs to an earlier year', () => {
    const budget = month({
      bills: [bill('old-purchase', {
        amount: 20, isOnCreditCard: true, purchaseDate: '05/01',
        cardPurchaseMonth: 'Janeiro', cardPurchaseYear: 2025,
      })],
    });
    // The purchase year is explicit in Bill; the January 2026 budget is not its purchase period.
    expect.soft(getSpendingEntries(budget)[0].date).toBe('2025-01-05');
    expect.soft(getDailySpending(budget)).toMatchObject({ totalCents: 0, outsidePeriodCents: 2000 });
  });

  it('keeps refund signs in every exclusion bucket and never counts an installment twice', () => {
    const budget = month({ creditCardInvoices: [invoice([
      transaction('undated-refund', { type: 'REFUND', amountCents: 100, date: undefined }),
      transaction('outside-refund', { type: 'REFUND', amountCents: 200, date: '31/12' }),
      transaction('installment-refund', { type: 'REFUND', amountCents: 300, installmentTotal: 3, date: undefined }),
    ])] });
    const daily = getDailySpending(budget);
    expect(daily).toMatchObject({ totalCents: 0, undatedCents: -100, outsidePeriodCents: -200, installmentCents: -300 });
    expect(sum(daily.days) + daily.undatedCents + daily.outsidePeriodCents + daily.installmentCents).toBe(-600);
  });

  it.each([
    ['Janeiro', 2026, 31], ['Abril', 2026, 30], ['Fevereiro', 2023, 28],
    ['Fevereiro', 2024, 29], ['Fevereiro', 1900, 28], ['Fevereiro', 2000, 29],
  ] as const)('builds the exact calendar for %s %i', (name, year, count) => {
    const daily = getDailySpending(month({ name, year }));
    expect(daily.days).toHaveLength(count);
    expect(daily.days.map((day) => day.day)).toStrictEqual(Array.from({ length: count }, (_, index) => index + 1));
    expect(daily).toMatchObject({ totalCents: 0, undatedCents: 0, installmentCents: 0, outsidePeriodCents: 0 });
  });
});

describe('calendar comparison and category changes', () => {
  it('finds December of the previous year in unordered history, not the adjacent array element', () => {
    const current = month();
    const previous = month({ id: 'previous', name: 'Dezembro', year: 2025 });
    const history = [
      month({ id: 'future', name: 'Fevereiro' }), previous,
      month({ id: 'wrong-year', name: 'Dezembro', year: 2026 }),
      month({ id: 'older', name: 'Novembro', year: 2025 }), current,
    ];
    expect(getPreviousCalendarMonth(current, history)).toBe(previous);
    expect(getPreviousCalendarMonth(month({ name: 'Março' }), [current, history[0], previous])).toBe(history[0]);
    expect(getPreviousCalendarMonth(current, [history[2], history[3]])).toBeUndefined();
    expect(getPreviousCalendarMonth(month({ name: 'invalid' }), history)).toBeUndefined();
  });

  it('marks only the actual current calendar month, including at the year boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 12));
    expect(isMonthInProgress(month())).toBe(true);
    expect(isMonthInProgress(month({ name: 'janeiro' }))).toBe(true);
    expect(isMonthInProgress(month({ name: 'Dezembro', year: 2025 }))).toBe(false);
    expect(isMonthInProgress(month({ year: 2025 }))).toBe(false);
    expect(isMonthInProgress(month({ name: 'Fevereiro' }))).toBe(false);
    expect(isMonthInProgress(month({ name: 'invalid' }))).toBe(false);
    expect(isMonthInProgress(month({ name: 'Dezembro', year: 2025 }), new Date(2025, 11, 31, 23, 59))).toBe(true);
  });

  it.each(sources)('derives %s deltas from real getCategoryChartData, including custom/new/disappeared categories', (source) => {
    const current = month({
      bills: [
        bill('custom', { category: 'custom-hobby', amount: 33 }),
        bill('food', { amount: 30 }),
        bill('matched', { name: 'Academia Aurora', category: 'custom-fitness', amount: 22, isOnCreditCard: true }),
        bill('pending', { name: 'Farmacia Horizonte', category: 'saude', amount: 11, isOnCreditCard: true }),
        bill('debit', { category: 'transporte', amount: 2, isOnCreditCard: true, cardPaymentMethod: 'debito_pix' }),
      ],
      creditCardInvoices: [invoice([
        transaction('shared', { merchant: 'ACADEMIA AURORA', category: 'custom-fitness', amountCents: 2200, owner: 'SHARED', personalAmountCents: 1200 }),
        transaction('refund', { category: 'custom-fitness', type: 'REFUND', amountCents: 300 }),
        transaction('third-party', { category: 'alimentacao', owner: 'THIRD_PARTY', amountCents: 9000 }),
        transaction('payment', { category: 'custom-payment', type: 'PAYMENT' }),
      ])],
    });
    const previous = month({
      id: 'previous', name: 'Dezembro', year: 2025,
      bills: [
        bill('custom', { category: 'custom-hobby', amount: 50 }),
        bill('food', { amount: 10 }),
        bill('gone', { category: 'custom-retired', amount: 9 }),
        bill('unchanged', { category: 'transporte', amount: 2 }),
      ],
      creditCardInvoices: [invoice([transaction('old', { category: 'custom-fitness', amountCents: 500 })], { month: 'Dezembro', year: 2025 })],
    });
    const accountChanges = [
      { category: 'alimentacao', currentCents: 3000, previousCents: 1000, deltaCents: 2000 },
      { category: 'custom-hobby', currentCents: 3300, previousCents: 5000, deltaCents: -1700 },
      { category: 'custom-retired', currentCents: 0, previousCents: 900, deltaCents: -900 },
    ];
    const cardChanges = [
      { category: 'saude', currentCents: 1100, previousCents: 0, deltaCents: 1100 },
      { category: 'custom-fitness', currentCents: 900, previousCents: 500, deltaCents: 400 },
    ];
    const expected = source === 'account' ? accountChanges : source === 'card' ? cardChanges
      : [accountChanges[0], accountChanges[1], cardChanges[0], accountChanges[2], cardChanges[1]];
    const currentChart = financeCharts.getCategoryChartData(current.bills, current.creditCardInvoices, source);
    const previousChart = financeCharts.getCategoryChartData(previous.bills, previous.creditCardInvoices, source);
    const chartSpy = vi.spyOn(financeCharts, 'getCategoryChartData');
    const changes = getCategoryChanges(current, previous, source);
    expect(changes).toStrictEqual(expected);
    expect(chartSpy).toHaveBeenCalledTimes(2);
    expect(chartSpy).toHaveBeenCalledWith(current.bills, current.creditCardInvoices, source);
    expect(chartSpy).toHaveBeenCalledWith(previous.bills, previous.creditCardInvoices, source);
    for (const change of changes) {
      expect(change.currentCents).toBe(currentChart.items.find((item) => item.category === change.category)?.cents ?? 0);
      expect(change.previousCents).toBe(previousChart.items.find((item) => item.category === change.category)?.cents ?? 0);
    }
    expect(changes.some((item) => item.category === 'transporte' || item.category === 'custom-payment')).toBe(false);
  });

  it('includes net-negative categories and returns no changes for identical spending', () => {
    const current = month({ creditCardInvoices: [invoice([transaction('refund', { type: 'REFUND', category: 'custom-refund', amountCents: 250 })])] });
    expect(getCategoryChanges(current, month())).toStrictEqual([
      { category: 'custom-refund', currentCents: -250, previousCents: 0, deltaCents: -250 },
    ]);
    expect(getCategoryChanges(current, current)).toStrictEqual([]);
  });
});

describe('getSmallPurchases', () => {
  it('includes at most R$30 of my share and excludes fixed, monthly, installment, refund and non-personal rows', () => {
    const budget = month({
      bills: [
        ...[10, 20, 30].map((amount, index) => bill(`small-${index}`, { amount })),
        bill('over-threshold', { amount: 30.01 }),
        bill('fixed', { type: 'fixa' }),
        bill('monthly', { type: 'mensal' }),
        bill('installment', { type: 'parcela', category: 'financiamento' }),
        bill('installment-total', { installmentTotal: 2 }),
        bill('zero', { amount: 0 }),
        bill('negative', { amount: -20 }),
      ],
      creditCardInvoices: [invoice([
        transaction('shared', { amountCents: 10000, owner: 'SHARED', personalAmountCents: 2000 }),
        transaction('mine', { amountCents: 2000 }),
        transaction('over-threshold', { amountCents: 3001 }),
        transaction('installment', { type: 'INSTALLMENT' }),
        transaction('installment-total', { installmentTotal: 2 }),
        transaction('refund', { type: 'REFUND' }),
        transaction('payment', { type: 'PAYMENT' }),
        transaction('third-party', { owner: 'THIRD_PARTY' }),
        transaction('unclassified', { owner: 'UNCLASSIFIED' }),
      ])],
    });
    const small = getSmallPurchases(budget);
    expect(small.entries.map((entry) => entry.id)).toStrictEqual([
      'bill:small-0', 'bill:small-1', 'bill:small-2', 'invoice:invoice-a:shared', 'invoice:invoice-a:mine',
    ]);
    expect(small).toMatchObject({ totalCents: 10000, thresholdCents: 3000, visible: true });
  });

  it.each([
    [[2500, 2500, 2500, 2500], false],
    [[2000, 2000, 2000, 2000, 1999], false],
    [[2000, 2000, 2000, 2000, 2000], true],
    [[3000, 3000, 3000, 3000, 3000], true],
    [[], false],
  ] as const)('requires both five purchases and 100 BRL: %j', (amounts, visible) => {
    const budget = month({ bills: amounts.map((cents, index) => bill(`small-${index}`, { amount: cents / 100 })) });
    const small = getSmallPurchases(budget);
    expect(small.entries).toHaveLength(amounts.length);
    expect(small.totalCents).toBe(amounts.reduce((total, cents) => total + cents, 0));
    expect(small.visible).toBe(visible);
  });

  it.each([
    ['account', 5, 10000, true], ['card', 4, 8000, false], ['all', 9, 18000, true],
  ] as const)('applies the %s source before count and total visibility checks', (source, count, totalCents, visible) => {
    const budget = month({
      bills: Array.from({ length: 5 }, (_, index) => bill(`account-${index}`)),
      creditCardInvoices: [invoice(Array.from({ length: 4 }, (_, index) => transaction(`card-${index}`)))],
    });
    const small = getSmallPurchases(budget, source);
    expect(small.entries).toHaveLength(count);
    expect(small).toMatchObject({ totalCents, visible });
  });

  it('honors a custom inclusive threshold', () => {
    const budget = month({ bills: [bill('at-limit', { amount: 10 }), bill('over-limit', { amount: 10.01 })] });
    expect(getSmallPurchases(budget, 'all', 1000)).toMatchObject({
      entries: [expect.objectContaining({ id: 'bill:at-limit', cents: 1000 })],
      thresholdCents: 1000, totalCents: 1000, visible: false,
    });
  });

  it('does not turn a fixed card bill into a small purchase after invoice deduplication', () => {
    const budget = month({
      bills: [
        ...Array.from({ length: 4 }, (_, index) => bill(`one-off-${index}`, { amount: 25 })),
        bill('fixed-card', { name: 'Cloud Aurora', type: 'fixa', amount: 20, isOnCreditCard: true }),
      ],
      creditCardInvoices: [invoice([transaction('fixed-imported', { merchant: 'CLOUD AURORA', amountCents: 2000 })])],
    });
    expect(getCardCharges(budget.creditCardInvoices!, budget.bills).pendingBills).toStrictEqual([]);
    // An imported bank PURCHASE must not erase the known fixed-bill classification.
    const small = getSmallPurchases(budget);
    expect({ ids: small.entries.map((entry) => entry.id), totalCents: small.totalCents, visible: small.visible }).toStrictEqual({
      ids: ['bill:one-off-0', 'bill:one-off-1', 'bill:one-off-2', 'bill:one-off-3'],
      totalCents: 10000,
      visible: false,
    });
  });
});

describe('getCategoryLimitState', () => {
  it.each([
    [0, 'normal', 10000],
    [7999, 'normal', 2001],
    [8000, 'near', 2000],
    [8001, 'near', 1999],
    [10000, 'near', 0],
    [10001, 'over', -1],
    [-1000, 'normal', 11000],
  ] as const)('classifies %i cents against a 100 BRL limit as %s', (spent, status, remainingCents) => {
    expect(getCategoryLimitState(spent, 10000)).toStrictEqual({ ratio: spent / 10000, remainingCents, status });
  });
});

describe('input immutability', () => {
  it('does not mutate either month, nested data, custom limits, or unordered history', () => {
    const current = personalMonth();
    current.categoryLimitsCents = { alimentacao: 10000, 'custom-hobby': 20000 };
    const previous = dailyMonth();
    const history = [previous, month({ id: 'previous', name: 'Dezembro', year: 2025 }), current];
    const before = JSON.parse(JSON.stringify({ current, previous, history }));
    deepFreeze({ current, previous, history });
    for (const source of sources) {
      getSpendingEntries(current, source);
      getDailySpending(current, source);
      getSmallPurchases(current, source);
      getCategoryChanges(current, previous, source);
    }
    getPreviousCalendarMonth(current, history);
    isMonthInProgress(current, new Date(2026, 0, 1));
    getCategoryLimitState(8000, current.categoryLimitsCents.alimentacao!);
    expect({ current, previous, history }).toEqual(before);
  });
});
