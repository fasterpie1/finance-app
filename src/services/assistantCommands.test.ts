import { describe, expect, it } from 'vitest';
import { BILL_CATEGORY_LABELS, formatCurrency, type BudgetMonth, type CategoryId, type CreditCardInvoice, type CreditCardTransaction } from '../types';
import { cardInvoiceId, type PaymentCard } from './paymentCards';
import { findCategoryId, planAssistantCommand, type AssistantCommand, type AssistantCommandHost, type TransactionPatch } from './assistantCommands';
import { type AssistantUniverse } from './assistantContext';
import { type CardMoveTarget, type CreditCardPurchase } from '../store/useDashboard';

const cardC6: PaymentCard = { id: 'card_c6', bank: 'C6', last4: '8649' };
const cardNubank: PaymentCard = { id: 'card_nb', bank: 'Nubank', last4: '6852' };

function transaction(over: Partial<CreditCardTransaction>): CreditCardTransaction {
  return { id: `tx_${Math.random().toString(36).slice(2, 8)}`, invoiceId: 'legacy', merchant: 'Loja', amountCents: 10000, type: 'PURCHASE', owner: 'ME', ...over };
}

function invoiceOf(id: string, cardId: string | undefined, transactions: CreditCardTransaction[]): CreditCardInvoice {
  return { id, month: 'Outubro', year: 2026, cardId, transactions };
}

/** A fatura do print: compras antigas sem cartão e uma compra do cartão C6 já identificada. */
const legacyTx = transaction({ id: 'tx_legado_a', invoiceId: 'inv_legacy', merchant: 'Posto Shell', amountCents: 18053, date: '2026-10-03' });
const legacyTx2 = transaction({ id: 'tx_legado_b', invoiceId: 'inv_legacy', merchant: 'Farmácia', amountCents: 9800, category: 'saude', date: '2026-10-07' });
const c6Tx = transaction({ id: 'tx_c6', invoiceId: 'inv_c6', merchant: 'Uber', amountCents: 3400, category: 'transporte' });

const october: BudgetMonth = {
  id: 'out',
  name: 'Outubro',
  year: 2026,
  income: 5000,
  bills: [{ id: 'bill_luz', name: 'Luz', amount: 120, category: 'moradia', dueDay: 10, isPaid: false, type: 'mensal', month: 'Outubro', note: '' }],
  creditCardInvoices: [
    invoiceOf('inv_legacy', undefined, [legacyTx, legacyTx2]),
    invoiceOf('inv_c6', cardC6.id, [c6Tx]),
  ],
};

const september: BudgetMonth = { id: 'set', name: 'Setembro', year: 2026, income: 4800, bills: [] };

const universe: AssistantUniverse = {
  months: [september, october],
  cards: [cardC6, cardNubank],
  selectedMonth: october,
  money: (amount) => formatCurrency(amount),
  categoryLabel: (category) => BILL_CATEGORY_LABELS[category as keyof typeof BILL_CATEGORY_LABELS] ?? category,
  categoryNames: ['Saúde', 'Transporte', 'Mercado'],
  dashboard: { totalPlanned: 120, totalPaid: 0, remaining: 4880 },
};

interface Call {
  ids: string[];
  patch?: TransactionPatch;
  target?: CardMoveTarget;
  purchase?: CreditCardPurchase;
  invoiceIds?: string[];
  billIds?: string[];
  bank?: string;
  last4?: string;
  label?: string;
}

function hostOf() {
  const calls: Record<string, Call[]> = { patch: [], move: [], add: [], pay: [], unpay: [], createCard: [], createCategory: [] };
  const host: AssistantCommandHost = {
    universe,
    patchTransactions: (ids, patch) => { calls.patch.push({ ids, patch }); },
    moveTransactions: (ids, target) => { calls.move.push({ ids, target }); },
    addPurchase: (purchase) => { calls.add.push({ ids: [], purchase }); },
    payCard: (invoiceIds, billIds) => { calls.pay.push({ ids: [], invoiceIds, billIds }); },
    unpayCard: (invoiceIds, billIds) => { calls.unpay.push({ ids: [], invoiceIds, billIds }); },
    createCard: (bank, last4) => {
      calls.createCard.push({ ids: [], bank, last4 });
      return bank === 'C6' ? cardC6 : { id: 'card_new', bank, last4 };
    },
    findCategory: (label) => findCategoryId(label, [
      { value: 'saude', label: 'Saúde' },
      { value: 'transporte', label: 'Transporte' },
    ]),
    createCategory: (label) => {
      calls.createCategory.push({ ids: [], label });
      return `cat_${label.toLowerCase()}` as CategoryId;
    },
  };
  return { host, calls };
}

/** O O(1) do plano: nada pode tocar na store antes de Aplicar. */
function expectNoCall(calls: ReturnType<typeof hostOf>['calls']) {
  expect(calls.patch).toHaveLength(0);
  expect(calls.move).toHaveLength(0);
  expect(calls.add).toHaveLength(0);
  expect(calls.pay).toHaveLength(0);
  expect(calls.createCard).toHaveLength(0);
  expect(calls.createCategory).toHaveLength(0);
}

/** O Intl do pt-BR separa "R$" do número com espaço fino (U+202F); comparar texto exige normalizar. */
function plain(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

describe('comandos da assistente', () => {
  it('move as compras sem cartão para o cartão dito, só depois de aplicar', () => {
    const { host, calls } = hostOf();
    const command: AssistantCommand = { action: 'assign_card', card: 'cartão 8649', scope: { withoutCard: true } };
    const outcome = planAssistantCommand(command, host);
    if (outcome.kind !== 'plan') throw new Error('esperava um plano');
    expect(outcome.summary.join('\n')).toContain('C6 8649');
    expect(outcome.summary.join('\n')).toContain('2 lançamentos');
    expectNoCall(calls);

    const result = outcome.apply();
    // "cartão 8649" tem de achar o C6 já cadastrado, não criar um cartão novo.
    expect(calls.createCard).toHaveLength(0);
    expect(calls.move).toHaveLength(1);
    expect(calls.move[0].ids.sort()).toEqual(['tx_legado_a', 'tx_legado_b']);
    expect(calls.move[0].target).toEqual({
      invoiceId: cardInvoiceId('imported-invoice', 2026, 'Outubro', cardC6.id),
      cardId: cardC6.id,
      cardLabel: 'C6 8649',
    });
    expect(plain(result)).toContain('Movidos 2 lançamentos para C6 8649');
    expect(plain(result)).toContain('R$ 278,53');
  });

  it('alcance por estabelecimento marca só o lançamento pedido', () => {
    const { host, calls } = hostOf();
    const outcome = planAssistantCommand({ action: 'set_category', category: 'Saúde', scope: { merchant: 'posto' } }, host);
    if (outcome.kind !== 'plan') throw new Error('esperava um plano');
    expect(outcome.summary[0]).toContain('Saúde');
    expectNoCall(calls);
    outcome.apply();
    expect(calls.patch).toEqual([{ ids: ['tx_legado_a'], patch: { category: 'saude' } }]);
  });

  it('categoria nova só nasce dentro de apply', () => {
    const { host, calls } = hostOf();
    const plan = planAssistantCommand({ action: 'set_category', category: 'Mercado', scope: {} }, host);
    if (plan.kind !== 'plan') throw new Error('esperava um plano');
    expect(plan.summary.join('\n')).toContain('nova categoria "Mercado"');
    expectNoCall(calls);
    plan.apply();
    expect(calls.createCategory.map((call) => call.label)).toEqual(['Mercado']);
    expect((calls.patch[0].patch as { category: CategoryId }).category).toBe('cat_mercado');
  });

  it('cartão novo só nasce dentro de apply', () => {
    const { host, calls } = hostOf();
    const cardPlan = planAssistantCommand({ action: 'create_card', bank: 'Itaú', last4: '1122' }, host);
    if (cardPlan.kind !== 'plan') throw new Error('esperava um plano');
    expect(plain(cardPlan.summary.join('\n'))).toContain('Cadastrar o cartão Itaú 1122');
    expectNoCall(calls);
    cardPlan.apply();
    expect(calls.createCard).toEqual([{ ids: [], bank: 'Itaú', last4: '1122' }]);
  });

  it('marca paga a fatura do cartão pedido, não a do outro', () => {
    const { host, calls } = hostOf();
    const outcome = planAssistantCommand({ action: 'mark_paid', card: 'C6 8649' }, host);
    if (outcome.kind !== 'plan') throw new Error('esperava um plano');
    expectNoCall(calls);
    outcome.apply();
    expect(calls.pay).toEqual([{ ids: [], invoiceIds: ['inv_c6'], billIds: [] }]);
  });

  it('libera a conta pelo nome, somando o valor em reais da tela', () => {
    const { host, calls } = hostOf();
    const outcome = planAssistantCommand({ action: 'mark_unpaid', billName: 'Luz' }, host);
    if (outcome.kind !== 'plan') throw new Error('esperava um plano');
    expect(plain(outcome.summary[0])).toContain('Luz (R$ 120,00)');
    outcome.apply();
    expect(calls.unpay).toEqual([{ ids: [], invoiceIds: [], billIds: ['bill_luz'] }]);
  });

  it('recusa o mês que não está aberto na tela sem mexer em nada', () => {
    const { host, calls } = hostOf();
    const outcome = planAssistantCommand({ action: 'set_category', category: 'Saúde', month: 'Setembro 2026' }, host);
    expect(outcome.kind).toBe('answer');
    expect(outcome.kind === 'answer' && outcome.text).toContain('Abra');
    expectNoCall(calls);
  });

  it('lança compra no cartão já cadastrado, e só no aplicar', () => {
    const { host, calls } = hostOf();
    expect(planAssistantCommand({ action: 'add_purchase', name: 'Pizza' }, host)).toEqual({ kind: 'answer', text: 'Diga o valor da compra, por exemplo 129,90.' });
    expectNoCall(calls);

    const plan = planAssistantCommand({ action: 'add_purchase', name: 'Pizza', amount: 89.9, category: 'Mercado', card: 'Nubank 6852' }, host);
    if (plan.kind !== 'plan') throw new Error('esperava um plano');
    expect(plain(plan.summary.join('\n'))).toContain('Lançar Pizza — R$ 89,90 em Outubro 2026');
    expectNoCall(calls);
    plan.apply();
    expect(calls.createCategory.map((call) => call.label)).toEqual(['Mercado']);
    expect(calls.add[0].purchase).toMatchObject({ name: 'Pizza', amount: 89.9, cardId: cardNubank.id, cardLabel: 'Nubank 6852', installmentTotal: 1, owner: 'ME', category: 'cat_mercado' });
  });

  it('cadastra o cartão dito na compra, mantendo o acento do banco', () => {
    const { host, calls } = hostOf();
    const plan = planAssistantCommand({ action: 'add_purchase', name: 'Café', amount: 12.5, category: 'Saúde', card: 'Itaú 3300', installmentTotal: 3, installmentCurrent: 2 }, host);
    if (plan.kind !== 'plan') throw new Error('esperava um plano');
    expect(plain(plan.summary.join('\n'))).toContain('(2/3 de 3x)');
    expectNoCall(calls);
    plan.apply();
    expect(calls.createCard).toEqual([{ ids: [], bank: 'Itaú', last4: '3300' }]);
    expect(calls.add[0].purchase).toMatchObject({ cardId: 'card_new', cardLabel: 'Itaú 3300' });
  });

  it('diz quando nenhum lançamento bate com o alcance', () => {
    const { host } = hostOf();
    const outcome = planAssistantCommand({ action: 'set_category', category: 'Saúde', scope: { merchant: 'inexistente' } }, host);
    expect(outcome.kind === 'answer' && outcome.text).toContain('Nenhum lançamento de Outubro 2026');
  });
});

describe('nomes ditos no chat', () => {
  it('acha a categoria ignorando acento e caixa', () => {
    const options = [{ value: 'saude', label: 'Saúde' }, { value: 'lazer', label: 'Lazer' }];
    expect(findCategoryId('saude', options)).toBe('saude');
    expect(findCategoryId('  SAÚDE ', options)).toBe('saude');
    expect(findCategoryId('Mercado', options)).toBeUndefined();
  });
});
