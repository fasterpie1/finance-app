import type { CreditCardTransaction } from '../types';

export type DuplicateConfidence = 'high' | 'possible';

/** O que bateu, para a tela dizer "mesmo valor e mesmo dia" em vez de só "possível duplicado". */
export type DuplicateField = 'amount' | 'installment' | 'date' | 'card';

export interface DuplicateMatch {
  confidence: DuplicateConfidence;
  transaction: CreditCardTransaction;
  matchedOn: DuplicateField[];
}

interface DuplicateCandidate {
  amountCents: number;
  type: CreditCardTransaction['type'];
  date?: string;
  cardLast4?: string;
  installmentCurrent?: number;
  installmentTotal?: number;
}

function normalize(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function findDuplicateTransaction(candidate: DuplicateCandidate, existing: CreditCardTransaction[]): DuplicateMatch | undefined {
  return existing.reduce<DuplicateMatch | undefined>((match, transaction) => {
    if (transaction.amountCents !== candidate.amountCents || transaction.type !== candidate.type) return match;
    if ((transaction.installmentCurrent ?? 1) !== (candidate.installmentCurrent ?? 1)) return match;
    if ((transaction.installmentTotal ?? 1) !== (candidate.installmentTotal ?? 1)) return match;

    const candidateDate = normalize(candidate.date);
    const transactionDate = normalize(transaction.date);
    const candidateCard = normalize(candidate.cardLast4);
    const transactionCard = normalize(transaction.cardLast4);
    if (candidateDate && transactionDate && candidateDate !== transactionDate) return match;
    if (candidateCard && transactionCard && candidateCard !== transactionCard) return match;

    const hasIdentity = Boolean((candidateDate && transactionDate) || (candidateCard && transactionCard));
    const confidence: DuplicateConfidence = hasIdentity ? 'high' : 'possible';
    const matchedOn: DuplicateField[] = ['amount'];
    if (candidateDate && transactionDate) matchedOn.push('date');
    if (candidateCard && transactionCard) matchedOn.push('card');
    if ((candidate.installmentTotal ?? 1) > 1) matchedOn.push('installment');
    return match ?? { confidence, transaction, matchedOn };
  }, undefined);
}