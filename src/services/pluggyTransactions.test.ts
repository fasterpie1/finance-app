import { describe, expect, it } from 'vitest';
import { normalizePluggyTransaction } from './pluggyTransactions';

const account = {
  id: 'account-1',
  name: 'C6 Mastercard',
  number: 'xxxx1234',
  type: 'CREDIT',
  subtype: 'CREDIT_CARD',
  currencyCode: 'BRL',
};

describe('normalizePluggyTransaction', () => {
  it('uses the card bill month and preserves installment and provider identity', () => {
    const result = normalizePluggyTransaction({
      id: 'transaction-1',
      accountId: 'account-1',
      amount: 125.5,
      currencyCode: 'BRL',
      date: '2026-09-10T00:00:00.000Z',
      description: 'MERCADO',
      creditCardMetadata: {
        cardNumber: '1234',
        billId: 'bill-1',
        billForecastDate: '2026-10',
        purchaseDate: '2026-09-09T15:00:00.000Z',
        paymentType: 'INSTALLMENT',
        installmentNumber: 2,
        totalInstallments: 4,
      },
    }, account, 'item-1', new Map([['bill-1', { id: 'bill-1', totalAmount: 890.25 }]]));

    expect(result).toMatchObject({
      providerTransactionId: 'transaction-1',
      providerItemId: 'item-1',
      cardLast4: '1234',
      billMonth: '2026-10',
      statementTotalCents: 89025,
      merchant: 'MERCADO',
      amountCents: 12550,
      date: '2026-09-09',
      type: 'INSTALLMENT',
      installmentCurrent: 2,
      installmentTotal: 4,
    });
  });

  it('converts foreign currency using the account-currency amount', () => {
    const result = normalizePluggyTransaction({
      id: 'transaction-2',
      accountId: 'account-1',
      amount: 10,
      amountInAccountCurrency: 51.3,
      currencyCode: 'USD',
      date: '2026-10-01T00:00:00.000Z',
    }, account, 'item-1', new Map());

    expect(result?.amountCents).toBe(5130);
  });

  it('uses the account currency when the transaction omits its currency code', () => {
    const result = normalizePluggyTransaction({
      id: 'transaction-omitted-currency',
      accountId: 'account-1',
      amount: 10,
      amountInAccountCurrency: 51.3,
      date: '2026-10-01T00:00:00.000Z',
    }, account, 'item-1', new Map());

    expect(result?.amountCents).toBe(5130);
  });

  it('classifies refunds and payments instead of treating them as purchases', () => {
    const refund = normalizePluggyTransaction({
      id: 'transaction-refund',
      accountId: 'account-1',
      amount: 10,
      currencyCode: 'BRL',
      date: '2026-10-01',
      operationType: 'REFUND',
    }, account, 'item-1', new Map());
    const payment = normalizePluggyTransaction({
      id: 'transaction-payment',
      accountId: 'account-1',
      amount: 10,
      currencyCode: 'BRL',
      date: '2026-10-01',
      operationType: 'PAYMENT',
    }, account, 'item-1', new Map());

    expect(refund?.type).toBe('REFUND');
    expect(payment?.type).toBe('PAYMENT');
  });

  it('ignores non-card accounts and transactions without a usable amount or bill month', () => {
    expect(normalizePluggyTransaction({
      id: 'transaction-3',
      accountId: 'checking-1',
      amount: 12,
    }, { ...account, id: 'checking-1', type: 'BANK', subtype: 'CHECKING_ACCOUNT' }, 'item-1', new Map())).toBeNull();

    expect(normalizePluggyTransaction({
      id: 'transaction-4',
      accountId: 'account-1',
      amount: 12,
    }, account, 'item-1', new Map())).toBeNull();
  });
});
