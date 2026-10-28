import { describe, expect, it } from 'vitest';
import type { Bill, BudgetMonth, CreditCardInvoice, CreditCardTransaction } from '../types';
import { projectInstallments } from './installmentProjection';

function bill(overrides: Partial<Bill>): Bill {
  return {
    id: 'bill', name: 'Conta', amount: 100, category: 'compras', dueDay: 5, isPaid: false,
    type: 'parcela', month: 'Outubro', note: '', ...overrides,
  };
}

function transaction(overrides: Partial<CreditCardTransaction>): CreditCardTransaction {
  return {
    id: 'tx', invoiceId: 'inv', merchant: 'Loja', amountCents: 10000, type: 'INSTALLMENT',
    owner: 'ME', ...overrides,
  };
}

function month(overrides: Partial<BudgetMonth> & { id: string; name: string; year: number }): BudgetMonth {
  return { income: 0, bills: [], ...overrides };
}

function invoiceWith(transactions: CreditCardTransaction[]): CreditCardInvoice[] {
  return [{ id: 'inv', month: 'Outubro', year: 2026, transactions }];
}

describe('projeção de parcelas', () => {
  it('espalha as parcelas que faltam pelos próximos meses', () => {
    const months = [month({
      id: 'Out', name: 'Outubro', year: 2026,
      creditCardInvoices: invoiceWith([transaction({ merchant: 'Geladeira', amountCents: 30000, installmentCurrent: 1, installmentTotal: 4 })]),
    })];

    const projection = projectInstallments(months, 'Out');

    expect(projection.groups).toHaveLength(1);
    expect(projection.groups[0]).toMatchObject({ name: 'Geladeira', remaining: 3, centsPerMonth: 30000 });
    expect(projection.months.map((entry) => entry.offset)).toEqual([1, 2, 3]);
    expect(projection.months[2]).toMatchObject({ cents: 30000, endingCount: 1 });
    expect(projection.remainingCents).toBe(90000);
  });

  it('soma dois grupos que terminam em meses diferentes', () => {
    const months = [month({
      id: 'Out', name: 'Outubro', year: 2026,
      creditCardInvoices: invoiceWith([
        transaction({ id: 'a', merchant: 'Geladeira', amountCents: 30000, installmentCurrent: 2, installmentTotal: 3 }),
        transaction({ id: 'b', merchant: 'Sofá', amountCents: 15000, installmentCurrent: 1, installmentTotal: 4 }),
      ]),
    })];

    const projection = projectInstallments(months, 'Out');

    // Novembro paga os dois e é onde a geladeira para; depois fica só o sofá, até Março.
    expect(projection.months[0]).toMatchObject({ offset: 1, cents: 45000, endingCount: 1 });
    expect(projection.months[1]).toMatchObject({ offset: 2, cents: 15000, endingCount: 0 });
    expect(projection.months[2]).toMatchObject({ offset: 3, cents: 15000, endingCount: 1 });
    expect(projection.currentCents).toBe(45000);
  });

  it('vira o ano sem perder o mês', () => {
    const months = [month({
      id: 'Nov', name: 'Novembro', year: 2026,
      creditCardInvoices: invoiceWith([transaction({ merchant: 'Notebook', amountCents: 20000, installmentCurrent: 1, installmentTotal: 4 })]),
    })];

    const projection = projectInstallments(months, 'Nov');

    expect(projection.months.map((entry) => `${entry.monthName} ${entry.year}`))
      .toEqual(['Dezembro 2026', 'Janeiro 2027', 'Fevereiro 2027']);
  });

  it('conta a parcela do orçamento que não está no cartão', () => {
    const months = [month({
      id: 'Out', name: 'Outubro', year: 2026,
      bills: [bill({ name: 'Carro', amount: 800, category: 'financiamento', installmentCurrent: 5, installmentTotal: 8 })],
    })];

    const projection = projectInstallments(months, 'Out');

    expect(projection.groups[0]).toMatchObject({ name: 'Carro', remaining: 3, centsPerMonth: 80000 });
  });

  it('não conta duas vezes a parcela que já está na fatura importada', () => {
    const transactions = [transaction({ merchant: 'Tênis', amountCents: 15000, installmentCurrent: 1, installmentTotal: 3 })];
    const months = [month({
      id: 'Out', name: 'Outubro', year: 2026,
      bills: [bill({ name: 'Tênis', amount: 150, isOnCreditCard: true, installmentCurrent: 1, installmentTotal: 3 })],
      creditCardInvoices: invoiceWith(transactions),
    })];

    const projection = projectInstallments(months, 'Out');

    expect(projection.groups).toHaveLength(1);
    expect(projection.currentCents).toBe(15000);
  });

  it('projeta a minha parte, não o bruto da compra dividida', () => {
    const months = [month({
      id: 'Out', name: 'Outubro', year: 2026,
      creditCardInvoices: invoiceWith([transaction({
        merchant: 'Jantar', amountCents: 40000, owner: 'SHARED', personalAmountCents: 20000,
        installmentCurrent: 1, installmentTotal: 2,
      })]),
    })];

    expect(projectInstallments(months, 'Out').months[0].cents).toBe(20000);
  });

  it('ignora o que já é a última parcela', () => {
    const months = [month({
      id: 'Out', name: 'Outubro', year: 2026,
      creditCardInvoices: invoiceWith([transaction({ merchant: 'Livro', amountCents: 6000, installmentCurrent: 2, installmentTotal: 2 })]),
    })];

    expect(projectInstallments(months, 'Out').groups).toEqual([]);
  });
});
