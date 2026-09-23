export type BillCategory =
  | 'luz'
  | 'agua'
  | 'internet'
  | 'gas'
  | 'financiamento'
  | 'aluguel'
  | 'condominio'
  | 'limpeza'
  | 'salario'
  | 'alimentacao'
  | 'transporte'
  | 'saude'
  | 'lazer'
  | 'assinatura'
  | 'educacao'
  | 'compras'
  | 'seguro'
  | 'pet'
  | 'outros';

export type BillType = 'mensal' | 'parcela' | 'fixa' | 'variavel';
export type CardPaymentMethod = 'credito' | 'debito_pix';
export type CardTransactionType = 'PURCHASE' | 'INSTALLMENT' | 'REFUND' | 'PAYMENT' | 'FEE' | 'OTHER';
export type ExpenseOwner = 'ME' | 'THIRD_PARTY' | 'SHARED' | 'UNCLASSIFIED';

export interface CreditCardTransaction {
  id: string;
  invoiceId: string;
  merchant: string;
  amountCents: number;
  type: CardTransactionType;
  owner: ExpenseOwner;
  cardLast4?: string;
  cardName?: string;
  date?: string;
  personalAmountCents?: number;
  thirdPartyName?: string;
  category?: BillCategory;
  installmentCurrent?: number;
  installmentTotal?: number;
  installmentGroupId?: string;
  linkedTransactionId?: string;
  source?: 'MANUAL' | 'IMPORT';
}

export interface CreditCardInvoice {
  id: string;
  month: string;
  year: number;
  dueDate?: string;
  closingDate?: string;
  statementTotalCents?: number;
  isPaid?: boolean;
  transactions: CreditCardTransaction[];
}

export const BILL_CATEGORY_LABELS: Record<BillCategory, string> = {
  luz: 'Luz',
  agua: 'Água',
  internet: 'Internet',
  gas: 'Gás',
  financiamento: 'Financiamento',
  aluguel: 'Aluguel',
  condominio: 'Condomínio',
  limpeza: 'Limpeza',
  salario: 'Salário',
  alimentacao: 'Alimentação',
  transporte: 'Transporte',
  saude: 'Saúde',
  lazer: 'Lazer',
  assinatura: 'Assinatura',
  educacao: 'Educação',
  compras: 'Compras',
  seguro: 'Seguro',
  pet: 'Pet',
  outros: 'Outros',
};

export const BILL_CATEGORY_COLORS: Record<BillCategory, string> = {
  luz: '#f59e0b',
  agua: '#3b82f6',
  internet: '#8b5cf6',
  gas: '#ef4444',
  financiamento: '#6366f1',
  aluguel: '#10b981',
  condominio: '#14b8a6',
  limpeza: '#f97316',
  salario: '#22c55e',
  alimentacao: '#fb923c',
  transporte: '#0ea5e9',
  saude: '#ec4899',
  lazer: '#a78bfa',
  assinatura: '#e879f9',
  educacao: '#2dd4bf',
  compras: '#fbbf24',
  seguro: '#64748b',
  pet: '#fb7185',
  outros: '#6b7280',
};

export const BILL_TYPE_LABELS: Record<BillType, string> = {
  mensal: 'Mensal',
  parcela: 'Parcela',
  fixa: 'Fixa',
  variavel: 'Variável',
};

export interface Bill {
  id: string;
  name: string;
  category: BillCategory;
  amount: number;
  dueDay: number;
  type: BillType;
  isPaid: boolean;
  month: string;
  note: string;
  installmentCurrent?: number;
  installmentTotal?: number;
  /** Indica que essa conta fixa é cobrada no cartão de crédito */
  isOnCreditCard?: boolean;
  /** Forma de pagamento de uma compra lançada na área do cartão */
  cardPaymentMethod?: CardPaymentMethod;
  /** Competência em que a compra foi realizada; a conta pode vencer no mês seguinte. */
  cardPurchaseMonth?: string;
  cardPurchaseYear?: number;
  calendarEventId?: string;
}

export interface IncomeSource {
  id: string;
  label: string;
  amount: number;
}

export interface BudgetMonth {
  id: string;
  name: string;
  year: number;
  income: number;
  /** Fontes que compõem a entrada mensal; `income` é a soma dos valores. */
  incomeSources?: IncomeSource[];
  bills: Bill[];
  /** Faturas importadas do cartão, separadas das contas do orçamento. */
  creditCardInvoices?: CreditCardInvoice[];
  savingsGoal?: number;
  savingsGoalMode?: 'auto' | 'manual';
  savedAmount?: number;
  creditCardDueDay?: number;
  creditCardCalendarEventId?: string;
}

export const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export const MONTH_SHORT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function getMonthIndex(name: string): number {
  return MONTH_NAMES.findIndex((m) => m.toLowerCase() === name.toLowerCase());
}

export function formatMonthShort(name: string, year: number, locale: 'pt-BR' | 'en' = 'pt-BR'): string {
  const idx = getMonthIndex(name);
  const labels = locale === 'en' ? MONTH_SHORT_EN : MONTH_SHORT;
  return idx >= 0 ? `${labels[idx]} ${String(year).slice(-2)}` : `${name} ${String(year).slice(-2)}`;
}

export function formatMonthFull(name: string, year: number, locale: 'pt-BR' | 'en' = 'pt-BR'): string {
  const idx = getMonthIndex(name);
  return `${idx >= 0 && locale === 'en' ? MONTH_NAMES_EN[idx] : name} ${year}`;
}

export function getBillReminderStart(monthName: string, year: number, dueDay: number): Date {
  const monthIndex = getMonthIndex(monthName);
  const dueMonthIndex = monthIndex < 0 ? 0 : (monthIndex + 1) % 12;
  const dueYear = dueMonthIndex === 0 ? year + 1 : year;
  // Clamp igual ao das notificações (nextMonthDate): sem isso, uma conta de dia 31
  // num mês de 30 dias cairia no próprio vencimento em vez do dia anterior.
  const lastDay = new Date(dueYear, dueMonthIndex + 1, 0).getDate();
  const dueDate = new Date(dueYear, dueMonthIndex, Math.min(Math.max(dueDay, 1), lastDay));
  return new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - 1, 9);
}

export function formatCurrency(value: number, currency = 'BRL', locale: string = 'pt-BR'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}

/** Converte string com vírgula brasileira para número (ex: "137,50" → 137.5) */
export function parseBRL(value: string): number {
  const cleaned = value.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/** Mascara valor para exibição privada */
export function maskCurrency(): string {
  return 'R$ ••••';
}
