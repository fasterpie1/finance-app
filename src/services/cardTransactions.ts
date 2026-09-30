import type { CreditCardInvoice, CreditCardTransaction, ExpenseOwner } from '../types';

export function centsToAmount(cents: number): number {
  return cents / 100;
}

export function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}

export function getPersonalImpactCents(transaction: CreditCardTransaction): number {
  if (transaction.type === 'PAYMENT') return 0;

  const sign = transaction.type === 'REFUND' ? -1 : 1;
  if (transaction.owner === 'THIRD_PARTY' || transaction.owner === 'UNCLASSIFIED') return 0;
  if (transaction.owner === 'SHARED') return sign * Math.max(0, transaction.personalAmountCents ?? 0);
  return sign * transaction.amountCents;
}

export function getInvoiceTotalCents(invoice: CreditCardInvoice): number {
  if (invoice.statementTotalCents != null) return invoice.statementTotalCents;
  // Fall back to the net amount owed: charges minus refunds, excluding payments.
  // Summing every transaction here would count PAYMENT as a charge and REFUND as
  // money owed, inflating the invoice total.
  return getInvoiceChargeTotalCents(invoice);
}

export function getInvoicePersonalTotalCents(invoice: CreditCardInvoice): number {
  return invoice.transactions.reduce((total, transaction) => total + getPersonalImpactCents(transaction), 0);
}

export function getInvoiceThirdPartyTotalCents(invoice: CreditCardInvoice): number {
  return invoice.transactions.reduce((total, transaction) => (
    total + (transaction.owner === 'THIRD_PARTY' ? transaction.amountCents : 0)
  ), 0);
}

export function getInvoiceUnclassifiedTotalCents(invoice: CreditCardInvoice): number {
  return invoice.transactions.reduce((total, transaction) => (
    total + (transaction.owner === 'UNCLASSIFIED' ? transaction.amountCents : 0)
  ), 0);
}

export function getOwnerLabel(owner: ExpenseOwner): string {
  return {
    ME: 'Eu',
    THIRD_PARTY: 'Terceiro',
    SHARED: 'Compartilhado',
    UNCLASSIFIED: 'Não classificado',
  }[owner];
}

export function getTransactionCategoryImpactCents(transaction: CreditCardTransaction): number {
  return transaction.category ? getPersonalImpactCents(transaction) : 0;
}

/** Data de lançamento no formato canônico DD/MM; o mês vem da fatura do lançamento. */
export function formatTransactionDay(day: number, monthIndex: number): string {
  return `${String(Math.max(1, Math.min(31, day))).padStart(2, '0')}/${String(monthIndex + 1).padStart(2, '0')}`;
}

export function getTransactionDay(date?: string): number | undefined {
  const day = Number(date?.match(/^\s*(\d{1,2})\//)?.[1]);
  return day >= 1 && day <= 31 ? day : undefined;
}

export function getTransactionMonthIndex(date?: string): number | undefined {
  const month = Number(date?.match(/^\s*\d{1,2}\/(\d{1,2})/)?.[1]);
  return month >= 1 && month <= 12 ? month - 1 : undefined;
}

/** Troca só o dia: o mês já registrado na importação continua valendo. */
export function setTransactionDay(date: string | undefined, day: number | undefined, monthIndex: number): string | undefined {
  if (!day || day < 1 || day > 31) return undefined;
  return formatTransactionDay(day, getTransactionMonthIndex(date) ?? monthIndex);
}

export function getInvoiceChargeTotalCents(invoice: CreditCardInvoice): number {
  return invoice.transactions.reduce((total, transaction) => {
    if (transaction.type === 'PAYMENT') return total;
    return total + (transaction.type === 'REFUND' ? -transaction.amountCents : transaction.amountCents);
  }, 0);
}