import { describe, expect, it } from 'vitest';
import type { Bill, BudgetMonth, CreditCardInvoice, CreditCardTransaction } from '../types';
import { findMissingCharges, findPriceChanges, findRecurringCharges, normalizeChargeName } from './recurringCharges';

function bill(overrides: Partial<Bill>): Bill {
  return {
    id: 'bill', name: 'Teste', amount: 30, category: 'compras', dueDay: 5, isPaid: false,
    type: 'variavel', month: 'Outubro', note: '', ...overrides,
  };
}

function transaction(overrides: Partial<CreditCardTransaction> = {}): CreditCardTransaction {
  return {
    id: 'tx', invoiceId: 'invoice', merchant: 'Netflix', amountCents: 3990,
    type: 'PURCHASE', owner: 'ME', category: 'compras', ...overrides,
  };
}

function invoice(id: string, transactions: CreditCardTransaction[]): CreditCardInvoice {
  return { id, month: id, year: 2026, transactions: transactions.map((tx) => ({ ...tx, invoiceId: id })) };
}

function month(id: string, bills: Bill[], creditCardInvoices?: CreditCardInvoice[]): BudgetMonth {
  return { id, name: id, year: 2026, income: 0, bills, ...(creditCardInvoices ? { creditCardInvoices } : {}) };
}

describe('assinaturas prováveis', () => {
  it('junta grafias diferentes do mesmo serviço', () => {
    expect(normalizeChargeName('NETFLIX.COM')).toBe(normalizeChargeName(' Netflix '));
    expect(normalizeChargeName('PIZZARIA NS 2000 LTDA')).toBe(normalizeChargeName('Pizzaria NS 2000'));
    expect(normalizeChargeName('Plano 1')).not.toBe(normalizeChargeName('Plano 2'));
  });

  it('reconhece o gasto variável que se repete do mês atual para trás', () => {
    const months = ['Jun', 'Jul', 'Ago', 'Out'].map((id) => month(id, [bill({ id: `${id}-netflix`, name: 'Netflix', amount: 39.9 })]));

    const found = findRecurringCharges(months, 'Out');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Netflix', monthCount: 4, minAmount: 39.9, maxAmount: 39.9 });
    expect(found[0].occurrences.map((occurrence) => occurrence.monthId)).toEqual(['Jun', 'Jul', 'Ago', 'Out']);
  });

  it('descarta cobrança que não está no mês aberto', () => {
    const months = ['Jun', 'Jul', 'Ago', 'Out'].map((id) => month(id, [
      ...(id === 'Out' ? [] : [bill({ id: `${id}-clube`, name: 'Clube do Livro', amount: 25 })]),
    ]));

    expect(findRecurringCharges(months, 'Out')).toEqual([]);
  });

  it('não chama de assinatura o que muda de preço todo mês', () => {
    const amounts = [80, 240, 120, 300];
    const months = ['Jun', 'Jul', 'Ago', 'Out'].map((id, index) => month(id, [
      bill({ id: `${id}-mercado`, name: 'Mercado', amount: amounts[index] }),
    ]));

    expect(findRecurringCharges(months, 'Out')).toEqual([]);
  });

  it('aceita reajuste pequeno e ignora o que já é assinatura, parcela ou conta fixa', () => {
    const months = ['Jun', 'Jul', 'Ago', 'Out'].map((id) => month(id, [
      bill({ id: `${id}-academia`, name: 'Academia', amount: 99.9, category: 'saude' }),
      bill({ id: `${id}-ajustado`, name: 'Academia Ajustada', amount: id === 'Out' ? 109.9 : 99.9 }),
      bill({ id: `${id}-tv`, name: 'TV por assinatura', amount: 89, category: 'assinatura' }),
      bill({ id: `${id}-celular`, name: 'Celular', amount: 79, type: 'fixa' }),
      bill({ id: `${id}-notebook`, name: 'Notebook', amount: 450, type: 'parcela', installmentCurrent: 3, installmentTotal: 10 }),
    ]));

    const found = findRecurringCharges(months, 'Out');

    expect(found.map((charge) => charge.name)).toEqual(['Academia Ajustada', 'Academia']);
  });

  it('conta meses, não lançamentos: duas cobranças no mesmo mês viram uma só sugestão', () => {
    const months = ['Jun', 'Jul', 'Out'].map((id) => month(id, [
      bill({ id: `${id}-spotify`, name: 'Spotify', amount: 21.9 }),
      bill({ id: `${id}-spotify-2`, name: 'Spotify', amount: 21.9 }),
    ]));

    const found = findRecurringCharges(months, 'Out');

    expect(found[0].monthCount).toBe(3);
    expect(found[0].occurrences).toHaveLength(6);
  });

  it('olha só os seis meses até o mês aberto', () => {
    const months = Array.from({ length: 9 }, (_, index) => month(`M${index}`, [
      bill({ id: `bill-${index}`, name: 'Revista', amount: 12 }),
    ]));

    const found = findRecurringCharges(months, 'M8');

    expect(found[0].occurrences.map((occurrence) => occurrence.monthId))
      .toEqual(['M3', 'M4', 'M5', 'M6', 'M7', 'M8']);
  });
});

describe('assinaturas prováveis nas faturas', () => {
  it('reconhece três faturas e identifica a origem de cada transação', () => {
    const months = ['Jun', 'Jul', 'Ago'].map((id, index) => month(id, [], [
      invoice(`${id}-invoice`, [transaction({
        id: `${id}-netflix`, merchant: ['NETFLIX.COM', ' Netflix ', 'Netflix app'][index],
        category: index === 2 ? 'lazer' : 'compras',
      })]),
    ]));

    const found = findRecurringCharges(months, 'Ago');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: 'netflix', name: 'Netflix app', category: 'lazer', monthCount: 3, minAmount: 39.9, maxAmount: 39.9 });
    expect(found[0].occurrences).toMatchObject(['Jun', 'Jul', 'Ago'].map((id) => ({
      monthId: id, billId: `${id}-netflix`, invoiceId: `${id}-invoice`, transactionId: `${id}-netflix`, amount: 39.9,
    })));
  });

  it('junta conta fora do cartão, conta pendente no cartão e compra importada', () => {
    const months = [
      month('Jun', [bill({ id: 'debit', name: 'NETFLIX.COM', amount: 39.9, isOnCreditCard: true, cardPaymentMethod: 'debito_pix' })]),
      month('Jul', [bill({ id: 'pending', name: 'Netflix', amount: 39.9, isOnCreditCard: true })]),
      month('Ago', [], [invoice('aug-invoice', [transaction({ id: 'imported', category: 'lazer' })])]),
    ];

    const found = findRecurringCharges(months, 'Ago');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Netflix', category: 'lazer', monthCount: 3, minAmount: 39.9, maxAmount: 39.9 });
    expect(found[0].occurrences).toMatchObject([
      { monthId: 'Jun', billId: 'debit', amount: 39.9 },
      { monthId: 'Jul', billId: 'pending', amount: 39.9 },
      { monthId: 'Ago', billId: 'imported', invoiceId: 'aug-invoice', transactionId: 'imported', amount: 39.9 },
    ]);
    expect(found[0].occurrences[0]).not.toHaveProperty('invoiceId');
    expect(found[0].occurrences[1]).not.toHaveProperty('transactionId');
  });

  it('usa só a minha parte de uma compra compartilhada, não o bruto variável', () => {
    const months = ['Jun', 'Jul', 'Ago'].map((id, index) => month(id, [], [
      invoice(id, [transaction({ owner: 'SHARED', amountCents: [9900, 15000, 6000][index], personalAmountCents: 3990 })]),
    ]));

    const found = findRecurringCharges(months, 'Ago');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ minAmount: 39.9, maxAmount: 39.9, monthCount: 3 });
    expect(found[0].occurrences.map((occurrence) => occurrence.amount)).toEqual([39.9, 39.9, 39.9]);
  });

  it('aplica o limite de variação à parte pessoal, mesmo com o bruto estável', () => {
    const months = ['Jun', 'Jul', 'Ago'].map((id, index) => month(id, [], [
      invoice(id, [transaction({ owner: 'SHARED', amountCents: 10000, personalAmountCents: [3000, 9000, 3000][index] })]),
    ]));

    expect(findRecurringCharges(months, 'Ago')).toEqual([]);
  });

  const excluded: [string, Partial<CreditCardTransaction>][] = [
    ['terceiro', { owner: 'THIRD_PARTY' }],
    ['não classificada', { owner: 'UNCLASSIFIED' }],
    ['parcela declarada como compra', { installmentTotal: 3 }],
    ['tipo parcela', { type: 'INSTALLMENT' }],
    ['pagamento', { type: 'PAYMENT' }],
    ['estorno', { type: 'REFUND' }],
    ['tarifa', { type: 'FEE' }],
    ['outro tipo', { type: 'OTHER' }],
    ['assinatura reconhecida', { category: 'assinatura' }],
    ['compartilhada sem parte pessoal', { owner: 'SHARED' }],
    ['compartilhada com parte zero', { owner: 'SHARED', personalAmountCents: 0 }],
    ['compartilhada com parte negativa', { owner: 'SHARED', personalAmountCents: -100 }],
    ['compra zero', { amountCents: 0 }],
    ['compra negativa', { amountCents: -3990 }],
  ];

  it.each(excluded)('não conta %s como o terceiro mês nem como presença no mês aberto', (_label, overrides) => {
    const months = ['Jun', 'Jul', 'Ago', 'Set'].map((id, index) => month(id, [], [
      invoice(id, [transaction(index >= 2 ? overrides : {})]),
    ]));

    expect(findRecurringCharges(months, 'Ago')).toEqual([]);
    const eligibleHistory = months.slice(0, 3).map((entry) => month(entry.id, [], [invoice(entry.id, [transaction()])]));
    expect(findRecurringCharges([...eligibleHistory, months[3]], 'Set')).toEqual([]);
  });

  it('ignora parcelas em contas variáveis mesmo se o tipo estiver incorreto', () => {
    const months = ['Jun', 'Jul', 'Ago'].map((id) => month(id, [
      bill({ name: 'Netflix', amount: 39.9, installmentTotal: 3 }),
    ]));

    expect(findRecurringCharges(months, 'Ago')).toEqual([]);
  });

  it('não duplica a conta manual correspondente à compra importada', () => {
    const months = ['Jun', 'Jul', 'Ago'].map((id) => month(id, [
      bill({ id: `${id}-manual`, name: 'Netflix', amount: 99.9, isOnCreditCard: true }),
    ], [invoice(`${id}-invoice`, [transaction({
      id: `${id}-imported`, merchant: 'NETFLIX.COM', source: 'IMPORT', owner: 'SHARED', amountCents: 9990, personalAmountCents: 3990,
    })])]));

    const found = findRecurringCharges(months, 'Ago');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ monthCount: 3, minAmount: 39.9, maxAmount: 39.9 });
    expect(found[0].occurrences).toHaveLength(3);
    expect(found[0].occurrences.every((occurrence) => occurrence.transactionId?.endsWith('-imported'))).toBe(true);
  });

  it('usa nome e categoria da última conta elegível e não de terceiros ou contas excluídas', () => {
    const months = [
      month('Jun', [], [invoice('jun-invoice', [transaction({ merchant: 'NETFLIX.COM' })])]),
      month('Jul', [bill({ name: 'Netflix', amount: 39.9 })]),
      month('Ago', [
        bill({ name: 'Netflix app', amount: 39.9, category: 'lazer' }),
        bill({ name: 'Netflix online', amount: 39.9, category: 'assinatura' }),
        bill({ name: 'Netflix oficial', amount: 39.9, type: 'fixa', category: 'outros' }),
      ], [invoice('aug-invoice', [transaction({ merchant: 'Netflix LTDA', owner: 'THIRD_PARTY', category: 'educacao' })])]),
    ];

    const found = findRecurringCharges(months, 'Ago');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Netflix app', category: 'lazer', monthCount: 3 });
    expect(found[0].occurrences).toHaveLength(3);
  });

  it('aceita compra sem categoria e usa outros sem herdar a categoria antiga', () => {
    const months = ['Jun', 'Jul', 'Ago'].map((id, index) => month(id, [], [
      invoice(id, [transaction({ category: index === 2 ? undefined : 'lazer' })]),
    ]));

    expect(findRecurringCharges(months, 'Ago')[0]).toMatchObject({ category: 'outros', monthCount: 3 });
  });

  it('some depois de marcar as ocorrências de contas e transações como assinatura pelos IDs', () => {
    const months = [
      month('Jun', [bill({ id: 'manual', name: 'Netflix', amount: 39.9 })]),
      month('Jul', [], [invoice('jul-invoice', [transaction({ id: 'jul-tx' })])]),
      month('Ago', [], [invoice('aug-invoice', [
        transaction({ id: 'aug-tx' }),
        transaction({ id: 'third-party', merchant: 'NETFLIX.COM', owner: 'THIRD_PARTY', category: 'educacao' }),
      ])]),
    ];
    const found = findRecurringCharges(months, 'Ago');
    expect(found).toHaveLength(1);

    const marked = months.map((entry) => ({
      ...entry,
      bills: entry.bills.map((item) => found[0].occurrences.some((occurrence) => (
        occurrence.monthId === entry.id && !occurrence.invoiceId && occurrence.billId === item.id
      )) ? { ...item, category: 'assinatura' } : item),
      creditCardInvoices: entry.creditCardInvoices?.map((cardInvoice) => ({
        ...cardInvoice,
        transactions: cardInvoice.transactions.map((tx) => found[0].occurrences.some((occurrence) => (
          occurrence.monthId === entry.id && occurrence.invoiceId === cardInvoice.id && occurrence.transactionId === tx.id
        )) ? { ...tx, category: 'assinatura' } : tx),
      })),
    }));

    expect(findRecurringCharges(marked, 'Ago')).toEqual([]);
    expect(marked[2].creditCardInvoices?.[0].transactions[1].category).toBe('educacao');
    expect(findRecurringCharges(months, 'Ago')).toEqual(found);
  });

  it('mantém seis meses, mínimo de três, mês selecionado e limite de 15% nas faturas', () => {
    const months = Array.from({ length: 9 }, (_, index) => month(`M${index}`, [], [
      invoice(`invoice-${index}`, [transaction({ amountCents: index === 7 ? 4600 : 4000 })]),
    ]));

    const found = findRecurringCharges(months, 'M7');

    expect(found).toHaveLength(1);
    expect(found[0].occurrences.map((occurrence) => occurrence.monthId)).toEqual(['M2', 'M3', 'M4', 'M5', 'M6', 'M7']);
    expect(found[0]).toMatchObject({ minAmount: 40, maxAmount: 46, monthCount: 6 });
    expect(findRecurringCharges(months.slice(0, 2), 'M1')).toEqual([]);
    expect(findRecurringCharges(months, 'inexistente')).toEqual([]);
    expect(findRecurringCharges([], 'M7')).toEqual([]);
    const aboveLimit = months.map((entry) => ({
      ...entry,
      creditCardInvoices: entry.creditCardInvoices?.map((cardInvoice) => ({
        ...cardInvoice,
        transactions: cardInvoice.transactions.map((tx) => ({ ...tx, amountCents: entry.id === 'M7' ? 4601 : 4000 })),
      })),
    }));
    expect(findRecurringCharges(aboveLimit, 'M7')).toEqual([]);
  });

  it('conta meses distintos e continua exigindo a compra no mês aberto', () => {
    const months = ['Jun', 'Jul'].map((id) => month(id, [], [
      invoice(`${id}-one`, [transaction()]),
      invoice(`${id}-two`, [transaction()]),
    ]));

    expect(findRecurringCharges(months, 'Jul')).toEqual([]);
    const threeMonths = [...months, month('Ago', [], [invoice('aug-invoice', [transaction()])])];
    expect(findRecurringCharges(threeMonths, 'Ago')[0]).toMatchObject({ monthCount: 3 });
    expect(findRecurringCharges([...threeMonths, month('Set', [])], 'Set')).toEqual([]);
  });
});

describe('reajuste de preço', () => {
  function history(months: string[], amounts: number[], type: Bill['type'] = 'mensal') {
    return months.map((id, index) => month(id, [
      bill({ id: `${id}-conta`, name: 'Internet', amount: amounts[index], type }),
    ]));
  }

  it('avisa a conta mensal que veio acima do costume', () => {
    const found = findPriceChanges(history(['Jun', 'Jul', 'Ago'], [99.9, 99.9, 129.9]), 'Ago');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Internet', previousAmount: 99.9, currentAmount: 129.9, baselineMonths: 2 });
    expect(found[0].deltaPct).toBeCloseTo(0.3, 3);
  });

  it('deixa o reajuste pequeno fora do aviso', () => {
    expect(findPriceChanges(history(['Jun', 'Jul', 'Ago'], [99.9, 99.9, 109.9]), 'Ago')).toEqual([]);
  });

  it('também avisa quando o preço caiu', () => {
    const found = findPriceChanges(history(['Jun', 'Jul', 'Ago'], [150, 150, 99]), 'Ago');

    expect(found[0]).toMatchObject({ currentAmount: 99, previousAmount: 150 });
    expect(found[0].deltaPct).toBeLessThan(-0.15);
  });

  it('usa a mediana: um mês atípico não vira a base de comparação', () => {
    const months = ['Jun', 'Jul', 'Ago', 'Set'].map((id, index) => month(id, [
      bill({ id: `${id}-energia`, name: 'Luz', amount: [120, 400, 120, 160][index], type: 'mensal' }),
    ]));

    const found = findPriceChanges(months, 'Set');

    // A base é 120 (dois meses), não a média puxada pela conta alta de Julho.
    expect(found[0].previousAmount).toBe(120);
    expect(found[0].deltaPct).toBeCloseTo(0.33, 2);
  });

  it('não compara com uma única leitura anterior', () => {
    expect(findPriceChanges(history(['Jul', 'Ago'], [99.9, 199]), 'Ago')).toEqual([]);
  });

  it('ignora gasto variável e parcela, que mudam de valor por natureza', () => {
    expect(findPriceChanges(history(['Jun', 'Jul', 'Ago'], [80, 80, 300], 'variavel'), 'Ago')).toEqual([]);
    expect(findPriceChanges(history(['Jun', 'Jul', 'Ago'], [80, 80, 300], 'parcela'), 'Ago')).toEqual([]);
  });

  it('aceita conta fixa declarada uma vez e cobrada todo mês', () => {
    const found = findPriceChanges(history(['Jun', 'Jul', 'Ago'], [600, 600, 890], 'fixa'), 'Ago');

    expect(found[0]).toMatchObject({ name: 'Internet', currentAmount: 890 });
  });
});

describe('cobrança que sumiu', () => {
  it('avisa o gasto variável que aparecia todo mês e faltou no mês aberto', () => {
    const months = ['Jun', 'Jul', 'Ago', 'Set'].map((id) => month(id, [
      ...(id === 'Set' ? [] : [bill({ id: `${id}-academia`, name: 'Academia', amount: 99.9, category: 'saude' })]),
    ]));

    const found = findMissingCharges(months, 'Set');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ name: 'Academia', lastAmount: 99.9, lastMonthId: 'Ago', monthsSince: 1, monthCount: 3 });
  });

  it('não avisa o que ainda está no mês aberto', () => {
    const months = ['Jun', 'Jul', 'Ago'].map((id) => month(id, [
      bill({ id: `${id}-netflix`, name: 'Netflix', amount: 39.9 }),
    ]));

    expect(findMissingCharges(months, 'Ago')).toEqual([]);
  });

  it('deixa ir o que sumiu há mais de dois meses', () => {
    const months = ['Jun', 'Jul', 'Ago', 'Set', 'Out'].map((id) => month(id, [
      ...(['Jun', 'Jul', 'Ago'].includes(id) ? [bill({ id: `${id}-clube`, name: 'Clube do Livro', amount: 25 })] : []),
    ]));

    expect(findMissingCharges(months, 'Out')).toEqual([]);
  });

  it('não cobra do usuário uma fixa que ele ainda não lançou', () => {
    const months = ['Jun', 'Jul', 'Ago', 'Set'].map((id) => month(id, [
      ...(id === 'Set' ? [] : [bill({ id: `${id}-aluguel`, name: 'Aluguel', amount: 1200, type: 'mensal' })]),
    ]));

    expect(findMissingCharges(months, 'Set')).toEqual([]);
  });

  it('precisa de três meses de hábito para chamar de recorrência', () => {
    const months = ['Jul', 'Ago', 'Set'].map((id) => month(id, [
      ...(id === 'Set' ? [] : [bill({ id: `${id}-curso`, name: 'Curso de Inglês', amount: 180 })]),
    ]));

    expect(findMissingCharges(months, 'Set')).toEqual([]);
  });
});

describe('coleta original de preço e cobranças ausentes', () => {
  it('mantém o reajuste de contas no cartão mesmo com transações correspondentes', () => {
    const months = ['Jun', 'Jul', 'Ago'].map((id, index) => month(id, [
      bill({ id: `${id}-bill`, name: 'Netflix', amount: index === 2 ? 60 : 40, type: 'mensal', isOnCreditCard: true }),
    ]));
    const expected = findPriceChanges(months, 'Ago');
    expect(expected).toHaveLength(1);
    const withInvoices = months.map((entry) => ({
      ...entry,
      creditCardInvoices: [invoice(`${entry.id}-invoice`, [transaction({ amountCents: entry.bills[0].amount * 100 })])],
    }));

    expect(findPriceChanges(withInvoices, 'Ago')).toEqual(expected);
    expect(findMissingCharges(withInvoices, 'Ago')).toEqual(findMissingCharges(months, 'Ago'));
  });

  it('continua avisando a conta ausente mesmo se a compra aparecer na fatura do mês aberto', () => {
    const months = ['Jun', 'Jul', 'Ago', 'Set'].map((id) => month(id, id === 'Set' ? [] : [
      bill({ id: `${id}-bill`, name: 'Netflix', amount: 39.9, isOnCreditCard: true }),
    ]));
    const expected = findMissingCharges(months, 'Set');
    expect(expected).toHaveLength(1);
    const withInvoices = months.map((entry) => ({
      ...entry,
      creditCardInvoices: [invoice(`${entry.id}-invoice`, [transaction()])],
    }));

    expect(findMissingCharges(withInvoices, 'Set')).toEqual(expected);
    expect(findPriceChanges(withInvoices, 'Set')).toEqual(findPriceChanges(months, 'Set'));
    expect(findRecurringCharges(withInvoices, 'Set')[0]).toMatchObject({ monthCount: 4 });
  });

  it('não cria reajustes nem cobranças ausentes a partir apenas de faturas', () => {
    const months = ['Jun', 'Jul', 'Ago', 'Set'].map((id, index) => month(id, [], [
      invoice(`${id}-invoice`, [
        transaction({ id: `${id}-price`, merchant: 'Internet', amountCents: index === 3 ? 12990 : 9990 }),
        ...(index === 3 ? [] : [transaction({ id: `${id}-missing` })]),
      ]),
    ]));

    expect(findPriceChanges(months, 'Set')).toEqual([]);
    expect(findMissingCharges(months, 'Set')).toEqual([]);
  });
});
