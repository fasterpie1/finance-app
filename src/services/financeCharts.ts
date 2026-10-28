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

export interface CategoryAnomaly {
  ratio: number;
  averageCents: number;
}

/** Meses de histórico necessários para "média" significar alguma coisa. */
const MIN_PREVIOUS_MONTHS = 2;
/** Dobro da média já é um mês fora do costume. */
const ANOMALY_RATIO = 2;
/** R$ 50 de diferença: abaixo disso a categoria é pequena demais para o aviso valer o ruído. */
const ANOMALY_MIN_DIFF_CENTS = 5000;

/**
 * Compara cada categoria do mês aberto com a média dela nos meses anteriores. Categoria que
 * nunca apareceu fica fora: não há costume a comparar, e marcá-la seria chamar novidade de anomalia.
 */
export function getCategoryAnomalies(
  current: CategoryChartData,
  previousMonths: Array<Pick<BudgetMonth, 'bills' | 'creditCardInvoices'>>,
  source: ChartSource,
): Map<CategoryId, CategoryAnomaly> {
  const anomalies = new Map<CategoryId, CategoryAnomaly>();
  if (previousMonths.length < MIN_PREVIOUS_MONTHS) return anomalies;

  const sumByCategory = new Map<CategoryId, number>();
  previousMonths.forEach((month) => {
    getCategoryChartData(month.bills, month.creditCardInvoices ?? [], source).items.forEach((item) => {
      sumByCategory.set(item.category, (sumByCategory.get(item.category) ?? 0) + item.cents);
    });
  });

  current.items.forEach((item) => {
    const previousSum = sumByCategory.get(item.category);
    if (!previousSum) return;
    const averageCents = previousSum / previousMonths.length;
    const ratio = item.cents / averageCents;
    if (ratio >= ANOMALY_RATIO && item.cents - averageCents >= ANOMALY_MIN_DIFF_CENTS) {
      anomalies.set(item.category, { ratio, averageCents });
    }
  });
  return anomalies;
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

export function getCardChartMonths<T extends CardChartMonth>(months: T[], selectedMonthName: string, selectedMonthYear: number, count = 4): T[] {
  const selectedIndex = months.findIndex((month) => month.name.toLowerCase() === selectedMonthName.toLowerCase() && month.year === selectedMonthYear);
  return months.slice(0, selectedIndex >= 0 ? selectedIndex + 1 : months.length).slice(-count);
}