import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { consumeRateLimit, RateLimitedError, readJsonBody } from '../_shared/guards.ts';
import { normalizePluggyTransaction, type PluggyAccount, type PluggyBill, type PluggyTransaction } from '../_shared/pluggyTransactions.ts';
import { isPluggyAllowedEmail } from '../_shared/pluggyAccess.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const pluggyClientId = Deno.env.get('PLUGGY_CLIENT_ID');
const pluggyClientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET');
const apiBaseUrl = 'https://api.pluggy.ai';
const configuredOrigins = (Deno.env.get('APP_ORIGIN') ?? 'https://finance-app-alpha-opal.vercel.app')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  ...configuredOrigins,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
]);
const admin = createClient(supabaseUrl, serviceRoleKey);

interface ApiError extends Error {
  status?: number;
}

function headersFor(request: Request): HeadersInit {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : configuredOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'retry-after',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
}

function json(body: unknown, request: Request, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headersFor(request), ...extraHeaders, 'Content-Type': 'application/json' },
  });
}

async function currentUser(request: Request): Promise<{ id: string; email?: string } | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}

function requireCredentials(): { clientId: string; clientSecret: string } {
  if (!pluggyClientId || !pluggyClientSecret) {
    const error = new Error('Pluggy não está configurado no servidor.') as ApiError;
    error.status = 503;
    throw error;
  }
  return { clientId: pluggyClientId, clientSecret: pluggyClientSecret };
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`O serviço Pluggy respondeu com status ${response.status}.`) as ApiError;
    error.status = 502;
    throw error;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Resposta inválida do serviço Pluggy.');
  }
  return payload as Record<string, unknown>;
}

async function getApiKey(): Promise<string> {
  const { clientId, clientSecret } = requireCredentials();
  const response = await fetch(`${apiBaseUrl}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  const payload = await readResponse(response);
  if (typeof payload.apiKey !== 'string' || payload.apiKey.length === 0) {
    throw new Error('Pluggy não retornou uma chave de API válida.');
  }
  return payload.apiKey;
}

async function pluggyRequest(apiKey: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
      ...(init.headers ?? {}),
    },
  });
  return readResponse(response);
}

interface PluggyPage<T> {
  results?: T[];
  totalPages?: number;
}

async function listPages<T>(apiKey: string, resource: string, params: Record<string, string>): Promise<T[]> {
  const pageSize = 100;
  const rows: T[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const query = new URLSearchParams({ ...params, page: String(page), pageSize: String(pageSize) });
    const response = await pluggyRequest(apiKey, `${resource}?${query.toString()}`);
    const result = response as PluggyPage<T>;
    if (!Array.isArray(result.results)) throw new Error('Resposta de paginação inválida do Pluggy.');
    rows.push(...result.results);
    if (page >= (result.totalPages ?? 1) || result.results.length === 0) return rows;
  }
  throw new Error('O Pluggy retornou mais páginas do que o limite de sincronização permite.');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function syncItem(userId: string, itemId: string, apiKey: string): Promise<number> {
  const accounts = await listPages<PluggyAccount>(apiKey, '/accounts', { itemId });
  const cardAccounts = accounts.filter((account) => (
    account.type?.toUpperCase() === 'CREDIT' && account.subtype?.toUpperCase() === 'CREDIT_CARD'
  ));
  let inserted = 0;

  for (const account of cardAccounts) {
    const [transactions, bills] = await Promise.all([
      listPages<PluggyTransaction>(apiKey, '/transactions', { accountId: account.id }),
      listPages<PluggyBill>(apiKey, '/bills', { accountId: account.id }),
    ]);
    const billsById = new Map(bills.filter((bill) => typeof bill.id === 'string').map((bill) => [bill.id, bill]));
    const rows = transactions
      .filter((transaction) => !transaction.status || transaction.status.toUpperCase() === 'POSTED')
      .map((transaction) => normalizePluggyTransaction(transaction, account, itemId, billsById))
      .filter((transaction): transaction is NonNullable<typeof transaction> => transaction !== null)
      .map((transaction) => ({
        user_id: userId,
        provider_transaction_id: transaction.providerTransactionId,
        item_id: transaction.providerItemId,
        account_id: transaction.accountId,
        account_name: transaction.accountName,
        card_last4: transaction.cardLast4 ?? null,
        bill_id: transaction.billId ?? null,
        bill_month: transaction.billMonth,
        statement_total_cents: transaction.statementTotalCents ?? null,
        merchant: transaction.merchant,
        amount_cents: transaction.amountCents,
        transaction_date: transaction.date,
        transaction_type: transaction.type,
        installment_current: transaction.installmentCurrent,
        installment_total: transaction.installmentTotal,
      }));

    if (rows.length === 0) continue;
    const { error } = await admin.from('user_pluggy_transactions')
      .upsert(rows, { onConflict: 'user_id,provider_transaction_id', ignoreDuplicates: true });
    if (error) throw new Error('Não foi possível salvar as transações do Pluggy.');
    inserted += rows.length;
  }

  const { error } = await admin.from('user_pluggy_items')
    .update({ last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('item_id', itemId);
  if (error) throw new Error('Não foi possível atualizar o status da conexão Pluggy.');
  return inserted;
}

type RequestBody = {
  action?: string;
  item_id?: string;
  transaction_id?: string;
  review_status?: 'imported' | 'duplicate' | 'dismissed';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headersFor(request) });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, request, 405);

  let action = 'unknown';
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: 'Não autenticado.' }, request, 401);
    if (!isPluggyAllowedEmail(user.email)) {
      return json({ error: 'Open Finance disponível somente na conta de teste autorizada.' }, request, 403);
    }
    const body = await readJsonBody<RequestBody>(request, 16 * 1024);
    action = body.action ?? '';
    await consumeRateLimit(admin, `pluggy:${user.id}`, action === 'sync' ? 8 : 20);

    if (action === 'connect-token') {
      const apiKey = await getApiKey();
      const token = await pluggyRequest(apiKey, '/connect_token', {
        method: 'POST',
        body: JSON.stringify({ options: { clientUserId: user.id, avoidDuplicates: true } }),
      });
      if (typeof token.accessToken !== 'string') throw new Error('Pluggy não retornou um token de conexão válido.');
      return json({ connectToken: token.accessToken }, request);
    }

    if (action === 'register-item') {
      if (typeof body.item_id !== 'string' || !/^[0-9a-f-]{20,64}$/i.test(body.item_id)) {
        return json({ error: 'Conexão Pluggy inválida.' }, request, 400);
      }
      const apiKey = await getApiKey();
      const item = await pluggyRequest(apiKey, `/items/${encodeURIComponent(body.item_id)}`);
      if (item.clientUserId !== user.id) return json({ error: 'Esta conexão não pertence à conta atual.' }, request, 403);
      const connector = item.connector && typeof item.connector === 'object'
        ? item.connector as Record<string, unknown>
        : {};
      const { error } = await admin.from('user_pluggy_items').upsert({
        user_id: user.id,
        item_id: body.item_id,
        connector_name: stringValue(connector.name) ?? 'Instituição financeira',
        status: stringValue(item.status) ?? 'PENDING',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,item_id' });
      if (error) throw new Error('Não foi possível registrar a conexão Pluggy.');
      return json({ registered: true }, request);
    }

    if (action === 'sync') {
      const { data: items, error } = await admin.from('user_pluggy_items')
        .select('item_id')
        .eq('user_id', user.id);
      if (error) throw new Error('Não foi possível carregar as conexões Pluggy.');
      if (!items?.length) return json({ synced: 0, pending: 0 }, request);
      const apiKey = await getApiKey();
      let synced = 0;
      for (const item of items) synced += await syncItem(user.id, item.item_id, apiKey);
      const { count, error: countError } = await admin.from('user_pluggy_transactions')
        .select('provider_transaction_id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'pending');
      if (countError) throw new Error('Não foi possível carregar o resumo das transações.');
      return json({ synced, pending: count ?? 0 }, request);
    }

    if (action === 'status') {
      const { data, error } = await admin.from('user_pluggy_items')
        .select('item_id, connector_name, status, last_synced_at, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error('Não foi possível carregar o status da conexão Pluggy.');
      return json({ items: data ?? [] }, request);
    }

    if (action === 'pending') {
      const { data, error } = await admin.from('user_pluggy_transactions')
        .select('provider_transaction_id, item_id, account_id, account_name, card_last4, bill_id, bill_month, statement_total_cents, merchant, amount_cents, transaction_date, transaction_type, installment_current, installment_total')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('transaction_date', { ascending: true })
        .limit(100);
      if (error) throw new Error('Não foi possível carregar as transações pendentes do Pluggy.');
      return json({ transactions: data ?? [] }, request);
    }

    if (action === 'review') {
      if (typeof body.transaction_id !== 'string' || body.transaction_id.length > 200
        || !['imported', 'duplicate', 'dismissed'].includes(body.review_status ?? '')) {
        return json({ error: 'Atualização de revisão inválida.' }, request, 400);
      }
      const { data, error } = await admin.from('user_pluggy_transactions')
        .update({ status: body.review_status, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('provider_transaction_id', body.transaction_id)
        .eq('status', 'pending')
        .select('provider_transaction_id')
        .maybeSingle();
      if (error) throw new Error('Não foi possível atualizar a revisão da transação.');
      if (!data) return json({ error: 'Transação pendente não encontrada.' }, request, 404);
      return json({ reviewed: true }, request);
    }

    return json({ error: 'Ação inválida.' }, request, 400);
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return json({ error: error.message }, request, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    }
    const status = error && typeof error === 'object' && 'status' in error
      ? Number((error as ApiError).status) || 500
      : 500;
    console.error('[pluggy-open-finance]', { action, status, name: error instanceof Error ? error.name : 'unknown' });
    const message = error instanceof Error && status < 500
      ? error.message
      : 'Não foi possível concluir a operação com o Pluggy. Confira a configuração do servidor e tente novamente.';
    return json({ error: message }, request, status);
  }
});
