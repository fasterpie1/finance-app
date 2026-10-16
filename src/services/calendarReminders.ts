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

/** Cartão do lembrete: sem ele, a fatura de um segundo cartão não teria título nem dia próprio. */
export interface InvoiceReminderCard {
  label: string;
  dueDay?: number;
}

export function invoiceReminderInput(month: BudgetMonth, amount: number, card?: InvoiceReminderCard): CalendarEventInput {
  const dueDay = card?.dueDay ?? month.creditCardDueDay;
  if (!dueDay) throw new Error('Defina o vencimento da fatura antes de criar o lembrete.');
  const times = withDuration(getBillReminderStart(month.name, month.year, dueDay));
  return {
    title: card ? `Pagar fatura ${card.label}` : 'Pagar fatura do mês',
    description: `Fatura${card ? ` ${card.label}` : ''} de ${month.name} de ${month.year}. Vence no dia ${dueDay}. Valor: ${formatCurrency(amount)}.`,
    ...times,
    reminder_minutes: 0,
  };
}