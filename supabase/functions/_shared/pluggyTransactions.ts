export type OpenFinanceCardTransactionType = 'PURCHASE' | 'INSTALLMENT' | 'REFUND' | 'PAYMENT' | 'FEE' | 'OTHER';

export interface PluggyAccount {
  id: string;
  name?: string | null;
  number?: string | null;
  type?: string | null;
  subtype?: string | null;
  currencyCode?: string | null;
}

export interface PluggyBill {
  id: string;
  totalAmount?: number | null;
  dueDate?: string | null;
  billClosingDate?: string | null;
}

export interface PluggyTransaction {
  id: string;
  accountId: string;
  amount: number;
  amountInAccountCurrency?: number | null;
  currencyCode?: string | null;
  date?: string | null;
  description?: string | null;
  descriptionRaw?: string | null;
  status?: string | null;
  type?: string | null;
  operationType?: string | null;
  merchant?: { name?: string | null } | null;
  creditCardMetadata?: {
    cardNumber?: string | null;
    billId?: string | null;
    billForecastDate?: string | null;
    purchaseDate?: string | null;
    transactionDateTime?: string | null;
    paymentType?: string | null;
    installmentNumber?: number | null;
    totalInstallments?: number | null;
  } | null;
}

export interface OpenFinanceTransaction {
  providerTransactionId: string;
  providerItemId: string;
  accountId: string;
  accountName: string;
  cardLast4?: string;
  billId?: string;
  billMonth: string;
  statementTotalCents?: number;
  merchant: string;
  amountCents: number;
  date: string;
  type: OpenFinanceCardTransactionType;
  installmentCurrent: number;
  installmentTotal: number;
}

export function normalizePluggyTransaction(
  transaction: PluggyTransaction,
  account: PluggyAccount,
  itemId: string,
  bills: ReadonlyMap<string, PluggyBill>,
): OpenFinanceTransaction | null {
  if (!transaction.id || transaction.accountId !== account.id || !itemId) return null;
  if (account.type?.toUpperCase() !== 'CREDIT' || account.subtype?.toUpperCase() !== 'CREDIT_CARD') return null;

  const metadata = transaction.creditCardMetadata;
  const transactionCurrency = transaction.currencyCode?.toUpperCase();
  const accountCurrency = (account.currencyCode ?? 'BRL').toUpperCase();
  const amount = transactionCurrency
    ? transactionCurrency === accountCurrency
      ? transaction.amount
      : transaction.amountInAccountCurrency
    : transaction.amountInAccountCurrency ?? transaction.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) return null;

  const billId = metadata?.billId || undefined;
  const bill = billId ? bills.get(billId) : undefined;
  const billDate = metadata?.billForecastDate
    || bill?.billClosingDate
    || bill?.dueDate
    || transaction.date
    || '';
  const billMonth = billDate.match(/^(\d{4})-(\d{2})/)?.[0];
  if (!billMonth || !/^\d{4}-\d{2}$/.test(billMonth)) return null;

  const rawDate = metadata?.purchaseDate || metadata?.transactionDateTime || transaction.date || '';
  const date = rawDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!date) return null;

  const installmentTotal = Math.max(1, Math.round(metadata?.totalInstallments ?? 1));
  const installmentCurrent = Math.min(
    installmentTotal,
    Math.max(1, Math.round(metadata?.installmentNumber ?? 1)),
  );
  const operation = `${metadata?.paymentType ?? ''} ${transaction.operationType ?? ''} ${transaction.type ?? ''}`.toUpperCase();
  const type: OpenFinanceCardTransactionType = amount < 0
    ? 'REFUND'
    : operation.includes('REFUND') || operation.includes('CREDIT')
      ? 'REFUND'
      : operation.includes('PAYMENT')
        ? 'PAYMENT'
        : operation.includes('FEE')
          ? 'FEE'
          : operation.includes('INSTALLMENT') || installmentTotal > 1
            ? 'INSTALLMENT'
            : 'PURCHASE';

  const statementTotalCents = typeof bill?.totalAmount === 'number' && Number.isFinite(bill.totalAmount)
    ? Math.round(Math.abs(bill.totalAmount) * 100)
    : undefined;
  const cardLast4 = (metadata?.cardNumber || account.number || '').replace(/\D/g, '').slice(-4) || undefined;

  return {
    providerTransactionId: transaction.id,
    providerItemId: itemId,
    accountId: account.id,
    accountName: account.name?.trim() || 'Cartão de crédito',
    cardLast4,
    billId,
    billMonth,
    statementTotalCents,
    merchant: transaction.merchant?.name?.trim()
      || transaction.descriptionRaw?.trim()
      || transaction.description?.trim()
      || 'Compra sem descrição',
    amountCents: Math.round(Math.abs(amount) * 100),
    date,
    type,
    installmentCurrent,
    installmentTotal,
  };
}
