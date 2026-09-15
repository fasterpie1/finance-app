import { describe, expect, it } from 'vitest';
import { formatCurrency, getBillReminderStart, getMonthIndex, parseBRL } from './types';
import { getBillNotifications, getMonthsFrom } from './store/useDashboard';
import type { BudgetMonth } from './types';

describe('financial helpers', () => {
  it('parses Brazilian currency formats', () => {
    expect(parseBRL('1.234,56')).toBe(1234.56);
    expect(parseBRL('89,90')).toBe(89.9);
    expect(parseBRL('')).toBe(0);
  });

  it('creates consecutive months across a year boundary', () => {
    expect(getMonthsFrom('Novembro', 2026, 3)).toEqual([
      { name: 'Novembro', year: 2026 },
      { name: 'Dezembro', year: 2026 },
      { name: 'Janeiro', year: 2027 },
    ]);
  });

  it('notifies only unpaid bills due within three days', () => {
    const months: BudgetMonth[] = [{ id: '1', name: 'Setembro', year: 2026, income: 5000, bills: [
      { id: 'late', name: 'Conta atrasada', category: 'internet', amount: 100, dueDay: 10, type: 'mensal', isPaid: false, month: 'Setembro', note: '' },
      { id: 'paid', name: 'Conta paga', category: 'luz', amount: 50, dueDay: 10, type: 'mensal', isPaid: true, month: 'Setembro', note: '' },
    ] }];
    const notifications = getBillNotifications(months, new Date(2026, 9, 11));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].name).toBe('Conta atrasada');
    expect(notifications[0].isOverdue).toBe(true);
  });

  it('formats currency in Brazilian locale', () => {
    expect(formatCurrency(1234.56)).toContain('1.234,56');
    expect(getMonthIndex('Setembro')).toBe(8);
  });

  it('calculates the reminder on the previous day of the following month', () => {
    expect(getBillReminderStart('Setembro', 2026, 7)).toEqual(new Date(2026, 9, 6, 9));
    expect(getBillReminderStart('Dezembro', 2026, 1)).toEqual(new Date(2026, 11, 31, 9));
  });
});
