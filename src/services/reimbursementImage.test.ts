import { describe, expect, it } from 'vitest';
import type { CreditCardTransaction } from '../types';
import { getReimbursementImageSummary } from './reimbursementImage';

function transaction(overrides: Partial<CreditCardTransaction>): CreditCardTransaction {
  return {
    id: 'tx',
    invoiceId: 'inv',
    merchant: 'Mercado',
    amountCents: 9000,
    type: 'PURCHASE',
    owner: 'SHARED',
    personalAmountCents: 3000,
    thirdPartyShares: [
      { personName: 'Ana', amountCents: 3000 },
      { personName: 'Bia', amountCents: 3000 },
    ],
    ...overrides,
  };
}

describe('resumo de cobrança para imagem', () => {
  it('lista apenas as partes da pessoa e desconta recebimentos do saldo em aberto', () => {
    const summary = getReimbursementImageSummary('Ana', 'Outubro 2026', [
      transaction({ date: '08/10' }),
      transaction({
        id: 'refund',
        merchant: 'Estorno',
        amountCents: 3000,
        type: 'REFUND',
        personalAmountCents: 1000,
        thirdPartyShares: [
          { personName: 'Ana', amountCents: 1000 },
          { personName: 'Bia', amountCents: 1000 },
        ],
      }),
    ], [{ id: 'receipt', personName: 'Ana', amountCents: 500, date: '2026-10-10' }]);

    expect(summary.items.map((item) => item.amountCents)).toEqual([3000, -1000]);
    expect(summary.owedCents).toBe(2000);
    expect(summary.receivedCents).toBe(500);
    expect(summary.remainingCents).toBe(1500);
  });
});
