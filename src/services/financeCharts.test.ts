import { describe, expect, it } from 'vitest';
import type { Bill, BudgetMonth, CreditCardInvoice, CreditCardTransaction } from '../types';
import { cardInvoiceId } from './paymentCards';
import { getCardCategoryAmountCents, getCardChartCategories, getCardChartMonths, getCategoryChartData } from './financeCharts';

function bill(overrides: Partial<Bill>): Bill {
  return {
    id: 'bill', name: 'Teste', amount: 10, category: 'compras', dueDay: 10, isPaid: false,
    type: 'mensal', month: 'Outubro', note: '', ...overrides,
  };
}

function transaction(overrides: Partial<CreditCardTransaction>): CreditCardTransaction {
  return {
    id: 'transaction', invoiceId: 'invoice', merchant: 'Teste', amountCents: 1000,
    type: 'PURCHASE', owner: 'ME', category: 'compras', ...overrides,
  };
}

function invoice(transactions: CreditCardTransaction[]): CreditCardInvoice {
  const id = cardInvoiceId('imported-invoice', 2026, 'Outubro', 'card');
  return { id, month: 'Outubro', year: 2026, cardId: 'card', transactions: transactions.map((item) => ({ ...item, invoiceId: id })) };
}

function month(name: string, index: number): BudgetMonth {
  return { id: `month-${index}`, name, year: 2026, income: 0, bills: [] };
}

describe('finance chart data', () => {
  it('usa os mesmos totais e percentuais do gráfico de categorias', () => {
    const bills = [
      bill({ id: 'plain', amount: 25, isOnCreditCard: false }),
      bill({ id: 'pending', name: 'Parcela pendente', amount: 5, type: 'parcela', installmentCurrent: 1, installmentTotal: 3 }),
      bill({ id: 'debit', amount: 90, cardPaymentMethod: 'debito_pix' }),
    ];
    const invoices = [invoice([
      transaction({ id: 'mine', amountCents: 1000 }),
      transaction({ id: 'shared', amountCents: 3000, owner: 'SHARED', personalAmountCents: 1500 }),
      transaction({ id: 'other-category', amountCents: 5000, category: 'lazer' }),
      transaction({ id: 'uncategorized', amountCents: 9000, category: undefined }),
      transaction({ id: 'refund', amountCents: 500, type: 'REFUND' }),
      transaction({ id: 'payment', amountCents: 7000, type: 'PAYMENT' }),
    ])];

    expect(getCategoryChartData(bills, invoices)).toEqual({
      totalCents: 19000,
      items: [
        { category: 'compras', cents: 14000, percentage: (14000 / 19000) * 100 },
        { category: 'lazer', cents: 5000, percentage: (5000 / 19000) * 100 },
      ],
    });
  });

  it('calcula séries do cartão pela minha parte e escolhe os quatro meses visíveis', () => {
    const months = [month('Julho', 7), month('Agosto', 8), month('Setembro', 9), month('Outubro', 10)];
    const current = {
      ...months[3],
      bills: [bill({ id: 'card-bill', amount: 5, isOnCreditCard: true })],
      creditCardInvoices: [invoice([
        transaction({ amountCents: 2000 }),
        transaction({ amountCents: 3000, owner: 'SHARED', personalAmountCents: 1000 }),
        transaction({ amountCents: 9000, category: undefined }),
        transaction({ amountCents: 8000, type: 'PAYMENT' }),
      ])],
    };
    const longHistory = [...months.slice(0, 2), current];

    expect(getCardCategoryAmountCents(current, 'compras')).toBe(3500);
    expect(getCardChartCategories(longHistory)).toEqual(['compras']);
    expect(getCardChartMonths(longHistory, 'Outubro', 2026).map((item) => item.name)).toEqual(['Julho', 'Agosto', 'Outubro']);
  });
});