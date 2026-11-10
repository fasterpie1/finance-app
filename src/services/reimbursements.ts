import type { BudgetMonth, CreditCardTransaction, ReimbursementReceipt } from '../types';
import { getThirdPartyTotalsCents } from './cardTransactions';
import { parseExpenseDate } from './spendingInsights';

export interface ReimbursementBalance {
  name: string;
  owedCents: number;
  receivedCents: number;
  remainingCents: number;
  creditCents: number;
}

/** Pass only the selected month's transactions and receipts, across all its cards. */
export function getReimbursementBalances(
  transactions: CreditCardTransaction[],
  receipts: ReimbursementReceipt[],
): ReimbursementBalance[] {
  const balances = new Map<string, ReimbursementBalance>();
  const groupFor = (name: string) => {
    const key = name.trim().toLowerCase();
    let group = balances.get(key);
    if (!group) {
      group = { name: name.trim(), owedCents: 0, receivedCents: 0, remainingCents: 0, creditCents: 0 };
      balances.set(key, group);
    }
    return group;
  };

  getThirdPartyTotalsCents(transactions).forEach(({ name, cents }) => {
    groupFor(name).owedCents += cents;
  });
  // Receipts remain attributed to their original person after transactions change.
  receipts.forEach((receipt) => {
    if (receipt.personName.trim()) groupFor(receipt.personName).receivedCents += receipt.amountCents;
  });
  return [...balances.values()].map((group) => ({
    ...group,
    remainingCents: Math.max(0, group.owedCents - group.receivedCents),
    creditCents: Math.max(0, group.receivedCents - group.owedCents),
  }));
}

/** Strict date-only ISO, with the same real-calendar validation as expense dates. */
export function isValidReimbursementDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && parseExpenseDate(value, '', 2000) === value;
}

/** Pure boundary: invalid input leaves the month untouched; receipts are not income. */
export function addReimbursementReceipt(month: BudgetMonth, receipt: ReimbursementReceipt): BudgetMonth {
  if (!receipt || typeof receipt.id !== 'string' || !receipt.id.trim()
    || typeof receipt.personName !== 'string'
    || !receipt.personName.trim() || receipt.personName.trim().length > 120
    || !Number.isSafeInteger(receipt.amountCents) || receipt.amountCents <= 0
    || !isValidReimbursementDate(receipt.date)) return month;

  const receipts = month.reimbursementReceipts ?? [];
  if (receipts.some((existing) => existing.id === receipt.id)) return month;
  const name = receipt.personName.trim();
  const transactions = (month.creditCardInvoices ?? []).flatMap((invoice) => invoice.transactions);
  const balance = getReimbursementBalances(transactions, receipts)
    .find((group) => group.name.toLowerCase() === name.toLowerCase());
  if (!balance || !Number.isSafeInteger(balance.remainingCents)
    || receipt.amountCents > balance.remainingCents) return month;

  return {
    ...month,
    reimbursementReceipts: [...receipts, { ...receipt, personName: name }],
  };
}

/** Only receipts are removed; bills, invoices and their original totals are unchanged. */
export function removeReimbursementReceipt(month: BudgetMonth, id: string): BudgetMonth {
  const receipts = month.reimbursementReceipts;
  if (!receipts?.some((receipt) => receipt.id === id)) return month;
  return { ...month, reimbursementReceipts: receipts.filter((receipt) => receipt.id !== id) };
}
