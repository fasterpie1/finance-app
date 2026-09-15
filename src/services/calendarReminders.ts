import { type Bill, type BudgetMonth, formatCurrency, getBillReminderStart } from '../types';
import { type CalendarEventInput } from './googleCalendar';

function withDuration(start: Date): { start: string; end: string } {
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function billReminderInput(bill: Bill, month: BudgetMonth): CalendarEventInput {
  const times = withDuration(getBillReminderStart(month.name, month.year, bill.dueDay));
  return {
    title: `Pagar conta de ${bill.name}`,
    description: `${bill.name} vence em ${bill.dueDay} de ${month.name} de ${month.year}. Valor: ${formatCurrency(bill.amount)}.`,
    ...times,
    reminder_minutes: 0,
  };
}

export function invoiceReminderInput(month: BudgetMonth, amount: number): CalendarEventInput {
  if (!month.creditCardDueDay) throw new Error('Defina o vencimento da fatura antes de criar o lembrete.');
  const times = withDuration(getBillReminderStart(month.name, month.year, month.creditCardDueDay));
  return {
    title: 'Pagar fatura do mês',
    description: `Fatura de ${month.name} de ${month.year}. Vence no dia ${month.creditCardDueDay}. Valor: ${formatCurrency(amount)}.`,
    ...times,
    reminder_minutes: 0,
  };
}