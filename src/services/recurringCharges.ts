import type { BillType, BudgetMonth, CategoryId } from '../types';

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

/** Conta que apareceu com preço diferente no mês aberto. */
export interface PriceChange {
  key: string;
  name: string;
  category: CategoryId;
  /** Mediana dos meses anteriores: um reajuste isolado não derruba a base. */
  previousAmount: number;
  currentAmount: number;
  deltaPct: number;
  baselineMonths: number;
  billIds: string[];
}

/** Conta que se repetia e simplesmente não veio no mês aberto. */
export interface MissingCharge {
  key: string;
  name: string;
  category: CategoryId;
  lastAmount: number;
  lastMonthId: string;
  lastBillId: string;
  /** 1 = faltou só o mês aberto; 2 = faltam os dois últimos. */
  monthsSince: number;
  monthCount: number;
  occurrences: RecurringOccurrence[];
}

const WINDOW_MONTHS = 6;
const MIN_OCCURRENCES = 3;
/** Uma assinatura pode reajustar; 15% de variação ainda é a mesma cobrança, o dobro já é outro gasto. */
const PRICE_DRIFT = 0.15;
/** Nomes de uma ou duas letras ("if", "uv") não formam grupo confiável. */
const MIN_NAME_LENGTH = 3;
/** Uma leitura anterior só compara o mês com ele mesmo; duas já desenham um preço costumeiro. */
const MIN_BASELINE_MONTHS = 2;
/** Faltou em mais de um mês: o mais provável é ter acabado, não ter sido esquecida. */
const MAX_MONTHS_SINCE = 1;

/** Sufixo que o extrato anexa ao nome: domínio e razão social não distinguem um estabelecimento do outro. */
const NAME_SUFFIXES = ['com', 'net', 'br', 'online', 'oficial', 'app', 'ltda', 'ltd', 'me', 'epp', 'sa', 'cia'];

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

interface Occurrence extends RecurringOccurrence {
  type: BillType;
  category: CategoryId;
}

interface Group {
  key: string;
  name: string;
  category: CategoryId;
  occurrences: Occurrence[];
}

interface Collected {
  groups: Group[];
  /** Meses da janela, do mais antigo ao mês aberto. */
  window: BudgetMonth[];
  currentMonthId: string;
}

/** Agrupa todos os lançamentos em aberto do mês por nome normalizado; cada detector filtra depois. */
function collectGroups(months: BudgetMonth[], selectedMonthId: string): Collected | null {
  const selectedIndex = months.findIndex((month) => month.id === selectedMonthId);
  if (selectedIndex < 0) return null;
  const window = months.slice(Math.max(0, selectedIndex - WINDOW_MONTHS + 1), selectedIndex + 1);
  const currentMonthId = window[window.length - 1]?.id;
  if (!currentMonthId) return null;

  const groups = new Map<string, Group>();
  window.forEach((month) => {
    month.bills.forEach((bill) => {
      if (!(bill.amount > 0)) return;
      const key = normalizeChargeName(bill.name);
      if (key.length < MIN_NAME_LENGTH) return;
      const group = groups.get(key) ?? { key, name: bill.name, category: bill.category, occurrences: [] };
      group.occurrences.push({ monthId: month.id, billId: bill.id, amount: bill.amount, type: bill.type, category: bill.category });
      groups.set(key, group);
    });
  });

  return { groups: [...groups.values()], window, currentMonthId };
}

function distinctMonthIds(occurrences: RecurringOccurrence[]): string[] {
  return [...new Set(occurrences.map((occurrence) => occurrence.monthId))];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Ache cobranças que se repetem com nome e preço parecidos mês a mês: é o formato de uma
 * assinatura que foi lançada como gasto variável e nunca mudou de categoria.
 */
export function findRecurringCharges(months: BudgetMonth[], selectedMonthId: string): RecurringCharge[] {
  const collected = collectGroups(months, selectedMonthId);
  if (!collected) return [];
  const { groups, currentMonthId } = collected;

  return groups
    .map((group) => {
      // Parcela termina sozinha e conta fixa já foi declarada recorrente: o que interessa aqui
      // é o gasto variável que se comporta como assinatura.
      const occurrences = group.occurrences.filter((occurrence) => occurrence.type === 'variavel' && occurrence.category !== 'assinatura');
      const monthCount = distinctMonthIds(occurrences).length;
      const amounts = occurrences.map((occurrence) => occurrence.amount);
      return {
        group,
        occurrences,
        monthCount,
        minAmount: monthCount > 0 ? Math.min(...amounts) : 0,
        maxAmount: monthCount > 0 ? Math.max(...amounts) : 0,
      };
    })
    .filter(({ occurrences, monthCount, minAmount, maxAmount }) => (
      monthCount >= MIN_OCCURRENCES
      // Cobrança que parou há dois meses não é mais uma assinatura a descobrir.
      && occurrences.some((occurrence) => occurrence.monthId === currentMonthId)
      && maxAmount - minAmount <= PRICE_DRIFT * minAmount
    ))
    .map(({ group, occurrences, monthCount, minAmount, maxAmount }) => ({
      key: group.key,
      name: group.name,
      category: group.category,
      occurrences,
      monthCount,
      minAmount,
      maxAmount,
    }))
    .sort((a, b) => b.monthCount - a.monthCount || b.maxAmount - a.maxAmount);
}

/**
 * Mensal e fixa têm preço costumeiro: quando o mês aberto foge da mediana dos anteriores,
 * foi reajuste de plano, troca de bandeira ou conta lançada errada. Gasto variável oscila por
 * natureza e parcela muda de valor sozinha quando o número de parcelas é dividido.
 */
export function findPriceChanges(months: BudgetMonth[], selectedMonthId: string): PriceChange[] {
  const collected = collectGroups(months, selectedMonthId);
  if (!collected) return [];
  const { groups, currentMonthId } = collected;

  return groups
    .map((group) => {
      const occurrences = group.occurrences.filter((occurrence) => occurrence.type === 'mensal' || occurrence.type === 'fixa');
      const current = occurrences.filter((occurrence) => occurrence.monthId === currentMonthId);
      const history = occurrences.filter((occurrence) => occurrence.monthId !== currentMonthId);
      const baselineMonths = distinctMonthIds(history).length;
      const previousAmount = baselineMonths >= MIN_BASELINE_MONTHS ? median(history.map((occurrence) => occurrence.amount)) : 0;
      const currentAmount = current.reduce((sum, occurrence) => sum + occurrence.amount, 0);
      if (current.length === 0 || !(previousAmount > 0)) return null;
      const deltaPct = (currentAmount - previousAmount) / previousAmount;
      if (Math.abs(deltaPct) < PRICE_DRIFT) return null;
      return {
        key: group.key,
        name: group.name,
        category: group.category,
        previousAmount,
        currentAmount,
        deltaPct,
        baselineMonths,
        billIds: current.map((occurrence) => occurrence.billId),
      };
    })
    .filter((change): change is PriceChange => change !== null)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct) || b.currentAmount - a.currentAmount);
}

/**
 * O outro lado do detector de recorrência: a cobrança que aparecia todo mês e sumiu do mês
 * aberto. Pode ser cancelamento de verdade ou lançamento que esqueceu de entrar.
 */
export function findMissingCharges(months: BudgetMonth[], selectedMonthId: string): MissingCharge[] {
  const collected = collectGroups(months, selectedMonthId);
  if (!collected) return [];
  const { groups, window, currentMonthId } = collected;

  return groups
    .map((group): MissingCharge | null => {
      const occurrences = group.occurrences.filter((occurrence) => occurrence.type === 'variavel' && occurrence.category !== 'assinatura');
      if (occurrences.some((occurrence) => occurrence.monthId === currentMonthId)) return null;
      const monthCount = distinctMonthIds(occurrences).length;
      if (monthCount < MIN_OCCURRENCES) return null;
      const last = occurrences[occurrences.length - 1];
      const lastMonthIndex = window.findIndex((month) => month.id === last.monthId);
      const monthsSince = window.length - 1 - lastMonthIndex;
      if (monthsSince < 1 || monthsSince > MAX_MONTHS_SINCE) return null;
      return {
        key: group.key,
        name: group.name,
        category: group.category,
        lastAmount: last.amount,
        lastMonthId: last.monthId,
        lastBillId: last.billId,
        monthsSince,
        monthCount,
        occurrences,
      };
    })
    .filter((charge): charge is MissingCharge => charge !== null)
    .sort((a, b) => a.monthsSince - b.monthsSince || b.lastAmount - a.lastAmount);
}
