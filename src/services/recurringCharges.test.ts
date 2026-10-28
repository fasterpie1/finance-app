import { describe, expect, it } from 'vitest';
import type { Bill, BudgetMonth } from '../types';
import { findMissingCharges, findPriceChanges, findRecurringCharges, normalizeChargeName } from './recurringCharges';

function bill(overrides: Partial<Bill>): Bill {
  return {
    id: 'bill', name: 'Teste', amount: 30, category: 'compras', dueDay: 5, isPaid: false,
    type: 'variavel', month: 'Outubro', note: '', ...overrides,
  };
}

function month(id: string, bills: Bill[]): BudgetMonth {
  return { id, name: id, year: 2026, income: 0, bills };
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
