import { describe, expect, it } from 'vitest';
import { getThirdPartyTotalsCents, getUnimportedCardBills } from './cardTransactions';
import type { Bill, CreditCardTransaction } from '../types';

function tx(overrides: Partial<CreditCardTransaction>): CreditCardTransaction {
  return {
    id: Math.random().toString(36).slice(2),
    invoiceId: 'inv',
    merchant: 'LOJA',
    amountCents: 1000,
    type: 'PURCHASE',
    owner: 'ME',
    ...overrides,
  };
}

function cardBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Academia',
    category: 'assinatura',
    amount: 137.5,
    dueDay: 10,
    type: 'mensal',
    isPaid: false,
    month: 'Setembro',
    note: '',
    isOnCreditCard: true,
    ...overrides,
  };
}

describe('terceiros agrupados por nome', () => {
  it('soma por pessoa juntando variações de maiúscula e espaço', () => {
    const totals = getThirdPartyTotalsCents([
      tx({ owner: 'THIRD_PARTY', thirdPartyName: 'Marcos', amountCents: 35034 }),
      tx({ owner: 'THIRD_PARTY', thirdPartyName: ' marcos ', amountCents: 19999 }),
      tx({ owner: 'THIRD_PARTY', thirdPartyName: 'Mãe', amountCents: 12000 }),
      tx({ owner: 'ME', thirdPartyName: 'Marcos', amountCents: 5000 }),
    ]);
    expect(totals).toEqual([{ name: 'Marcos', cents: 55033 }, { name: 'Mãe', cents: 12000 }]);
  });

  it('desconta estorno e ignora terceiro sem nome', () => {
    const totals = getThirdPartyTotalsCents([
      tx({ owner: 'THIRD_PARTY', thirdPartyName: 'Jéssica', amountCents: 20000 }),
      tx({ owner: 'THIRD_PARTY', thirdPartyName: 'Jéssica', amountCents: 5000, type: 'REFUND' }),
      tx({ owner: 'THIRD_PARTY', amountCents: 7000 }),
    ]);
    expect(totals).toEqual([{ name: 'Jéssica', cents: 15000 }]);
  });
});

describe('conta fixa no cartão dentro de "Meus gastos"', () => {
  it('mantém a conta quando ela não veio na fatura importada', () => {
    const bills = [cardBill()];
    expect(getUnimportedCardBills(bills, [tx({ merchant: 'UBER', amountCents: 2500 })])).toHaveLength(1);
  });

  it('descarta a conta quando o mesmo valor já chegou importado da fatura', () => {
    const bills = [cardBill()];
    const imported = [tx({ merchant: 'ACADEMIA', amountCents: 13750, owner: 'ME' })];
    expect(getUnimportedCardBills(bills, imported)).toHaveLength(0);
  });

  it('compara a parcela certa de uma compra parcelada', () => {
    const bills = [cardBill({ name: 'Geladeira', amount: 250, installmentCurrent: 3, installmentTotal: 12 })];
    const mesmaParcela = [tx({ amountCents: 25000, type: 'INSTALLMENT', installmentCurrent: 3, installmentTotal: 12 })];
    const outraParcela = [tx({ amountCents: 25000, type: 'INSTALLMENT', installmentCurrent: 4, installmentTotal: 12 })];
    expect(getUnimportedCardBills(bills, mesmaParcela)).toHaveLength(0);
    expect(getUnimportedCardBills(bills, outraParcela)).toHaveLength(1);
  });
});
