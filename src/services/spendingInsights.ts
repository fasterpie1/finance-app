import { getMonthIndex, type BudgetMonth, type CategoryId } from '../types';
import { amountToCents, getCardCharges, getPersonalImpactCents, getUnimportedCardBills, isOnCreditCardBill } from './cardTransactions';
import { getCategoryChartData, type ChartSource } from './financeCharts';

export interface SpendingEntry {
  id: string;
  merchant: string;
  category?: CategoryId;
  cents: number;
  source: Exclude<ChartSource, 'all'>;
  date?: string;
  isInstallment: boolean;
  isPurchase: boolean;
}

export function parseExpenseDate(value: string | undefined, monthName: string, year: number): string | undefined {
  if (!value) return undefined;
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const local = value.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!iso && !local) return undefined;
  const day = Number(iso ? iso[3] : local![1]);
  const month = Number(iso ? iso[2] : local![2]);
  const resolvedYear = iso ? Number(iso[1]) : local![3] ? Number(local![3]) : year - (month - 1 > getMonthIndex(monthName) ? 1 : 0);
  if (resolvedYear < 1900 || resolvedYear > 9999 || month < 1 || month > 12 || day < 1) return undefined;
  if (day > new Date(Date.UTC(resolvedYear, month, 0)).getUTCDate()) return undefined;
  return `${resolvedYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getSpendingEntries(month: BudgetMonth, source: ChartSource = 'all'): SpendingEntry[] {
  const invoices = month.creditCardInvoices ?? [];
  const cardBills = getCardCharges(invoices, month.bills).pendingBills;
  const matchedTypes = new Map<string, boolean>();
  const transactions = invoices.flatMap((invoice) => invoice.transactions);
  const transactionCards = new Map(invoices.flatMap((invoice) => invoice.transactions.map((transaction) => [transaction.id, invoice.cardId] as const)));
  const usedTransactions = new Set<string>();
  month.bills.filter((bill) => isOnCreditCardBill(bill) && !cardBills.includes(bill)).forEach((bill) => {
    const transaction = transactions.find((candidate) => !usedTransactions.has(candidate.id)
      && getUnimportedCardBills([bill], [candidate], transactionCards).length === 0);
    if (transaction) {
      usedTransactions.add(transaction.id);
      matchedTypes.set(transaction.id, bill.type === 'variavel');
    }
  });
  const entries: SpendingEntry[] = [...month.bills.filter((bill) => !isOnCreditCardBill(bill)), ...cardBills].map((bill) => {
    const purchaseMonth = bill.cardPurchaseMonth ?? month.name;
    const purchaseYear = bill.cardPurchaseYear ?? month.year;
    // Legacy Debit/Pix defaulted missing days to 1, so that value is ambiguous.
    const legacyDate = bill.type === 'variavel' && bill.cardPaymentMethod === 'debito_pix' && bill.dueDay > 1
      ? `${bill.dueDay}/${getMonthIndex(purchaseMonth) + 1}/${purchaseYear}` : undefined;
    return {
      id: `bill:${bill.id}`,
      merchant: bill.name,
      category: bill.category,
      cents: amountToCents(bill.amount),
      source: isOnCreditCardBill(bill) ? 'card' : 'account',
      date: parseExpenseDate(bill.purchaseDate ?? legacyDate, purchaseMonth, purchaseYear),
      isInstallment: bill.type === 'parcela' || (bill.installmentTotal ?? 1) > 1,
      isPurchase: bill.type === 'variavel',
    };
  });
  invoices.forEach((invoice) => invoice.transactions.forEach((transaction) => {
    entries.push({
      id: `invoice:${invoice.id}:${transaction.id}`,
      merchant: transaction.merchant,
      category: transaction.category,
      cents: getPersonalImpactCents(transaction),
      source: 'card',
      date: parseExpenseDate(transaction.date, invoice.month, invoice.year),
      isInstallment: transaction.type === 'INSTALLMENT' || (transaction.installmentTotal ?? 1) > 1,
      isPurchase: transaction.type === 'PURCHASE' && (matchedTypes.get(transaction.id) ?? true),
    });
  }));
  return entries.filter((entry) => entry.cents !== 0 && (source === 'all' || entry.source === source));
}

export function getDailySpending(month: BudgetMonth, source: ChartSource = 'all') {
  const index = getMonthIndex(month.name);
  const prefix = `${month.year}-${String(index + 1).padStart(2, '0')}-`;
  const entries = getSpendingEntries(month, source);
  const eligible = entries.filter((entry) => !entry.isInstallment && entry.date?.startsWith(prefix));
  const days = Array.from({ length: index < 0 ? 0 : new Date(month.year, index + 1, 0).getDate() }, (_, offset) => {
    const date = `${prefix}${String(offset + 1).padStart(2, '0')}`;
    const rows = eligible.filter((entry) => entry.date === date);
    return { day: offset + 1, date, cents: rows.reduce((sum, entry) => sum + entry.cents, 0), entries: rows };
  });
  return {
    days,
    totalCents: eligible.reduce((sum, entry) => sum + entry.cents, 0),
    undatedCents: entries.filter((entry) => !entry.isInstallment && !entry.date).reduce((sum, entry) => sum + entry.cents, 0),
    installmentCents: entries.filter((entry) => entry.isInstallment).reduce((sum, entry) => sum + entry.cents, 0),
    outsidePeriodCents: entries.filter((entry) => !entry.isInstallment && entry.date && !entry.date.startsWith(prefix)).reduce((sum, entry) => sum + entry.cents, 0),
  };
}

export function getPreviousCalendarMonth(month: BudgetMonth, months: BudgetMonth[]): BudgetMonth | undefined {
  const index = getMonthIndex(month.name);
  if (index < 0) return undefined;
  return months.find((candidate) => candidate.year === month.year - (index === 0 ? 1 : 0)
    && getMonthIndex(candidate.name) === (index + 11) % 12);
}

export function isMonthInProgress(month: Pick<BudgetMonth, 'name' | 'year'>, today = new Date()): boolean {
  return month.year === today.getFullYear() && getMonthIndex(month.name) === today.getMonth();
}

export function getCategoryChanges(month: BudgetMonth, previous: BudgetMonth, source: ChartSource = 'all') {
  const current = new Map(getCategoryChartData(month.bills, month.creditCardInvoices, source).items.map((item) => [item.category, item.cents]));
  const before = new Map(getCategoryChartData(previous.bills, previous.creditCardInvoices, source).items.map((item) => [item.category, item.cents]));
  return [...new Set([...current.keys(), ...before.keys()])].map((category) => ({
    category,
    currentCents: current.get(category) ?? 0,
    previousCents: before.get(category) ?? 0,
    deltaCents: (current.get(category) ?? 0) - (before.get(category) ?? 0),
  })).filter((item) => item.deltaCents !== 0).sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
}

export function getSmallPurchases(month: BudgetMonth, source: ChartSource = 'all', thresholdCents = 3000) {
  const entries = getSpendingEntries(month, source).filter((entry) => entry.isPurchase && !entry.isInstallment && entry.cents > 0 && entry.cents <= thresholdCents);
  const totalCents = entries.reduce((sum, entry) => sum + entry.cents, 0);
  return { entries, totalCents, thresholdCents, visible: entries.length >= 5 && totalCents >= 10000 };
}

export function getCategoryLimitState(spentCents: number, limitCents: number) {
  const ratio = spentCents / limitCents;
  return { ratio, remainingCents: limitCents - spentCents, status: ratio > 1 ? 'over' : ratio >= 0.8 ? 'near' : 'normal' } as const;
}
