import { type CreditCardTransaction } from '../types';
export {
  normalizePluggyTransaction,
  type OpenFinanceTransaction,
  type PluggyAccount,
  type PluggyBill,
  type PluggyTransaction,
} from '../../supabase/functions/_shared/pluggyTransactions';
import type { OpenFinanceTransaction } from '../../supabase/functions/_shared/pluggyTransactions';

export function hasSameProviderTransaction(
  candidate: Pick<OpenFinanceTransaction, 'providerTransactionId'>,
  existing: Array<Pick<CreditCardTransaction, 'providerTransactionId'>>,
): boolean {
  return existing.some((transaction) => (
    transaction.providerTransactionId === candidate.providerTransactionId
  ));
}
