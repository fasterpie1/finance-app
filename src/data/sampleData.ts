import { MONTH_NAMES, type BudgetMonth } from '../types';

const now = new Date();

export const sampleMonths: BudgetMonth[] = [
  {
    id: 'start',
    name: MONTH_NAMES[now.getMonth()],
    year: now.getFullYear(),
    income: 0,
    bills: [],
  },
];
