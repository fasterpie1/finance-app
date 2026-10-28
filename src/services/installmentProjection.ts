import { MONTH_NAMES, type BudgetMonth, type CreditCardTransaction } from '../types';
import { amountToCents, getCardCharges, getPersonalImpactCents, isOnCreditCardBill } from './cardTransactions';

export interface InstallmentGroup {
  name: string;
  /** Parcelas que ainda vão cair, depois do mês aberto. */
  remaining: number;
  centsPerMonth: number;
}

export interface InstallmentMonth {
  /** 1 = mês seguinte ao aberto. */
  offset: number;
  monthName: string;
  year: number;
  cents: number;
  /** Grupos que param neste mês. */
  endingCount: number;
}

export interface InstallmentProjection {
  groups: InstallmentGroup[];
  months: InstallmentMonth[];
  /** Quanto as parcelas pescam no mês aberto. */
  currentCents: number;
  /** Total que ainda vai ser cobrado. */
  remainingCents: number;
}

const EMPTY: InstallmentProjection = { groups: [], months: [], currentCents: 0, remainingCents: 0 };

function openInstallment(current: number | undefined, total: number | undefined): boolean {
  return typeof total === 'number' && total >= 2
    && typeof current === 'number' && current >= 1 && current < total;
}

function toGroup(name: string, current: number, total: number, centsPerMonth: number): InstallmentGroup | null {
  if (centsPerMonth <= 0) return null;
  return { name, remaining: total - current, centsPerMonth };
}

/**
 * O que o cartão e o orçamento ainda vão cobrar nos próximos meses. Só olha o mês aberto:
 * é ali que `installmentCurrent` diz a verdade; repetir um valor de mês antigo projetaria
 * uma parcela que já terminou.
 */
export function projectInstallments(
  months: BudgetMonth[],
  selectedMonthId: string,
  horizon = 6,
): InstallmentProjection {
  const selected = months.find((month) => month.id === selectedMonthId);
  if (!selected) return EMPTY;
  const invoices = selected.creditCardInvoices ?? [];
  const groups: InstallmentGroup[] = [];

  invoices.flatMap((invoice) => invoice.transactions).forEach((transaction: CreditCardTransaction) => {
    if (transaction.type === 'PAYMENT' || transaction.type === 'REFUND' || transaction.type === 'FEE') return;
    if (!openInstallment(transaction.installmentCurrent, transaction.installmentTotal)) return;
    const group = toGroup(
      transaction.merchant,
      transaction.installmentCurrent as number,
      transaction.installmentTotal as number,
      getPersonalImpactCents(transaction),
    );
    if (group) groups.push(group);
  });

  // Conta no cartão que ainda não veio na fatura + parcela lançada à mão fora do cartão:
  // os dois caminhos do mesmo compromisso, sem sobrepor o que o extrato já cobra.
  const pendingCardBills = getCardCharges(invoices, selected.bills).pendingBills;
  const budgetBills = selected.bills.filter((bill) => pendingCardBills.includes(bill) || !isOnCreditCardBill(bill));
  budgetBills.forEach((bill) => {
    if (!openInstallment(bill.installmentCurrent, bill.installmentTotal)) return;
    const group = toGroup(
      bill.name,
      bill.installmentCurrent as number,
      bill.installmentTotal as number,
      amountToCents(bill.amount),
    );
    if (group) groups.push(group);
  });

  if (groups.length === 0) return EMPTY;

  const monthIndex = MONTH_NAMES.findIndex((name) => name.toLowerCase() === selected.name.toLowerCase());
  if (monthIndex < 0) return { ...EMPTY, groups };

  const monthsByOffset: InstallmentMonth[] = [];
  for (let offset = 1; offset <= horizon; offset += 1) {
    const active = groups.filter((group) => group.remaining >= offset);
    const cents = active.reduce((sum, group) => sum + group.centsPerMonth, 0);
    const endingCount = groups.filter((group) => group.remaining === offset).length;
    if (cents === 0 && endingCount === 0) continue;
    monthsByOffset.push({
      offset,
      monthName: MONTH_NAMES[(monthIndex + offset) % 12],
      year: selected.year + Math.floor((monthIndex + offset) / 12),
      cents,
      endingCount,
    });
  }

  return {
    groups,
    months: monthsByOffset,
    currentCents: groups.reduce((sum, group) => sum + group.centsPerMonth, 0),
    remainingCents: groups.reduce((sum, group) => sum + group.centsPerMonth * group.remaining, 0),
  };
}
