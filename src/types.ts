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
  outros: 'Outros',
};

export const BILL_CATEGORY_ICONS: Record<BillCategory, string> = {
  luz: '⚡',
  agua: '💧',
  internet: '🌐',
  gas: '🔥',
  financiamento: '🏦',
  aluguel: '🏠',
  condominio: '🏢',
  limpeza: '🧹',
  salario: '💼',
  outros: '📌',
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
  income: number;
  bills: Bill[];
}

export function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
