import { describe, expect, it } from 'vitest';
import type { Bill, BudgetMonth } from '../types';
import { findRecurringCharges, normalizeChargeName } from './recurringCharges';

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
