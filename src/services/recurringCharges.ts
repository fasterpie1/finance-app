import type { BudgetMonth, CategoryId } from '../types';

export interface RecurringOccurrence {
  monthId: string;
  billId: string;
  amount: number;
}

export interface RecurringCharge {
  /** Nome normalizado: identifica o grupo mesmo quando a conta é reorganizada entre meses. */
  key: string;
  name: string;
  category: CategoryId;
  occurrences: RecurringOccurrence[];
  monthCount: number;
  minAmount: number;
  maxAmount: number;
}

const WINDOW_MONTHS = 6;
const MIN_OCCURRENCES = 3;
/** Uma assinatura reajusta; 15% de variação ainda é a mesma cobrança, o dobro já é outro gasto. */
const PRICE_DRIFT = 0.15;
/** Nomes de uma ou duas letras ("if", "uv") não formam grupo confiável. */
const MIN_NAME_LENGTH = 3;

/** Sufixo de domínio que o extrato anexa ao nome do estabelecimento; não distingue um serviço do outro. */
const NAME_SUFFIXES = ['com', 'net', 'br', 'online', 'oficial', 'app'];

/** "NETFLIX.COM", "Netflix" e " netflix " viram o mesmo grupo; "Plano 1" e "Plano 2" continuam separados. */
export function normalizeChargeName(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && NAME_SUFFIXES.includes(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

interface Group {
  key: string;
  name: string;
  category: CategoryId;
  occurrences: RecurringOccurrence[];
}

/**
 * Ache cobranças que se repetem com nome e preço parecidos mês a mês: é o formato de uma
 * assinatura que foi lançada como gasto variável e nunca mudou de categoria.
 */
export function findRecurringCharges(months: BudgetMonth[], selectedMonthId: string): RecurringCharge[] {
  const selectedIndex = months.findIndex((month) => month.id === selectedMonthId);
  if (selectedIndex < 0) return [];
  const window = months.slice(Math.max(0, selectedIndex - WINDOW_MONTHS + 1), selectedIndex + 1);
  const currentMonthId = window[window.length - 1]?.id;
  if (!currentMonthId) return [];

  const groups = new Map<string, Group>();
  window.forEach((month) => {
    month.bills.forEach((bill) => {
      // Parcela termina sozinha e conta fixa já foi declarada recorrente: o que interessa aqui
      // é o gasto variável que se comporta como assinatura.
      if (bill.type !== 'variavel' || bill.category === 'assinatura' || !(bill.amount > 0)) return;
      const key = normalizeChargeName(bill.name);
      if (key.length < MIN_NAME_LENGTH) return;
      const group = groups.get(key) ?? { key, name: bill.name, category: bill.category, occurrences: [] };
      group.occurrences.push({ monthId: month.id, billId: bill.id, amount: bill.amount });
      groups.set(key, group);
    });
  });

  return [...groups.values()]
    .map((group) => {
      const monthIds = new Set(group.occurrences.map((occurrence) => occurrence.monthId));
      const amounts = group.occurrences.map((occurrence) => occurrence.amount);
      const minAmount = Math.min(...amounts);
      const maxAmount = Math.max(...amounts);
      return { group, monthCount: monthIds.size, minAmount, maxAmount };
    })
    .filter(({ group, monthCount, minAmount, maxAmount }) => (
      monthCount >= MIN_OCCURRENCES
      // Cobrança que parou há dois meses não é mais uma assinatura a descobrir.
      && group.occurrences.some((occurrence) => occurrence.monthId === currentMonthId)
      && maxAmount - minAmount <= PRICE_DRIFT * minAmount
    ))
    .map(({ group, monthCount, minAmount, maxAmount }) => ({
      key: group.key,
      name: group.name,
      category: group.category,
      occurrences: group.occurrences,
      monthCount,
      minAmount,
      maxAmount,
    }))
    .sort((a, b) => b.monthCount - a.monthCount || b.maxAmount - a.maxAmount);
}
