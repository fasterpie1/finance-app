import { describe, expect, it } from 'vitest';
import { getCardCharges, getCardTotalWithPendingBillsCents, getMonthPlannedCents, getThirdPartyTotalsCents, getUnimportedCardBills, isOnCreditCardBill, sortInvoiceTransactions } from './cardTransactions';
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

  it('atribui ao nomeado o resto da compra compartilhada', () => {
    const totals = getThirdPartyTotalsCents([
      tx({ owner: 'SHARED', thirdPartyName: 'Marcos', amountCents: 3000, personalAmountCents: 1200 }),
      tx({ owner: 'SHARED', thirdPartyName: 'Marcos', amountCents: 1000 }),
      tx({ owner: 'SHARED', amountCents: 4000, personalAmountCents: 2000 }),
    ]);
    expect(totals).toEqual([{ name: 'Marcos', cents: 2800 }]);
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
    // 5000 do terceiro + 1800 que é o resto da compartilhada (3000 - 1200 da minha parte).
    expect(charges.thirdPartyCents).toBe(6800);
    // Um lançamento salvo sem dono fica na fatura, mas não pertence a ninguém: nem a mim, nem ao terceiro.
    expect(charges.personalCents + charges.thirdPartyCents).toBe(charges.totalCents - 7000);
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
    const mesmaParcela = [tx({ merchant: 'GELADEIRA', amountCents: 25000, type: 'INSTALLMENT', installmentCurrent: 3, installmentTotal: 12 })];
    const outraParcela = [tx({ merchant: 'GELADEIRA', amountCents: 25000, type: 'INSTALLMENT', installmentCurrent: 4, installmentTotal: 12 })];
    expect(getUnimportedCardBills(bills, mesmaParcela)).toHaveLength(0);
    expect(getUnimportedCardBills(bills, outraParcela)).toHaveLength(1);
  });

  it('não descarta a conta só porque outra compra custou o mesmo', () => {
    const bills = [cardBill({ name: 'Cloud Apple', amount: 19.9, dueDay: 1 })];
    const outraCompra = [tx({ merchant: 'MP *MELIMAIS', amountCents: 1990, date: '14/10' })];
    expect(getUnimportedCardBills(bills, outraCompra)).toHaveLength(1);
  });

  it('reconhece a mesma cobrança pelo nome quando o dia é outro', () => {
    const bills = [cardBill({ name: 'Cloud Apple', amount: 19.9, dueDay: 1 })];
    const importada = [tx({ merchant: 'APPLE.COM/BILL SAO PAU', amountCents: 1990, date: '05/10' })];
    expect(getUnimportedCardBills(bills, importada)).toHaveLength(0);
  });

  it('não usa só valor e dia para identificar estabelecimentos diferentes', () => {
    const bills = [cardBill({ name: 'Cloud Apple', amount: 19.9, dueDay: 1 })];
    expect(getUnimportedCardBills(bills, [tx({ merchant: 'MP *MELIMAIS', amountCents: 1990, date: '01/10' })])).toEqual(bills);
  });

  it('não confunde compras parceladas diferentes com o mesmo valor e andamento', () => {
    const bills = [cardBill({ name: 'Geladeira', amount: 250, installmentCurrent: 3, installmentTotal: 12 })];
    const imported = [tx({ merchant: 'NETSHOES', amountCents: 25000, type: 'INSTALLMENT', installmentCurrent: 3, installmentTotal: 12 })];
    expect(getUnimportedCardBills(bills, imported)).toEqual(bills);
  });

  it('cada lançamento só representa uma conta, sem alterar os registros', () => {
    const bills = [cardBill({ id: 'cloud1', name: 'Cloud Apple', amount: 19.9 }), cardBill({ id: 'cloud2', name: 'Cloud Apple', amount: 19.9 })];
    const imported = [tx({ merchant: 'APPLE.COM/BILL', amountCents: 1990 })];
    const before = structuredClone({ bills, imported });
    expect(getUnimportedCardBills(bills, imported)).toEqual([bills[1]]);
    expect(getUnimportedCardBills(bills, [...imported, tx({ merchant: 'APPLE.COM/BILL', amountCents: 1990 })])).toHaveLength(0);
    expect({ bills, imported }).toEqual(before);
    const invoices: CreditCardInvoice[] = [{ id: 'inv', month: 'Outubro', year: 2026, transactions: imported }];
    const charges = getCardCharges(invoices, bills);
    expect(charges.totalCents).toBe(3980);
    expect(getCardTotalWithPendingBillsCents(invoices, charges.pendingBills)).toBe(3980);
    expect(getMonthPlannedCents(bills, invoices)).toBe(3980);
  });

  it('uma compra de outro cartão não absorve a conta manual identificada', () => {
    const bills = [cardBill({ cardId: 'c6' })];
    const invoices: CreditCardInvoice[] = [{ id: 'inv', cardId: 'nubank', month: 'Outubro', year: 2026, transactions: [tx({ merchant: 'ACADEMIA', amountCents: 13750 })] }];
    expect(getCardCharges(invoices, bills).pendingBills).toEqual(bills);
    expect(getCardCharges(invoices, bills).totalCents).toBe(27500);
  });

  it('estorno de mesmo valor não é a conta já paga na fatura', () => {
    const bills = [cardBill({ amount: 137.5 })];
    const estorno = [tx({ merchant: 'ACADEMIA', amountCents: 13750, type: 'REFUND' })];
    expect(getUnimportedCardBills(bills, estorno)).toHaveLength(1);
  });
});

describe('ordem da fatura', () => {
  const names = (list: CreditCardTransaction[]) => list.map((item) => item.merchant);

  it('põe as parceladas antes das avulsas e a mais adiantada primeiro', () => {
    // 9/10 é compra mais antiga que 1/8, mesmo tendo sido lançada num dia maior do mês.
    const quaseAcabando = tx({ merchant: 'CASAS BAHIA', date: '28/10', type: 'INSTALLMENT', installmentCurrent: 9, installmentTotal: 10 });
    const comecando = tx({ merchant: 'NETSHOES', date: '13/10', type: 'INSTALLMENT', installmentCurrent: 1, installmentTotal: 8 });
    const avulsa = tx({ merchant: 'UBER', date: '02/10' });
    expect(names(sortInvoiceTransactions([avulsa, comecando, quaseAcabando]))).toEqual(['CASAS BAHIA', 'NETSHOES', 'UBER']);
  });

  it('em igual andamento, termina primeiro quem tem menos parcelas restando', () => {
    const meia = tx({ merchant: 'P', date: '20/10', type: 'INSTALLMENT', installmentCurrent: 1, installmentTotal: 2 });
    const sexta = tx({ merchant: 'S', date: '05/10', type: 'INSTALLMENT', installmentCurrent: 2, installmentTotal: 4 });
    expect(names(sortInvoiceTransactions([sexta, meia]))).toEqual(['P', 'S']);
  });

  it('ordena as compras avulsas do dia 1 ao 31 e joga sem dia para o fim', () => {
    const dia28 = tx({ merchant: 'MERCADO', date: '28/10' });
    const semDia = tx({ merchant: 'FARMACIA' });
    const dia03 = tx({ merchant: 'PADARIA', date: '03/10' });
    expect(names(sortInvoiceTransactions([dia28, semDia, dia03]))).toEqual(['PADARIA', 'MERCADO', 'FARMACIA']);
  });

  it('não reordena as linhas dentro da fatura salva, só a exibição', () => {
    const original = [tx({ merchant: 'B', date: '20/10' }), tx({ merchant: 'A', date: '01/10' })];
    expect(names(sortInvoiceTransactions(original))).toEqual(['A', 'B']);
    expect(names(original)).toEqual(['B', 'A']);
  });
});
