import { describe, expect, it } from 'vitest';
import { mergeMissingIncomeSources } from './incomeSources';
import type { IncomeSource } from '../types';

const source = (id: string, label: string, amount: number): IncomeSource => ({ id, label, amount });

describe('copiar fontes de renda do mês anterior', () => {
  it('preserva as entradas atuais e adiciona apenas novas fontes, ignorando nomes repetidos', () => {
    const current = [source('current', 'Salário', 3200)];
    const previous = [
      source('previous-salary', ' salário ', 3000),
      source('previous-extra', 'Aulas', 500),
      source('previous-extra-duplicate', 'Aulas', 450),
    ];

    const merged = mergeMissingIncomeSources(current, previous);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(current[0]);
    expect(merged[1]).toMatchObject({ label: 'Aulas', amount: 500 });
    expect(merged[1].id).not.toBe('previous-extra');
  });

  it('remove a linha vazia inicial e evita duplicar fontes sem nome pelo valor', () => {
    const merged = mergeMissingIncomeSources(
      [source('placeholder', '', 0), source('current', '', 250)],
      [source('same-value', '', 250), source('new-value', '', 400)],
    );

    expect(merged).toHaveLength(2);
    expect(merged.map(({ amount }) => amount)).toEqual([250, 400]);
    expect(merged[1].id).not.toBe('new-value');
  });
});
