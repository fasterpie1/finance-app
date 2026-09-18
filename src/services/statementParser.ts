import type { BillCategory, CardTransactionType, ExpenseOwner } from '../types';

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
