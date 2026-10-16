import type { Bill, CreditCardInvoice, CreditCardTransaction, ExpenseOwner } from '../types';
import type { DuplicateField, DuplicateMatch } from './transactionDuplicates';

/** A tela tem que dizer com qual lançamento a linha bate, não só avisar "possível duplicado". */
const DUPLICATE_FIELD_LABEL_KEY: Record<DuplicateField, string> = {
  amount: 'dupFieldAmount',
  date: 'dupFieldDate',
  card: 'dupFieldCard',
  installment: 'dupFieldInstallment',
};

/** "QUADRADO DE RIO · R$ 12,00 · 08/10 — coincidem valor e dia" */
export function describeDuplicateMatch(
  match: DuplicateMatch,
  formatMoney: (amount: number) => string,
  t: (key: string) => string,
): string {
  const found = match.transaction;
  const details = [found.merchant?.trim(), formatMoney(centsToAmount(found.amountCents)), found.date].filter(Boolean).join(' · ');
  return `${details} — ${t('duplicateMatches')} ${match.matchedOn.map((field) => t(DUPLICATE_FIELD_LABEL_KEY[field])).join(', ')}`;
}

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

/** Quanto do lançamento o outro tem que devolver. Na compartilhada é o resto depois
 *  da minha parte; sem isso a compra dividida não pertenceria a ninguém na quebra da fatura. */
export function getThirdPartyImpactCents(transaction: CreditCardTransaction): number {
  if (transaction.type === 'PAYMENT') return 0;
  const sign = transaction.type === 'REFUND' ? -1 : 1;
  if (transaction.owner === 'THIRD_PARTY') return sign * transaction.amountCents;
  if (transaction.owner === 'SHARED') return sign * Math.max(0, transaction.amountCents - (transaction.personalAmountCents ?? 0));
  return 0;
}

/** O bruto do lançamento na fatura — o que o banco cobra, sem separar quem paga. Serve para a
 *  IA poder dizer "R$ 2.141,79 em compras, dos quais R$ 198,57 são meus" em vez de chamar de
 *  zero o que é de terceiro. */
export function getChargeImpactCents(transaction: CreditCardTransaction): number {
  if (transaction.type === 'PAYMENT') return 0;
  const sign = transaction.type === 'REFUND' ? -1 : 1;
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
  return invoice.transactions.reduce((total, transaction) => total + getThirdPartyImpactCents(transaction), 0);
}

// O banco pode escrever "APPLE.COM/BILL" para a conta chamada "Cloud Apple".
function sharesChargeName(billName: string, merchant: string): boolean {
  const tokens = (value: string) => value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^0-9A-Z]+/)
    .filter((token) => token.length >= 4);
  const mine = tokens(billName);
  return tokens(merchant).some((token) => mine.includes(token));
}

export function getUnimportedCardBills(
  bills: Bill[],
  transactions: CreditCardTransaction[],
  transactionCardIds?: ReadonlyMap<string, string | undefined>,
): Bill[] {
  const matchedIndexes = new Set<number>();
  return bills.filter((bill) => {
    const isInstallment = (bill.installmentTotal ?? 1) > 1;
    const cents = amountToCents(bill.amount);
    const index = transactions.findIndex((transaction, transactionIndex) => {
      if (matchedIndexes.has(transactionIndex)) return false;
      const cardId = transactionCardIds?.get(transaction.id);
      if (bill.cardId && cardId && bill.cardId !== cardId) return false;
      if (transaction.amountCents !== cents) return false;
      if (transaction.type !== (isInstallment ? 'INSTALLMENT' : 'PURCHASE')) return false;
      if (!sharesChargeName(bill.name, transaction.merchant)) return false;
      return !isInstallment || (
        (transaction.installmentCurrent ?? 1) === (bill.installmentCurrent ?? 1)
        && (transaction.installmentTotal ?? 1) === (bill.installmentTotal ?? 1)
      );
    });
    if (index < 0) return true;
    matchedIndexes.add(index);
    return false;
  });
}

// As contas pendentes já passaram pela correspondência; repetir o filtro consumiria a mesma linha duas vezes.
export function getCardTotalWithPendingBillsCents(invoices: CreditCardInvoice[], pendingBills: Bill[]): number {
  return invoices.reduce((total, invoice) => total + getInvoiceTotalCents(invoice), 0)
    + pendingBills.reduce((total, bill) => total + amountToCents(bill.amount), 0);
}

/** A regra única de "essa conta está no cartão". Débito/Pix é cobrado na hora da compra,
 *  então nunca aparece na fatura e fica fora de todas as somas daqui. */
export function isOnCreditCardBill(bill: Bill): boolean {
  if (bill.cardPaymentMethod === 'debito_pix') return false;
  return (bill.type === 'parcela' && bill.category !== 'financiamento') || bill.isOnCreditCard === true;
}

export interface CardCharges {
  /** O que o banco cobra na fatura do mês, incluindo as contas postas no cartão. */
  totalCents: number;
  /** A minha parte: o que eu pago, incluindo a parte pessoal de uma compartilhada. */
  personalCents: number;
  /** Inclui o resto da compra compartilhada: o que o outro paga, não eu. */
  thirdPartyCents: number;
  sharedCents: number;
  /** Líquido de pagamentos e estornos, para dívida em aberto. */
  chargeCents: number;
  /** Contas no cartão que ainda não vieram numa fatura importada. */
  pendingBills: Bill[];
}

/** Toda soma de cartão do app sai daqui: fatura do mês, meus gastos, sobra prevista e o
 *  prompt da IA. Cada tela deixava de fora um pedaço diferente, e os números brigavam. */
export function getCardCharges(invoices: CreditCardInvoice[], bills: Bill[]): CardCharges {
  const transactions = invoices.flatMap((invoice) => invoice.transactions);
  const transactionCardIds = new Map(invoices.flatMap((invoice) => invoice.transactions.map((transaction) => [transaction.id, invoice.cardId] as const)));
  const pendingBills = getUnimportedCardBills(bills.filter(isOnCreditCardBill), transactions, transactionCardIds);
  const pendingCents = pendingBills.reduce((total, bill) => total + amountToCents(bill.amount), 0);
  return {
    totalCents: getCardTotalWithPendingBillsCents(invoices, pendingBills),
    personalCents: invoices.reduce((total, invoice) => total + getInvoicePersonalTotalCents(invoice), 0) + pendingCents,
    thirdPartyCents: invoices.reduce((total, invoice) => total + getInvoiceThirdPartyTotalCents(invoice), 0),
    sharedCents: transactions.reduce((total, transaction) => (
      transaction.owner === 'SHARED' ? total + transaction.amountCents : total
    ), 0),
    chargeCents: invoices.reduce((total, invoice) => total + getInvoiceChargeTotalCents(invoice), 0) + pendingCents,
    pendingBills,
  };
}

/** Quanto o mês consome do meu bolso: as contas que não estão no cartão + a minha parte da fatura.
 *  A sobra prevista e o ritmo por dia usam a mesma fórmula para nunca divergirem. */
export function getMonthPlannedCents(bills: Bill[], invoices: CreditCardInvoice[]): number {
  const plainCents = bills.reduce((total, bill) => (
    isOnCreditCardBill(bill) ? total : total + amountToCents(bill.amount)
  ), 0);
  return plainCents + getCardCharges(invoices, bills).personalCents;
}

export function getOwnerLabel(owner: ExpenseOwner): string {
  return {
    ME: 'Eu',
    THIRD_PARTY: 'Terceiro',
    SHARED: 'Compartilhado',
    UNCLASSIFIED: 'Não classificado',
  }[owner];
}

/** Total devido por pessoa, agrupando "marcos " e "Marcos" como a mesma pessoa.
 *  Recebe também a parte do outro numa compra compartilhada, que é o motivo de dar nome a ela. */
export function getThirdPartyTotalsCents(transactions: CreditCardTransaction[]): Array<{ name: string; cents: number }> {
  const totals = new Map<string, { name: string; cents: number }>();
  transactions.forEach((transaction) => {
    if (transaction.owner !== 'THIRD_PARTY' && transaction.owner !== 'SHARED') return;
    const name = transaction.thirdPartyName?.trim();
    if (!name) return;
    const cents = getThirdPartyImpactCents(transaction);
    if (cents === 0) return;
    const key = name.toLowerCase();
    const group = totals.get(key) ?? { name, cents: 0 };
    group.cents += cents;
    totals.set(key, group);
  });
  return [...totals.values()].sort((a, b) => b.cents - a.cents);
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

function isInstallment(transaction: CreditCardTransaction): boolean {
  return (transaction.installmentTotal ?? 1) > 1;
}

/** Fração do parcelamento já paga; 0 para compra à vista, que não entra no bloco das parceladas. */
function installmentProgress(transaction: CreditCardTransaction): number {
  const total = transaction.installmentTotal ?? 1;
  return total <= 1 ? 0 : (transaction.installmentCurrent ?? 1) / total;
}

function installmentRemaining(transaction: CreditCardTransaction): number {
  return (transaction.installmentTotal ?? 1) - (transaction.installmentCurrent ?? 1);
}

/** Parcelada 9/10 vem antes de 1/8: é a compra mais antiga, a que está quase acabando. */
function compareInvoiceTransactions(a: CreditCardTransaction, b: CreditCardTransaction): number {
  const aIsInstallment = isInstallment(a);
  const bIsInstallment = isInstallment(b);
  if (aIsInstallment !== bIsInstallment) return aIsInstallment ? -1 : 1;
  if (aIsInstallment) {
    const byProgress = installmentProgress(b) - installmentProgress(a);
    if (byProgress !== 0) return byProgress;
    const byRemaining = installmentRemaining(a) - installmentRemaining(b);
    if (byRemaining !== 0) return byRemaining;
  }
  const byDay = (getTransactionDay(a.date) ?? 99) - (getTransactionDay(b.date) ?? 99);
  if (byDay !== 0) return byDay;
  return a.merchant.localeCompare(b.merchant, 'pt-BR');
}

/** Ordem da fatura: primeiro as parceladas, do parcelamento mais adiantado para o mais novo;
 *  depois as compras avulsas, do dia 1 ao 31. As fixas do cartão e o débito/pix têm seção própria
 *  abaixo desta lista, então não competem aqui. */
export function sortInvoiceTransactions(transactions: CreditCardTransaction[]): CreditCardTransaction[] {
  return [...transactions].sort(compareInvoiceTransactions);
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