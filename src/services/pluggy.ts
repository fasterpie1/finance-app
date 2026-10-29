import { supabase } from './supabase';
import type { OpenFinanceTransaction } from './pluggyTransactions';

export interface PluggyItemStatus {
  item_id: string;
  connector_name: string;
  status: string;
  last_synced_at: string | null;
  created_at: string;
}

interface FunctionResponse {
  error?: string;
  connectToken?: string;
  registered?: boolean;
  synced?: number;
  pending?: number;
  items?: PluggyItemStatus[];
  transactions?: Array<{
    provider_transaction_id: string;
    item_id: string;
    account_id: string;
    account_name: string;
    card_last4: string | null;
    bill_id: string | null;
    bill_month: string;
    statement_total_cents: number | null;
    merchant: string;
    amount_cents: number;
    transaction_date: string;
    transaction_type: OpenFinanceTransaction['type'];
    installment_current: number;
    installment_total: number;
  }>;
}

export interface PendingPluggyTransaction extends OpenFinanceTransaction {
  providerTransactionId: string;
}

interface PluggyWidgetOptions {
  connectToken: string;
  includeSandbox: boolean;
  onSuccess: (data: { item?: { id?: string } }) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
}

declare global {
  interface Window {
    PluggyConnect?: new (options: PluggyWidgetOptions) => { init: () => void };
  }
}

const FUNCTION_NAME = 'pluggy-open-finance';
const WIDGET_SCRIPT_URL = 'https://cdn.pluggy.ai/pluggy-connect/v2.8.2/pluggy-connect.js';
let widgetScriptPromise: Promise<void> | undefined;

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const context = (error as { context?: { status?: number } }).context;
  return typeof context?.status === 'number' ? context.status : undefined;
}

async function invokeOnce(body: Record<string, unknown>): Promise<{ data: FunctionResponse | null; error: unknown }> {
  if (!supabase) throw new Error('Supabase não está configurado.');
  return supabase.functions.invoke(FUNCTION_NAME, { body });
}

async function serverErrorMessage(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') return 'Não foi possível acessar a integração Pluggy.';
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    const body: unknown = await context.clone().json().catch(() => null);
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  }
  return (error as { message?: string }).message ?? 'Não foi possível acessar a integração Pluggy.';
}

async function invoke(body: Record<string, unknown>): Promise<FunctionResponse> {
  const first = await invokeOnce(body);
  if (!first.error && !first.data?.error) return first.data as FunctionResponse;
  if (statusOf(first.error) === 401) {
    const refreshed = await supabase?.auth.refreshSession();
    if (refreshed?.error || !refreshed?.data.session) {
      throw new Error('A sessão do aplicativo expirou. Entre novamente para usar o Open Finance.');
    }
    const retry = await invokeOnce(body);
    if (!retry.error && !retry.data?.error) return retry.data as FunctionResponse;
    throw new Error(retry.data?.error ?? await serverErrorMessage(retry.error));
  }
  throw new Error(first.data?.error ?? await serverErrorMessage(first.error));
}

export async function createPluggyConnectToken(): Promise<string> {
  const data = await invoke({ action: 'connect-token' });
  if (!data.connectToken) throw new Error('O servidor não retornou um token de conexão Pluggy.');
  return data.connectToken;
}

export async function registerPluggyItem(itemId: string): Promise<void> {
  await invoke({ action: 'register-item', item_id: itemId });
}

export async function syncPluggyTransactions(): Promise<{ synced: number; pending: number }> {
  const data = await invoke({ action: 'sync' });
  return { synced: data.synced ?? 0, pending: data.pending ?? 0 };
}

export async function getPluggyStatus(): Promise<PluggyItemStatus[]> {
  const data = await invoke({ action: 'status' });
  return data.items ?? [];
}

export async function getPendingPluggyTransactions(): Promise<PendingPluggyTransaction[]> {
  const data = await invoke({ action: 'pending' });
  return (data.transactions ?? []).map((transaction) => ({
    providerTransactionId: transaction.provider_transaction_id,
    providerItemId: transaction.item_id,
    accountId: transaction.account_id,
    accountName: transaction.account_name,
    cardLast4: transaction.card_last4 ?? undefined,
    billId: transaction.bill_id ?? undefined,
    billMonth: transaction.bill_month,
    statementTotalCents: transaction.statement_total_cents ?? undefined,
    merchant: transaction.merchant,
    amountCents: transaction.amount_cents,
    date: transaction.transaction_date,
    type: transaction.transaction_type,
    installmentCurrent: transaction.installment_current,
    installmentTotal: transaction.installment_total,
  }));
}

export async function markPluggyTransactionReviewed(
  transactionId: string,
  status: 'imported' | 'duplicate' | 'dismissed',
): Promise<void> {
  await invoke({ action: 'review', transaction_id: transactionId, review_status: status });
}

export function loadPluggyWidget(): Promise<void> {
  if (window.PluggyConnect) return Promise.resolve();
  if (widgetScriptPromise) return widgetScriptPromise;
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = WIDGET_SCRIPT_URL;
    script.async = true;
    script.onload = () => window.PluggyConnect
      ? resolve()
      : reject(new Error('O widget Pluggy foi carregado sem disponibilizar o SDK.'));
    script.onerror = () => reject(new Error('Não foi possível carregar o widget Pluggy.'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    widgetScriptPromise = undefined;
    throw error;
  });
  widgetScriptPromise = loading;
  return loading;
}
