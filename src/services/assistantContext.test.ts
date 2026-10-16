import { describe, expect, it } from 'vitest';
import { BILL_CATEGORY_LABELS, formatCurrency, type BudgetMonth, type CreditCardInvoice, type CreditCardTransaction } from '../types';
import { buildAssistantDataSection, buildOverviewSection, getCardMonthTotalsCents, resolveMonthRef, type AssistantUniverse } from './assistantContext';
import { cardInvoiceId, type PaymentCard } from './paymentCards';

const cardC6: PaymentCard = { id: 'card_c6', bank: 'C6', last4: '8649' };

function transaction(over: Partial<CreditCardTransaction>): CreditCardTransaction {
  return {
    id: `tx_${Math.random().toString(36).slice(2, 8)}`,
    invoiceId: 'invoice-1',
    merchant: 'Loja',
    amountCents: 10000,
    type: 'PURCHASE',
    owner: 'ME',
    ...over,
  };
}

function monthWith(over: Partial<BudgetMonth>): BudgetMonth {
  return { id: 'm1', name: 'Outubro', year: 2026, income: 5000, bills: [], ...over };
}

function invoiceOf(cardId: string | undefined, transactions: CreditCardTransaction[]): CreditCardInvoice {
  return { id: cardInvoiceId('imported-invoice', 2026, 'Outubro', cardId), month: 'Outubro', year: 2026, cardId, transactions };
}

/** O mês do print que gerou a resposta errada: lazer inteiro de terceiro e compras dividido. */
const october = monthWith({
  id: 'out',
  creditCardInvoices: [invoiceOf(cardC6.id, [
    transaction({ merchant: 'Cinema', amountCents: 21000, category: 'lazer', owner: 'THIRD_PARTY', thirdPartyName: 'Marcos', date: '2026-10-05' }),
    transaction({ merchant: 'Mercado', amountCents: 30000, category: 'compras', owner: 'SHARED', thirdPartyName: 'Marcos', personalAmountCents: 15000 }),
    transaction({ merchant: 'Sem dono', amountCents: 5000 }),
  ])],
});

const september = monthWith({ id: 'set', name: 'Setembro', year: 2026, income: 4800 });

function universeOf(selected: BudgetMonth, months: BudgetMonth[]): AssistantUniverse {
  return {
    months,
    cards: [cardC6],
    selectedMonth: selected,
    money: (amount) => formatCurrency(amount),
    categoryLabel: (category) => BILL_CATEGORY_LABELS[category as keyof typeof BILL_CATEGORY_LABELS] ?? category,
    categoryNames: ['Lazer', 'Compras', 'Petshop'],
    dashboard: { totalPlanned: 1200, totalPaid: 400, remaining: 3800 },
  };
}

/** O Intl do pt-BR separa "R$" do número com espaço fino (U+202F); comparar texto exige normalizar. */
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

describe('contexto da assistente', () => {
  it('mostra o bruto da categoria mesmo quando nada dela é do usuário', () => {
    const text = plain(buildAssistantDataSection(universeOf(october, [september, october]), october));
    const lazer = text.split('\n').find((line) => line.startsWith('- Lazer:'));
    // Antes o lazer sumia do prompt (só entrava a parte do usuário) e a IA respondia "não há registros".
    expect(lazer).toContain('bruto R$ 210,00');
    expect(lazer).toContain('minha parte R$ 0,00');
    expect(text).toContain('Cinema');
    expect(text).toContain('de terceiro (Marcos)');
  });

  it('escreve a divisão do compartilhado nos dois números', () => {
    const text = plain(buildAssistantDataSection(universeOf(october, [september, october]), october));
    const compras = text.split('\n').find((line) => line.startsWith('- Compras:'));
    expect(compras).toContain('bruto R$ 300,00');
    expect(compras).toContain('minha parte R$ 150,00');
  });

  it('lista todo mês numa linha e marca o mês aberto na tela', () => {
    const overview = buildOverviewSection(universeOf(october, [september, october]));
    expect(overview).toContain('- Setembro 2026:');
    expect(overview).toContain('- Outubro 2026 ← mês aberto na tela:');
    expect(overview.match(/^- /gm)?.length).toBe(2);
  });

  it('separa por cartão a fatura que o usuário precisa organizar', () => {
    expect(getCardMonthTotalsCents(october.creditCardInvoices ?? [], october.bills, [cardC6]))
      .toEqual([{ cardId: cardC6.id, cents: 56000 }]);
    // Fatura antiga sem dono só herda o cartão quando é o único cadastrado; com dois, ela segue
    // no grupo "sem cartão" — é exatamente o que o usuário quer esvaziar pelo chat.
    const cardNubank: PaymentCard = { id: 'card_nb', bank: 'Nubank', last4: '6852' };
    const legacy = monthWith({ id: 'sem', creditCardInvoices: [invoiceOf(undefined, [transaction({ merchant: 'Antiga', amountCents: 27853 })])] });
    const text = plain(buildAssistantDataSection({ ...universeOf(legacy, [legacy]), cards: [cardC6, cardNubank] }, legacy));
    expect(text).toContain('sem cartão R$ 278,53');
    expect(text).toContain('- C6 8649');
    expect(text).toContain('- Nubank 6852');
  });

  it('cabe no orçamento de tokens com um mês cheio de lançamentos', () => {
    const many = monthWith({
      id: 'muitos',
      creditCardInvoices: [invoiceOf(cardC6.id, Array.from({ length: 80 }, (_, index) => transaction({
        merchant: `Loja ${index}`,
        amountCents: 10000 + index,
        category: 'compras',
      })))],
    });
    const text = plain(buildAssistantDataSection(universeOf(many, [many]), many));
    const lines = text.split('\n').filter((line) => line.startsWith('- sem dia | Loja '));
    expect(lines.length).toBe(60);
    expect(text).toContain('(+20 lançamentos menores nesta fatura, já contados nos totais por categoria)');
    // O total da categoria não pode perder os que ficaram de fora da lista.
    expect(text.split('\n').find((line) => line.startsWith('- Compras:'))).toContain('bruto R$ 8.031,60');
  });

  it('resolve o mês pedido sem inventar data', () => {
    const universe = universeOf(october, [september, october]);
    expect(resolveMonthRef(universe, 'atual')?.id).toBe('out');
    expect(resolveMonthRef(universe, 'mês passado')?.id).toBe('set');
    expect(resolveMonthRef(universe, 'Setembro 2026')?.id).toBe('set');
    expect(resolveMonthRef(universe, 'setembro')?.id).toBe('set');
    expect(resolveMonthRef(universe, 'Novembro 2026')).toBeUndefined();
  });
});
