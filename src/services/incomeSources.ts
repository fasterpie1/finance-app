import type { IncomeSource } from '../types';

export function newIncomeSourceId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function hasValue(source: IncomeSource): boolean {
  return source.label.trim().length > 0 || (Number.isFinite(source.amount) && source.amount > 0);
}

function sourceKey(source: IncomeSource): string {
  const label = source.label.trim().toLowerCase();
  return label ? `label:${label}` : `amount:${Math.round(source.amount * 100)}`;
}

export function mergeMissingIncomeSources(
  current: IncomeSource[],
  previous: IncomeSource[],
): IncomeSource[] {
  const result = current.filter(hasValue).map((source) => ({ ...source }));
  const existingKeys = new Set(result.map(sourceKey));

  for (const source of previous) {
    if (!hasValue(source)) continue;
    const key = sourceKey(source);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    result.push({ ...source, id: newIncomeSourceId() });
  }

  return result;
}
