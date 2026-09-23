import { BILL_CATEGORY_LABELS, type BillCategory, type CardTransactionType, type ExpenseOwner } from '../types';

export interface ExtractedPurchase {
  id: string;
  name: string;
  amount: number;
  installmentCurrent: number;
  installmentTotal: number;
  category: BillCategory;
  selected: boolean;
  type: CardTransactionType;
  owner: ExpenseOwner;
  personalAmountCents?: number;
  thirdPartyName?: string;
  duplicateConfidence?: 'high' | 'possible';
  cardLast4?: string;
  date?: string;
}

export function parsePdfTransactionFallback(statementText: string): Omit<ExtractedPurchase, 'id' | 'selected'>[] {
  const purchases: Omit<ExtractedPurchase, 'id' | 'selected'>[] = [];
  const transactionPattern = /^\s*(\d{1,2}(?:\/\d{1,2}|\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)))\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/i;
  const lines = statementText.split(/\r?\n/);
  let inTransactionSection = false;

  lines.forEach((line) => {
    const normalizedLine = line.toLowerCase().replace(/\s+/g, ' ').trim();
    if (/lançamentos:\s*(compras e saques|produtos e serviços)|lançamentos internacionais/i.test(normalizedLine)) {
      inTransactionSection = true;
      return;
    }
    if (/compras parceladas\s*-\s*próximas faturas|limites de crédito|encargos cobrados nesta fatura|simulação de compras/i.test(normalizedLine)) {
      inTransactionSection = false;
      return;
    }
    if (!inTransactionSection) return;
    const match = line.match(transactionPattern);
    if (!match) return;
    const rawAmount = parseFloat(match[3].replace(/\./g, '').replace(',', '.'));
    if (!rawAmount) return;
    const amount = Math.abs(rawAmount);
    const installment = match[2].match(/(?:parcela\s+)?(\d+)\/(\d+)/i);
    const type: CardTransactionType = /pagamento|inclus[aã]o/i.test(match[2]) ? 'PAYMENT'
      : /estorno|cr[eé]dito/i.test(match[2]) || rawAmount < 0 ? 'REFUND'
        : /tarifa|anuidade|mensalidade|taxa/i.test(match[2]) ? 'FEE' : 'PURCHASE';
    const name = match[2].replace(/(?:parcela\s+)?\d+\/\d+/i, '').replace(/\s{2,}/g, ' ').trim();
    if (!name || /pagamento|inclus[aã]o/i.test(name)) return;
    purchases.push({
      name,
      amount: Math.round(amount * 100) / 100,
      installmentCurrent: installment ? Number(installment[1]) : 1,
      installmentTotal: installment ? Number(installment[2]) : 1,
      category: 'compras',
      type,
      owner: 'ME',
    });
  });
  return purchases;
}

export const VALID_CATEGORIES = Object.keys(BILL_CATEGORY_LABELS) as BillCategory[];

/** Aceita número ou string numérica em formato decimal ("1234.56") ou pt-BR
 *  ("1.234,56" / "R$ 1.234,56"). A vírgula indica separador decimal brasileiro. */
export function parseRawAmount(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  const text = String(raw ?? '').trim();
  if (!text) return NaN;
  if (text.includes(',')) return parseFloat(text.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.'));
  return parseFloat(text.replace(/[^\d.-]/g, ''));
}

export function normalizeCategory(raw: unknown): BillCategory {
  if (typeof raw !== 'string') return 'compras';
  const lower = raw.toLowerCase().trim();
  const found = VALID_CATEGORIES.find((c) => c === lower);
  if (found) return found;
  return 'compras';
}

export function normalizePurchase(raw: Record<string, unknown>): Omit<ExtractedPurchase, 'id' | 'selected'> | null {
  let name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const rawAmount = parseRawAmount(raw.amount);
  const aggregateName = /compras?\s+(nacionais?|internacionais?)|total\s+(a\s+pagar|da\s+fatura)|valor\s+da\s+fatura|saldo\s+(obriga|rotativo)|pagamento\s+(total|mínimo)|gastos\s+desta\s+fatura|em\s+processamento|cart[aã]o\s+final|subtotal|limite\s+(total|disponível|utilizado)|próxima\s+fatura|demais\s+faturas/i;
  if (!name || aggregateName.test(name) || !rawAmount || isNaN(rawAmount)) return null;
  const normalizedType = String(raw.type ?? '').toUpperCase();
  const type: CardTransactionType = ['PURCHASE', 'INSTALLMENT', 'REFUND', 'PAYMENT', 'FEE', 'OTHER'].includes(normalizedType)
    ? normalizedType as CardTransactionType
    : /pagamento|inclus[aã]o/i.test(name) ? 'PAYMENT'
      : /estorno|cr[eé]dito/i.test(name) || rawAmount < 0 ? 'REFUND'
        : /tarifa|anuidade|mensalidade|taxa/i.test(name) ? 'FEE' : 'PURCHASE';
  const amount = Math.abs(rawAmount);

  const installmentText = `${String(raw.installmentCurrent ?? '')} ${String(raw.installmentTotal ?? '')} ${name}`;
  const installmentMatch = installmentText.match(/(?:parcela\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/i);
  // Números explícitos do modelo têm prioridade; o regex sobre o nome é só fallback.
  // Sem isso, uma data no nome do estabelecimento ("08/09") virava parcela 8/9.
  const explicitCur = typeof raw.installmentCurrent === 'number' && raw.installmentCurrent >= 1 ? raw.installmentCurrent : undefined;
  const explicitTotal = typeof raw.installmentTotal === 'number' && raw.installmentTotal >= 1 ? raw.installmentTotal : undefined;
  let cur = explicitCur ?? (installmentMatch ? Number(installmentMatch[1]) : parseInt(String(raw.installmentCurrent ?? '1'), 10));
  let total = explicitTotal ?? (installmentMatch ? Number(installmentMatch[2]) : parseInt(String(raw.installmentTotal ?? '1'), 10));
  if (installmentMatch) name = name.replace(installmentMatch[0], ' ').replace(/\s{2,}/g, ' ').trim();
  name = name.replace(/\b(?:em processamento|cart[aã]o final\s*\d{4}|s[aã]o paulo|rio de janeiro|rio de|brasil)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  if (!name || aggregateName.test(name)) return null;
  if (isNaN(cur) || cur < 1) cur = 1;
  if (isNaN(total) || total < 1) total = 1;
  cur = Math.min(cur, total);

  return {
    name,
    amount: Math.round(amount * 100) / 100,
    installmentCurrent: cur,
    installmentTotal: total,
    category: normalizeCategory(raw.category),
    type,
    owner: 'ME',
    cardLast4: typeof raw.cardLast4 === 'string' ? raw.cardLast4.slice(-4) : undefined,
    date: typeof raw.date === 'string' ? raw.date : undefined,
  };
}

export function parseExtractedPurchases(content: string): Omit<ExtractedPurchase, 'id' | 'selected'>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try { parsed = JSON.parse(match[0]); } catch { return []; }
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { purchases?: unknown[] })?.purchases)
      ? (parsed as { purchases: unknown[] }).purchases
      : [];

  return arr
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(normalizePurchase)
    .filter((p): p is Omit<ExtractedPurchase, 'id' | 'selected'> => p !== null);
}
