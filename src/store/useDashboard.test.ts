import { describe, expect, it } from 'vitest';
import { getBillNotifications } from './useDashboard';
import type { Bill, BudgetMonth, CreditCardInvoice, CreditCardTransaction } from '../types';

// Uma conta de Setembro/2026 com vencimento da fatura em 30/10 está a 2 dias de vencer,
// então entra no filtro de lembretes (<= 3 dias).
const TODAY = new Date(2026, 9, 28);

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Aluguel',
    category: 'aluguel',
    amount: 500,
    dueDay: 30,
    type: 'mensal',
    isPaid: false,
    month: 'Setembro',
    note: '',
    ...overrides,
  };
}

function month(bills: Bill[], invoices: CreditCardInvoice[] = []): BudgetMonth {
  return {
    id: 'set-2026',
    name: 'Setembro',
    year: 2026,
    income: 4000,
    bills,
    creditCardInvoices: invoices,
    creditCardDueDay: 30,
  };
}

function invoice(transactions: CreditCardTransaction[], isPaid = false): CreditCardInvoice {
  return {
    id: 'imported-invoice-2026-Setembro',
    month: 'Setembro',
    year: 2026,
    isPaid,
    transactions: transactions.map((tx, index) => ({ ...tx, id: `tx-${index}`, invoiceId: 'imported-invoice-2026-Setembro' })),
  };
}

function tx(overrides: Partial<CreditCardTransaction>): CreditCardTransaction {
  return {
    id: 'tx',
    invoiceId: 'imported-invoice-2026-Setembro',
    merchant: 'ACADEMIA',
    amountCents: 10000,
    type: 'PURCHASE',
    owner: 'ME',
    ...overrides,
  };
}

describe('lembrete da fatura do cartão', () => {
  it('avisa a parcela lançada à mão mesmo sem fatura importada', () => {
    const notifications = getBillNotifications([month([
      bill({ name: 'Academia', category: 'assinatura', amount: 100, isOnCreditCard: true }),
    ])], TODAY);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ name: 'Fatura do cartão', amount: 100, daysUntilDue: 2 });
  });

  it('soma parcela e gasto importado sem contar a conta duas vezes', () => {
    const notifications = getBillNotifications([month(
      [
        bill({ name: 'Academia', category: 'assinatura', amount: 100, isOnCreditCard: true }),
        bill({ name: 'Internet', category: 'assinatura', amount: 80, type: 'parcela', installmentCurrent: 3, installmentTotal: 10 }),
      ],
      [invoice([tx({ amountCents: 10000 })])],
    )], TODAY);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].amount).toBe(180);
  });

  it('não lembra fatura já paga nem conta quitada', () => {
    const notifications = getBillNotifications([month(
      [bill({ name: 'Academia', category: 'assinatura', amount: 100, isOnCreditCard: true, isPaid: true })],
      [invoice([tx({ amountCents: 3000 })], true)],
    )], TODAY);
    expect(notifications).toEqual([]);
  });

  it('mantém o lembrete próprio da conta que não está no cartão', () => {
    const notifications = getBillNotifications([month([bill()])], TODAY);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ name: 'Aluguel', amount: 500 });
  });

  it('dá um lembrete por cartão, cada um no seu vencimento', () => {
    const cards = [
      { id: 'card_nubank', bank: 'Nubank', last4: '8649', dueDay: 31 },
      { id: 'card_wow', bank: 'Wow', last4: '1122' },
    ];
    const notifications = getBillNotifications([month([], [
      { ...invoice([tx({ amountCents: 12000 })], false), cardId: 'card_nubank' },
      { ...invoice([tx({ amountCents: 3000 })]), cardId: 'card_wow' },
    ])], TODAY, cards);
    // Wow vence no dia geral do mês (30) e Nubank no dia dele (31), na ordem das datas.
    expect(notifications.map((item) => [item.name, item.amount, item.daysUntilDue])).toEqual([
      ['Wow 1122', 30, 2],
      ['Nubank 8649', 120, 3],
    ]);
    expect(new Set(notifications.map((item) => item.billId))).toHaveLength(2);
  });

  it('paga a fatura de um cartão sem incomodar o lembrete do outro', () => {
    const cards = [{ id: 'card_nubank', bank: 'Nubank', last4: '8649' }, { id: 'card_wow', bank: 'Wow', last4: '1122' }];
    const notifications = getBillNotifications([month([], [
      { ...invoice([tx({ amountCents: 12000 })]), cardId: 'card_nubank', isPaid: true },
      { ...invoice([tx({ amountCents: 3000 })]), cardId: 'card_wow' },
    ])], TODAY, cards);
    expect(notifications.map((item) => item.name)).toEqual(['Wow 1122']);
  });

  it('com um único cartão a fatura antiga passa a levar o nome dele', () => {
    const cards = [{ id: 'card_nubank', bank: 'Nubank', last4: '8649' }];
    const notifications = getBillNotifications([month([], [invoice([tx({ amountCents: 5000 })])])], TODAY, cards);
    expect(notifications.map((item) => item.name)).toEqual(['Nubank 8649']);
  });

  it('com dois cartões a fatura antiga vence no dia geral, sem dono inventado', () => {
    const cards = [{ id: 'card_nubank', bank: 'Nubank', last4: '8649', dueDay: 5 }, { id: 'card_wow', bank: 'Wow', last4: '1122' }];
    const notifications = getBillNotifications([month([], [invoice([tx({ amountCents: 5000 })])])], TODAY, cards);
    expect(notifications.map((item) => [item.name, item.daysUntilDue])).toEqual([['Fatura do cartão', 2]]);
  });

  it('a parcela lançada na mão sem cartão escolhido vence com o único cartão cadastrado', () => {
    const cards = [{ id: 'card_nubank', bank: 'Nubank', last4: '8649' }];
    const notifications = getBillNotifications([month(
      [bill({ name: 'Academia', category: 'assinatura', amount: 100, isOnCreditCard: true })],
      [{ ...invoice([tx({ amountCents: 12000 })]), cardId: 'card_nubank' }],
    )], TODAY, cards);
    // Uma barra só: a fatura do cartão responde pela conta também.
    expect(notifications.map((item) => [item.name, item.amount])).toEqual([['Nubank 8649', 220]]);
  });

  it('com dois cartões cada conta lançada na mão vence no cartão escolhido nela', () => {
    const cards = [{ id: 'card_nubank', bank: 'Nubank', last4: '8649' }, { id: 'card_wow', bank: 'Wow', last4: '1122' }];
    const notifications = getBillNotifications([month(
      [
        bill({ name: 'Academia', category: 'assinatura', amount: 100, isOnCreditCard: true, cardId: 'card_wow' }),
        bill({ name: 'Internet', category: 'internet', amount: 50, isOnCreditCard: true }),
      ],
      [{ ...invoice([tx({ amountCents: 12000 })]), cardId: 'card_nubank' }],
    )], TODAY, cards);
    expect(notifications.map((item) => [item.name, item.amount])).toEqual([
      ['Nubank 8649', 120],
      ['Wow 1122', 100],
      ['Fatura do cartão', 50],
    ]);
  });

  it('um cartão sem fatura importada ainda tem o próprio lembrete pela conta dele', () => {
    const cards = [{ id: 'card_nubank', bank: 'Nubank', last4: '8649' }, { id: 'card_wow', bank: 'Wow', last4: '1122', dueDay: 5 }];
    const notifications = getBillNotifications([month(
      [bill({ name: 'Academia', category: 'assinatura', amount: 100, isOnCreditCard: true, cardId: 'card_wow' })],
      [{ ...invoice([tx({ amountCents: 12000 })]), cardId: 'card_nubank' }],
    )], TODAY, cards);
    expect(notifications.map((item) => `${item.name} ${item.amount}`).sort()).toEqual(['Nubank 8649 120', 'Wow 1122 100']);
    // O vencimento é o do próprio cartão, não o dia geral do mês.
    expect(notifications.find((item) => item.name === 'Wow 1122')?.dueDate.getDate()).toBe(5);
  });
});
