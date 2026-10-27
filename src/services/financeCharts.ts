import type { Bill, BudgetMonth, CategoryId, CreditCardInvoice } from '../types';
import { amountToCents, getCardCharges, getTransactionCategoryImpactCents, isOnCreditCardBill } from './cardTransactions';

export interface CategoryChartItem {
  category: CategoryId;
  cents: number;
  percentage: number;
}

export interface CategoryChartData {
  totalCents: number;
  items: CategoryChartItem[];
}

export type CardChartMonth = Pick<BudgetMonth, 'id' | 'name' | 'year' | 'bills' | 'creditCardInvoices'>;

export type ChartSource = 'all' | 'card' | 'account';
export type LineChartSource = Exclude<ChartSource, 'all'>;

/**
 * 'account' é o que sai da conta (Pix/débito/boleto): contas não vinculadas ao cartão e as
 * lançadas como Débito/Pix. 'card' é o que o cartão cobra: faturas + contas pendentes do cartão.
 */
export function getCategoryChartData(bills: Bill[], invoices: CreditCardInvoice[] = [], source: ChartSource = 'all'): CategoryChartData {
  const centsByCategory = new Map<CategoryId, number>();
  const add = (category: CategoryId, cents: number) => {
    if (cents !== 0) centsByCategory.set(category, (centsByCategory.get(category) ?? 0) + cents);
  };

  if (source !== 'card') {
    bills.forEach((bill) => {
      if (!isOnCreditCardBill(bill)) add(bill.category, amountToCents(bill.amount));
    });
  }
  if (source !== 'account') {
    getCardCharges(invoices, bills).pendingBills.forEach((bill) => add(bill.category, amountToCents(bill.amount)));
    invoices.flatMap((invoice) => invoice.transactions).forEach((transaction) => {
      if (transaction.category) add(transaction.category, getTransactionCategoryImpactCents(transaction));
    });
  }

  const totalCents = [...centsByCategory.values()].reduce((sum, cents) => sum + cents, 0);
  const items = [...centsByCategory.entries()]
    .map(([category, cents]) => ({ category, cents, percentage: totalCents === 0 ? 0 : (cents / totalCents) * 100 }))
    .sort((a, b) => b.cents - a.cents);
  return { totalCents, items };
}

export function getCardChartCategories(months: Array<Pick<CardChartMonth, 'bills' | 'creditCardInvoices'>>, source: LineChartSource = 'card'): CategoryId[] {
  const categories = new Set<CategoryId>();
  months.forEach((month) => {
    if (source === 'account') {
      month.bills.forEach((bill) => {
        if (!isOnCreditCardBill(bill)) categories.add(bill.category);
      });
      return;
    }
    getCardCharges(month.creditCardInvoices ?? [], month.bills).pendingBills.forEach((bill) => categories.add(bill.category));
    (month.creditCardInvoices ?? []).flatMap((invoice) => invoice.transactions).forEach((transaction) => {
      if (transaction.category) categories.add(transaction.category);
    });
  });
  return [...categories];
}

export function getCardCategoryAmountCents(month: Pick<CardChartMonth, 'bills' | 'creditCardInvoices'>, category: CategoryId, source: LineChartSource = 'card'): number {
  if (source === 'account') {
    return month.bills
      .filter((bill) => !isOnCreditCardBill(bill) && bill.category === category)
      .reduce((total, bill) => total + amountToCents(bill.amount), 0);
  }
  const pendingBillCents = getCardCharges(month.creditCardInvoices ?? [], month.bills).pendingBills
    .filter((bill) => bill.category === category)
    .reduce((total, bill) => total + amountToCents(bill.amount), 0);
  const invoiceCents = (month.creditCardInvoices ?? []).flatMap((invoice) => invoice.transactions)
    .filter((transaction) => transaction.category === category)
    .reduce((total, transaction) => total + getTransactionCategoryImpactCents(transaction), 0);
  return pendingBillCents + invoiceCents;
}

export function getCardChartMonths<T extends CardChartMonth>(months: T[], selectedMonthName: string, selectedMonthYear: number): T[] {
  const selectedIndex = months.findIndex((month) => month.name.toLowerCase() === selectedMonthName.toLowerCase() && month.year === selectedMonthYear);
  return months.slice(0, selectedIndex >= 0 ? selectedIndex + 1 : months.length).slice(-4);
}