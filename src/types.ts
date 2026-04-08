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
}

export interface BudgetMonth {
  id: string;
  name: string;
  year: number;
  income: number;
  bills: Bill[];
  savingsGoal?: number;
}

export const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export const MONTH_SHORT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

export function getMonthIndex(name: string): number {
  return MONTH_NAMES.findIndex((m) => m.toLowerCase() === name.toLowerCase());
}

export function formatMonthShort(name: string, year: number): string {
  const idx = getMonthIndex(name);
  return idx >= 0 ? `${MONTH_SHORT[idx]} ${String(year).slice(-2)}` : `${name} ${String(year).slice(-2)}`;
}

export function formatMonthFull(name: string, year: number): string {
  return `${name} ${year}`;
}

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
