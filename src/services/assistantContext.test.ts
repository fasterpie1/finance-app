import { describe, expect, it, vi } from 'vitest';
import { BILL_CATEGORY_LABELS, formatCurrency, type Bill, type BudgetMonth, type CreditCardInvoice, type CreditCardTransaction } from '../types';
import { answerAssistantQuestion, buildAssistantDataSection, buildChartDataSection, buildOverviewSection, buildProtocolSection, classifyAssistantIntents, getAssistantCategoryTotals, getCardMonthTotalsCents, monthLabel, resolveMonthRef, type AssistantUniverse } from './assistantContext';
import { amountToCents, centsToAmount, getCardCharges, getChargeImpactCents, getMonthPlannedCents, getPersonalImpactCents } from './cardTransactions';
import { cardInvoiceId, type PaymentCard } from './paymentCards';

const cardC6: PaymentCard = { id: 'card_c6', bank: 'C6', last4: '8649' };
let fixtureId = 0;

function transaction(over: Partial<CreditCardTransaction>): CreditCardTransaction {
  return {
    id: `tx_test_${++fixtureId}`,
    invoiceId: 'invoice-1',
    merchant: 'Loja Teste',
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
  const id = cardInvoiceId('imported-invoice', 2026, 'Outubro', cardId);
  return { id, month: 'Outubro', year: 2026, cardId, transactions: transactions.map((item) => ({ ...item, invoiceId: id })) };
}

function bill(over: Partial<Bill>): Bill {
  return {
    id: `bill_test_${++fixtureId}`, name: 'Conta Teste', amount: 19.9, category: 'assinatura',
    dueDay: 10, isPaid: false, type: 'mensal', month: 'Outubro', note: '', ...over,
  };
}

function manualBillsMonth(): BudgetMonth {
  const imported = bill({ name: 'Serviço Teste', isOnCreditCard: true, cardId: cardC6.id });
  return monthWith({
    creditCardInvoices: [invoiceOf(cardC6.id, [transaction({ merchant: 'SERVIÇO TESTE', amountCents: amountToCents(imported.amount), category: 'assinatura' })])],
    bills: [
      imported,
      { ...imported, id: `${imported.id}_segunda` },
      bill({ name: 'Parcela Teste', amount: 12.34, category: 'compras', type: 'parcela', installmentCurrent: 1, installmentTotal: 3 }),
      bill({ name: 'Conta Fora Teste', amount: 42.35, category: 'compras', isPaid: true }),
      bill({ name: 'Débito Teste', amount: 9.87, category: 'compras', isOnCreditCard: true, cardPaymentMethod: 'debito_pix' }),
    ],
  });
}

function adjustedMonth(): BudgetMonth {
  return monthWith({
    creditCardInvoices: [{
      ...invoiceOf(cardC6.id, [
        transaction({ merchant: 'Compra Teste', amountCents: 12345, category: 'compras' }),
        transaction({ merchant: 'Divisão Teste', amountCents: 30000, category: 'compras', owner: 'SHARED', personalAmountCents: 7500, thirdPartyName: 'Pessoa Teste' }),
        transaction({ merchant: 'Terceiro Teste', amountCents: 20000, category: 'compras', owner: 'THIRD_PARTY', thirdPartyName: 'Pessoa Teste' }),
        transaction({ merchant: 'Estorno Teste', amountCents: 2345, category: 'compras', type: 'REFUND' }),
        transaction({ merchant: 'Estorno Divisão Teste', amountCents: 2000, category: 'compras', type: 'REFUND', owner: 'SHARED', personalAmountCents: 500 }),
        transaction({ merchant: 'Estorno Terceiro Teste', amountCents: 1000, category: 'compras', type: 'REFUND', owner: 'THIRD_PARTY' }),
        transaction({ merchant: 'Sem Categoria Teste', amountCents: 5000, owner: 'UNCLASSIFIED' }),
        transaction({ merchant: 'Pagamento Teste', amountCents: 100000, category: 'compras', type: 'PAYMENT' }),
        transaction({ merchant: 'Pagamento Sem Categoria Teste', amountCents: 50000, type: 'PAYMENT' }),
      ]),
      statementTotalCents: 98765,
    }],
    bills: [bill({ name: 'Conta Manual Teste', amount: 31.27, category: 'compras', isOnCreditCard: true })],
  });
}

// Dados exclusivamente sintéticos: lazer de terceiro e compras compartilhadas.
const october = monthWith({
  id: 'out',
  creditCardInvoices: [invoiceOf(cardC6.id, [
    transaction({ merchant: 'Cinema', amountCents: 21000, category: 'lazer', owner: 'THIRD_PARTY', thirdPartyName: 'Pessoa Teste', date: '2026-10-05' }),
    transaction({ merchant: 'Mercado', amountCents: 30000, category: 'compras', owner: 'SHARED', thirdPartyName: 'Pessoa Teste', personalAmountCents: 15000 }),
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
    expect(text).toContain('de terceiro (Pessoa Teste)');
  });

  it('escreve a divisão do compartilhado nos dois números', () => {
    const text = plain(buildAssistantDataSection(universeOf(october, [september, october]), october));
    const compras = text.split('\n').find((line) => line.startsWith('- Compras:'));
    expect(compras).toContain('bruto R$ 300,00');
    expect(compras).toContain('minha parte R$ 150,00');
  });

  it('mantém as categorias do mês aberto ao carregar o detalhe de outro mês', () => {
    const text = plain(buildAssistantDataSection(universeOf(october, [september, october]), september));
    expect(text).toContain('Categorias do mês aberto Outubro 2026 para comparação:');
    expect(text).toContain('- Compras: bruto R$ 300,00 | minha parte R$ 150,00 | 1 lançamento(s)');
    expect(text).toContain('Categorias de Setembro 2026');
  });

  it('lista todo mês numa linha e marca o mês aberto na tela', () => {
    const overview = buildOverviewSection(universeOf(october, [september, october]));
    expect(overview).toContain('- Setembro 2026:');
    expect(overview).toContain('- Outubro 2026 ← mês aberto na tela:');
    expect(overview.match(/^- /gm)?.length).toBe(2);
  });

  it('fornece ao assistente os valores e percentuais que aparecem nos gráficos', () => {
    const chartData = plain(buildChartDataSection(universeOf(october, [september, october])));
    expect(chartData).toContain('GRÁFICO DE DESPESAS POR CATEGORIA (Outubro 2026): total R$ 150,00');
    expect(chartData).toContain('- Fatia Compras: R$ 150,00 | 100.0%');
    expect(chartData).toContain('GRÁFICO DE EVOLUÇÃO NO CARTÃO');
    expect(chartData).toContain('- Série Compras: Setembro 2026 R$ 0,00 | Outubro 2026 R$ 150,00');
  });

  it('seleciona dados e regras conforme a intenção, sem enviar gráficos para consulta de categoria', () => {
    const universe = universeOf(october, [september, october]);
    const categoryContext = buildAssistantDataSection(universe, october, false, ['category']);
    const categoryProtocol = buildProtocolSection(universe, ['category']);
    expect(categoryContext).toContain('Categorias de Outubro 2026');
    expect(categoryContext).not.toContain('GRÁFICO DE EVOLUÇÃO');
    expect(categoryContext).not.toContain('MESES CADASTRADOS');
    expect(categoryProtocol).toContain('Categorias: diferencie bruto');
    expect(categoryProtocol).not.toContain('Ações aceitas');
    expect(categoryProtocol).not.toContain('Agenda:');
  });

  it('envia fontes de renda e metas apenas quando a intenção pede esses campos', () => {
    const month = {
      ...october,
      incomeSources: [{ id: 'salary', label: 'Salário', amount: 5000 }],
      savingsGoal: 800,
      savingsGoalMode: 'manual' as const,
      savedAmount: 200,
    };
    const universe = universeOf(month, [month]);
    const diagnosis = buildAssistantDataSection(universe, month, false, ['diagnosis']);
    const goal = buildAssistantDataSection(universe, month, false, ['goal']);
    expect(diagnosis).toContain('Salário R$');
    expect(diagnosis).not.toContain('Meta manual de poupança');
    expect(goal).toContain('Meta manual de poupança de Outubro 2026: R$');
    expect(goal).toContain('guardado R$');
    expect(goal).toContain('25% atingido');
    expect(goal).not.toContain('Salário');
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

  it('inclui contas manuais no cartão certo e cartões sem lançamentos importados', () => {
    const cardNubank: PaymentCard = { id: 'card_nb', bank: 'Nubank', last4: '6852' };
    const bill = { id: 'wellhub', name: 'Wellhub', amount: 137.5, category: 'assinatura' as const, dueDay: 10, isPaid: false, type: 'mensal' as const, month: 'Outubro', note: '', isOnCreditCard: true, cardId: cardC6.id };
    const month = monthWith({
      creditCardInvoices: [invoiceOf(cardC6.id, [transaction({ merchant: 'Uber', amountCents: 3400 })])],
      bills: [bill, { ...bill, id: 'cloud', name: 'Cloud Apple', amount: 19.9 }, { ...bill, id: 'nb', name: 'Netflix', amount: 30, cardId: cardNubank.id }, { ...bill, id: 'sem', name: 'Sem cartão', amount: 20, cardId: undefined }, { ...bill, id: 'pix', amount: 10, cardPaymentMethod: 'debito_pix' }],
    });
    const cards = [cardC6, cardNubank];
    expect(getCardMonthTotalsCents(month.creditCardInvoices ?? [], month.bills, cards)).toEqual([
      { cardId: cardC6.id, cents: 19140 },
      { cardId: cardNubank.id, cents: 3000 },
      { cardId: undefined, cents: 2000 },
    ]);
    const text = plain(buildAssistantDataSection({ ...universeOf(month, [month]), cards }, month));
    expect(text).toContain('C6 8649 R$ 191,40');
    expect(text).toContain('Nubank 6852 R$ 30,00');
    expect(text.split('\n').find((line) => line.startsWith('- Wellhub ('))).toContain('no cartão C6 8649');
    expect(text.split('\n').find((line) => line.startsWith('- Netflix ('))).toContain('no cartão Nubank 6852');
  });

  it('uma conta sem cartão herda o único cadastrado, mesmo sem fatura', () => {
    const bills = [{ id: 'cloud', name: 'Cloud Apple', amount: 19.9, category: 'assinatura' as const, dueDay: 1, isPaid: false, type: 'mensal' as const, month: 'Outubro', note: '', isOnCreditCard: true }];
    expect(getCardMonthTotalsCents([], bills, [cardC6])).toEqual([{ cardId: cardC6.id, cents: 1990 }]);
    expect(getCardMonthTotalsCents([], bills, [])).toEqual([{ cardId: undefined, cents: 1990 }]);
  });

  it('uma linha importada não absorve duas contas iguais ao repartir os totais', () => {
    const bill = { id: 'cloud1', name: 'Cloud Apple', amount: 19.9, category: 'assinatura' as const, dueDay: 1, isPaid: false, type: 'mensal' as const, month: 'Outubro', note: '', isOnCreditCard: true, cardId: cardC6.id };
    const invoices = [invoiceOf(cardC6.id, [transaction({ merchant: 'APPLE.COM/BILL', amountCents: 1990 })])];
    expect(getCardMonthTotalsCents(invoices, [bill, { ...bill, id: 'cloud2' }], [cardC6])).toEqual([{ cardId: cardC6.id, cents: 3980 }]);
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

function translate(key: string, params?: Record<string, string | number>): string {
  return JSON.stringify({ key, params });
}

function cardSummaryParams(month: BudgetMonth, universe: AssistantUniverse): Record<string, string> {
  const charges = getCardCharges(month.creditCardInvoices ?? [], month.bills);
  return {
    month: monthLabel(month),
    personal: universe.money(centsToAmount(charges.personalCents)),
    invoice: universe.money(centsToAmount(charges.totalCents)),
  };
}

describe('getAssistantCategoryTotals', () => {
  it.each<Partial<CreditCardTransaction>>([
    { type: 'PURCHASE', owner: 'ME' },
    { type: 'PURCHASE', owner: 'THIRD_PARTY' },
    { type: 'PURCHASE', owner: 'SHARED', personalAmountCents: 2500 },
    { type: 'PURCHASE', owner: 'UNCLASSIFIED' },
    { type: 'REFUND', owner: 'ME' },
    { type: 'REFUND', owner: 'THIRD_PARTY' },
    { type: 'REFUND', owner: 'SHARED', personalAmountCents: 2500 },
    { type: 'PAYMENT', owner: 'ME' },
  ])('usa os impactos oficiais de $type/$owner e não conta pagamentos', (over) => {
    const item = transaction({ category: 'compras', ...over });
    const month = monthWith({ creditCardInvoices: [invoiceOf(cardC6.id, [item])] });
    const universe = universeOf(month, [month]);
    expect(getAssistantCategoryTotals(month, universe)).toEqual(item.type === 'PAYMENT' ? [] : [{
      label: universe.categoryLabel('compras'),
      personalCents: getPersonalImpactCents(item),
      chargeCents: getChargeImpactCents(item),
      count: 1,
    }]);
  });

  it('agrupa categorias e sem categoria, conta estornos e ordena pelo bruto', () => {
    const items = [
      transaction({ category: 'categoria_teste', amountCents: 10000 }),
      transaction({ category: 'categoria_teste', amountCents: 2500, type: 'REFUND' }),
      transaction({ category: 'categoria_teste', amountCents: 99000, type: 'PAYMENT' }),
      transaction({ category: 'lazer', amountCents: 15000, owner: 'THIRD_PARTY' }),
      transaction({ amountCents: 6000, owner: 'UNCLASSIFIED' }),
      transaction({ amountCents: 1000, type: 'REFUND', owner: 'UNCLASSIFIED' }),
      transaction({ amountCents: 99000, type: 'PAYMENT' }),
    ];
    const month = monthWith({ creditCardInvoices: [invoiceOf(cardC6.id, items)] });
    const universe = universeOf(month, [month]);
    universe.categoryLabel = (category) => category === 'categoria_teste' ? 'Categoria Teste' : BILL_CATEGORY_LABELS[category as keyof typeof BILL_CATEGORY_LABELS];
    expect(getAssistantCategoryTotals(month, universe)).toEqual([
      { label: 'Lazer', personalCents: getPersonalImpactCents(items[3]), chargeCents: getChargeImpactCents(items[3]), count: 1 },
      { label: 'Categoria Teste', personalCents: getPersonalImpactCents(items[0]) + getPersonalImpactCents(items[1]), chargeCents: getChargeImpactCents(items[0]) + getChargeImpactCents(items[1]), count: 2 },
      { label: 'Sem categoria', personalCents: getPersonalImpactCents(items[4]) + getPersonalImpactCents(items[5]), chargeCents: getChargeImpactCents(items[4]) + getChargeImpactCents(items[5]), count: 2 },
    ]);
  });

  it('preserva uma categoria zerada por estorno quando há lançamentos', () => {
    const items = [transaction({ category: 'compras' }), transaction({ category: 'compras', type: 'REFUND' }), transaction({ category: 'compras', type: 'PAYMENT' })];
    const month = monthWith({ creditCardInvoices: [invoiceOf(cardC6.id, items)] });
    const universe = universeOf(month, [month]);
    expect(getAssistantCategoryTotals(month, universe)).toEqual([{ label: 'Compras', personalCents: 0, chargeCents: 0, count: 2 }]);
    expect(buildAssistantDataSection(universe, month, false)).toContain(`- Compras: bruto ${universe.money(0)} | minha parte ${universe.money(0)} | 2 lançamento(s)`);
  });

  it('deduplica contas importadas uma a uma e inclui parcelas, contas pagas e débito/Pix', () => {
    const month = manualBillsMonth();
    const universe = universeOf(month, [month]);
    const charges = getCardCharges(month.creditCardInvoices ?? [], month.bills);
    expect(charges.pendingBills.map((item) => item.id)).toEqual([month.bills[1].id, month.bills[2].id]);
    const imported = month.creditCardInvoices![0].transactions[0];
    const purchasesCents = month.bills.slice(2).reduce((sum, item) => sum + amountToCents(item.amount), 0);
    expect(getAssistantCategoryTotals(month, universe)).toEqual([
      { label: 'Compras', personalCents: purchasesCents, chargeCents: purchasesCents, count: 3 },
      {
        label: 'Assinatura',
        personalCents: getPersonalImpactCents(imported) + amountToCents(month.bills[1].amount),
        chargeCents: getChargeImpactCents(imported) + amountToCents(month.bills[1].amount),
        count: 2,
      },
    ]);
  });
});

describe('answerAssistantQuestion', () => {
  it('classifica intenções combinadas sem enviar instruções não relacionadas', () => {
    const universe = universeOf(october, [september, october]);
    const comparison = classifyAssistantIntents('Quanto gastei com compras comparado ao mês passado?', universe);
    expect(comparison).toEqual(expect.arrayContaining(['category', 'comparison']));
    expect(classifyAssistantIntents('Analise o gráfico de evolução', universe)).toContain('chart');
    expect(classifyAssistantIntents('Quais contas vencem esta semana?', universe)).toContain('bills');
    expect(classifyAssistantIntents('O que você consegue fazer no app?', universe)).toContain('app_help');
  });

  it('classifica comparação de categoria e calcula no app sem inferir melhora no mês parcial', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
    try {
      const previous = monthWith({ id: 'set', name: 'Setembro', year: 2026, creditCardInvoices: [invoiceOf(cardC6.id, [transaction({ amountCents: 29943, category: 'compras' })])] });
      const current = monthWith({ id: 'out', name: 'Outubro', year: 2026, creditCardInvoices: [invoiceOf(cardC6.id, [transaction({ amountCents: 214179, category: 'compras' })])] });
      const universe = universeOf(current, [previous, current]);
      const question = 'Quanto gastei com compras no mês passado, comparado a esse mês?';
      expect(classifyAssistantIntents(question, universe)).toEqual(expect.arrayContaining(['category', 'comparison']));
      const t = vi.fn(translate);
      expect(answerAssistantQuestion(question, universe, t)).toBe(translate('assistantCategoryComparison', {
        category: 'Compras', previousMonth: 'Setembro 2026', currentMonth: 'Outubro 2026',
        previousTotal: universe.money(299.43), currentTotal: universe.money(2141.79),
        previousPersonal: universe.money(299.43), currentPersonal: universe.money(2141.79),
        previousCount: 1, currentCount: 1, difference: universe.money(1842.36),
        percentage: translate('assistantPartialMonthComparison'), periodNote: translate('assistantPartialMonthNote'),
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('responde localmente a consultas de categoria além de Compras', () => {
    const universe = universeOf(october, [september, october]);
    const t = vi.fn(translate);
    const text = answerAssistantQuestion('Quanto gastei com lazer?', universe, t);
    expect(text).toContain('assistantCategorySummary');
    expect(t).toHaveBeenCalledExactlyOnceWith('assistantCategorySummary', expect.objectContaining({
      category: 'Lazer', total: universe.money(210), personal: universe.money(0), count: 1,
    }));
  });

  it.each(['oi', ' OLÁ!!! ', 'Oi  tudo  bem?', 'Olá tudo bem.', 'Bom dia!', 'Boa tarde', 'Boa noite', 'hello', 'HI!', 'Hello how are you?'])('responde à saudação %s localmente', (question) => {
    const t = vi.fn(translate);
    expect(answerAssistantQuestion(question, universeOf(october, [october]), t)).toBe(translate('assistantGreeting'));
    expect(t.mock.calls).toEqual([['assistantGreeting']]);
  });

  it.each(['Como estou indo financeiramente este mês?', 'How am I doing financially this month?'])('preserva os números oficiais do dashboard: %s', (question) => {
    const universe = universeOf(october, [september, october]);
    universe.dashboard = { totalPlanned: 4321.98, totalPaid: 765.43, remaining: 2468.13 };
    // Os valores fornecidos são deliberadamente diferentes de qualquer recálculo dos lançamentos.
    expect(centsToAmount(getMonthPlannedCents(october.bills, october.creditCardInvoices ?? []))).not.toBe(universe.dashboard.totalPlanned);
    expect(october.income - universe.dashboard.totalPlanned).not.toBe(universe.dashboard.remaining);
    const params = {
      month: monthLabel(october), income: universe.money(october.income),
      planned: universe.money(universe.dashboard.totalPlanned), paid: universe.money(universe.dashboard.totalPaid),
      pending: universe.money(universe.dashboard.totalPlanned - universe.dashboard.totalPaid), remaining: universe.money(universe.dashboard.remaining),
    };
    const t = vi.fn(translate);
    expect(answerAssistantQuestion(question, universe, t)).toBe(translate('assistantMonthSummary', params));
    expect(t.mock.calls).toEqual([['assistantMonthSummary', params]]);
  });

  it.each(['O que gastei em Compras?', 'Quanto eu gastei este mês com compras?', 'Quanto gastei na categoria compras?', 'Qual é o total de compras nesse mês?', 'How much did I spend on purchases?', 'How much have I spent this month on shopping?'])('separa fatura e categoria na pergunta ambígua: %s', (question) => {
    const month = adjustedMonth();
    const universe = universeOf(month, [month]);
    const charges = getCardCharges(month.creditCardInvoices ?? [], month.bills);
    const category = getAssistantCategoryTotals(month, universe).find((entry) => entry.label === 'Compras')!;
    expect(charges.totalCents).not.toBe(category.chargeCents);
    expect(category.count).toBe(7); // Seis compras/estornos e uma conta; PAYMENT não entra.
    const card = cardSummaryParams(month, universe);
    const purchases = { personal: universe.money(centsToAmount(category.personalCents)), total: universe.money(centsToAmount(category.chargeCents)) };
    const t = vi.fn(translate);
    expect(answerAssistantQuestion(question, universe, t)).toBe([
      translate('assistantCardSummary', card),
      translate('assistantPurchasesCategory', purchases),
      translate('assistantUncategorized', { count: 1 }),
    ].join('\n'));
    expect(t.mock.calls).toEqual([
      ['assistantCardSummary', card], ['assistantPurchasesCategory', purchases], ['assistantUncategorized', { count: 1 }],
    ]);
  });

  it.each(['Qual é o total da fatura deste mês?', 'Quanto eu gastei no cartão nesse mês?', 'What is my card invoice total?'])('usa a fatura oficial, terceiros, compartilhados e estornos sem somar pagamentos: %s', (question) => {
    const month = adjustedMonth();
    const universe = universeOf(month, [month]);
    const params = cardSummaryParams(month, universe);
    const t = vi.fn(translate);
    expect(answerAssistantQuestion(question, universe, t)).toBe(translate('assistantCardSummary', params));
    expect(t.mock.calls).toEqual([['assistantCardSummary', params]]);
  });

  it('mostra zero na categoria sem esconder compras de outras categorias no cartão', () => {
    const month = monthWith({ creditCardInvoices: [invoiceOf(cardC6.id, [
      transaction({ category: 'compras' }), transaction({ category: 'compras', type: 'REFUND' }),
      transaction({ category: 'compras', type: 'PAYMENT' }), transaction({ category: 'lazer', amountCents: 21000, owner: 'THIRD_PARTY' }),
    ])] });
    const universe = universeOf(month, [month]);
    const t = vi.fn(translate);
    expect(answerAssistantQuestion('Quanto gastei em compras?', universe, t)).toBe([
      translate('assistantCardSummary', cardSummaryParams(month, universe)),
      translate('assistantPurchasesCategory', { personal: universe.money(0), total: universe.money(0) }),
    ].join('\n'));
    expect(t).toHaveBeenCalledTimes(2);
  });

  it('uma categoria inexistente não implica fatura zerada e pagamentos não viram sem categoria', () => {
    const month = monthWith({ creditCardInvoices: [invoiceOf(cardC6.id, [
      transaction({ category: 'lazer', owner: 'THIRD_PARTY' }), transaction({ type: 'PAYMENT' }),
    ])] });
    const universe = universeOf(month, [month]);
    const t = vi.fn(translate);
    expect(answerAssistantQuestion('Qual o total compras?', universe, t)).toBe([
      translate('assistantCardSummary', cardSummaryParams(month, universe)),
      translate('assistantPurchasesCategory', { personal: universe.money(0), total: universe.money(0) }),
    ].join('\n'));
    expect(t).toHaveBeenCalledTimes(2);
  });

  it('responde usando contas manuais deduplicadas, inclusive as fora do cartão', () => {
    const month = manualBillsMonth();
    const universe = universeOf(month, [month]);
    const purchases = getAssistantCategoryTotals(month, universe).find((entry) => entry.label === 'Compras')!;
    const t = vi.fn(translate);
    expect(answerAssistantQuestion('Quanto gastei em compras?', universe, t)).toBe([
      translate('assistantCardSummary', cardSummaryParams(month, universe)),
      translate('assistantPurchasesCategory', { personal: universe.money(centsToAmount(purchases.personalCents)), total: universe.money(centsToAmount(purchases.chargeCents)) }),
    ].join('\n'));
    expect(t).toHaveBeenCalledTimes(2);
  });

  it.each([
    'Adicione uma compra de 20 reais', 'Mude a categoria de compras para lazer', 'Marque a fatura como paga',
    'Oi, adicione uma compra', 'Qual é o total da fatura e marque como paga', 'Quanto gastei em compras? Depois exclua a compra',
    'Quanto gastei no cartão mês passado?', 'Qual é o total da fatura de Setembro 2026?',
    'Como estou indo financeiramente em setembro?', 'How much did I spend last month on purchases?',
    'Qual o total de compras em novembro?', 'Onde posso economizar?',
  ])('não intercepta alterações, outro mês ou perguntas não suportadas: %s', (question) => {
    const universe = universeOf(october, [september, october]);
    const before = structuredClone({ months: universe.months, dashboard: universe.dashboard });
    const t = vi.fn(translate);
    expect(answerAssistantQuestion(question, universe, t)).toBeNull();
    expect(t).not.toHaveBeenCalled();
    expect({ months: universe.months, dashboard: universe.dashboard }).toEqual(before);
  });
});

describe('buildAssistantDataSection sem detalhes', () => {
  it('preserva dashboard, fatura oficial e categorias completas, sem nomes de contas, pessoas ou estabelecimentos', () => {
    const month = adjustedMonth();
    const universe = universeOf(month, [september, month]);
    const full = buildAssistantDataSection(universe, month);
    const compact = buildAssistantDataSection(universe, month, false);
    const charges = getCardCharges(month.creditCardInvoices ?? [], month.bills);
    expect(compact).toContain(`Entrada ${universe.money(month.income)} | previsto em contas ${universe.money(universe.dashboard.totalPlanned)} | já pago ${universe.money(universe.dashboard.totalPaid)} | pendente ${universe.money(universe.dashboard.totalPlanned - universe.dashboard.totalPaid)} | sobra prevista ${universe.money(universe.dashboard.remaining)}`);
    expect(compact).toContain(`Fatura ${monthLabel(month)}: bruto ${universe.money(centsToAmount(charges.totalCents))} | minha parte ${universe.money(centsToAmount(charges.personalCents))} | terceiros ${universe.money(centsToAmount(charges.thirdPartyCents))}`);
    expect(compact).toContain(buildOverviewSection(universe));
    const categoryLines = (text: string) => text.split('\n').filter((line) => line.startsWith('- ') && line.includes(': bruto '));
    expect(categoryLines(compact)).toEqual(categoryLines(full));
    for (const entry of getAssistantCategoryTotals(month, universe)) {
      expect(compact).toContain(`- ${entry.label}: bruto ${universe.money(centsToAmount(entry.chargeCents))} | minha parte ${universe.money(centsToAmount(entry.personalCents))} | ${entry.count} lançamento(s)`);
    }
    for (const item of month.creditCardInvoices!.flatMap((invoice) => invoice.transactions)) {
      expect(compact).not.toContain(item.merchant);
      if (item.thirdPartyName) expect(compact).not.toContain(item.thirdPartyName);
    }
    for (const item of month.bills) {
      expect(full).toContain(item.name);
      expect(compact).not.toContain(item.name);
    }
    expect(full).toContain('Compra Teste');
    expect(compact).not.toContain('Contas lançadas em');
    expect(compact).not.toContain('Lançamentos da fatura de');
    expect(compact).toContain('peça get_month_detail');
  });

  it('mantém o dashboard do mês aberto e as categorias do mês de detalhe solicitado', () => {
    const detail = { ...manualBillsMonth(), id: 'detail_test', name: 'Setembro' };
    const universe = universeOf(october, [detail, october]);
    const compact = buildAssistantDataSection(universe, detail, false);
    expect(compact).toContain('Mês aberto na tela: Outubro 2026');
    expect(compact).toContain('MÊS: Setembro 2026');
    for (const entry of getAssistantCategoryTotals(detail, universe)) {
      expect(compact).toContain(`- ${entry.label}: bruto ${universe.money(centsToAmount(entry.chargeCents))} | minha parte ${universe.money(centsToAmount(entry.personalCents))} | ${entry.count} lançamento(s)`);
    }
    for (const item of detail.bills) expect(compact).not.toContain(item.name);
  });
});
