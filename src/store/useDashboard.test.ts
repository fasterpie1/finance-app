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
});
