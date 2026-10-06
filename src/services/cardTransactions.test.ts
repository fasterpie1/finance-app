import { describe, expect, it } from 'vitest';
import { getCardCharges, getMonthPlannedCents, getThirdPartyTotalsCents, getUnimportedCardBills, isOnCreditCardBill } from './cardTransactions';
import type { Bill, CreditCardInvoice, CreditCardTransaction } from '../types';

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

describe('as somas do cartão (dashboard, aba cartão e sobra prevista)', () => {
  const invoice = (transactions: CreditCardTransaction[]): CreditCardInvoice => ({ id: 'inv', month: 'Outubro', year: 2026, transactions });

  it('a conta do cartão entra na fatura e só o meu entra em meus gastos', () => {
    const charges = getCardCharges([invoice([
      tx({ amountCents: 10000, owner: 'ME' }),
      tx({ amountCents: 5000, owner: 'THIRD_PARTY', thirdPartyName: 'Marcos' }),
      tx({ amountCents: 3000, owner: 'SHARED', personalAmountCents: 1200 }),
      tx({ amountCents: 7000, owner: 'UNCLASSIFIED' }),
    ])], [cardBill({ amount: 137.5 })]);
    expect(charges.personalCents).toBe(24950);
    expect(charges.totalCents).toBe(38750);
    expect(charges.thirdPartyCents).toBe(5000);
    expect(charges.unclassifiedCents).toBe(7000);
  });

  it('não conta de novo a conta que já veio importada da fatura', () => {
    const charges = getCardCharges([invoice([tx({ merchant: 'ACADEMIA', amountCents: 13750, owner: 'ME' })])], [cardBill({ amount: 137.5 })]);
    expect(charges.personalCents).toBe(13750);
    expect(charges.totalCents).toBe(13750);
  });

  it('desconta estorno meu e ignora pagamento', () => {
    const charges = getCardCharges([invoice([
      tx({ amountCents: 20000, owner: 'ME' }),
      tx({ amountCents: 5000, type: 'REFUND', owner: 'ME' }),
      tx({ amountCents: 90000, type: 'PAYMENT', owner: 'ME' }),
    ])], []);
    expect(charges.personalCents).toBe(15000);
    expect(charges.totalCents).toBe(15000);
    expect(charges.chargeCents).toBe(15000);
  });

  it('débito/pix e financiamento ficam fora do cartão', () => {
    const bills = [
      cardBill({ name: 'Almoço', amount: 50, type: 'variavel', cardPaymentMethod: 'debito_pix' }),
      cardBill({ name: 'Financiamento', amount: 695.02, type: 'parcela', category: 'financiamento', isOnCreditCard: false }),
      cardBill({ name: 'Luz', amount: 80, isOnCreditCard: false }),
    ];
    expect(bills.every((bill) => !isOnCreditCardBill(bill))).toBe(true);
    expect(getCardCharges([], bills).totalCents).toBe(0);
  });
});

describe('previsto do mês (sobra prevista e ritmo por dia)', () => {
  const invoice = (transactions: CreditCardTransaction[]): CreditCardInvoice => ({ id: 'inv', month: 'Outubro', year: 2026, transactions });

  it('soma as contas fora do cartão com a minha parte da fatura', () => {
    const cents = getMonthPlannedCents([
      cardBill({ name: 'Luz', category: 'luz', amount: 80, isOnCreditCard: false }),
      cardBill({ amount: 137.5 }),
    ], [invoice([
      tx({ amountCents: 10000, owner: 'ME' }),
      tx({ amountCents: 5000, owner: 'THIRD_PARTY', thirdPartyName: 'Marcos' }),
    ])]);
    expect(cents).toBe(31750);
  });

  it('a fixa do cartão que já veio importada entra uma única vez', () => {
    const cents = getMonthPlannedCents([cardBill({ amount: 137.5 })], [invoice([tx({ merchant: 'ACADEMIA', amountCents: 13750, owner: 'ME' })])]);
    expect(cents).toBe(13750);
  });

  it('compra no débito/pix é prevista normal porque não passa pela fatura', () => {
    const cents = getMonthPlannedCents([cardBill({ name: 'Almoço', type: 'variavel', amount: 50, cardPaymentMethod: 'debito_pix' })], []);
    expect(cents).toBe(5000);
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
