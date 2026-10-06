import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  consumeRateLimit,
  InvalidJsonError,
  PayloadTooLargeError,
  RateLimitedError,
  readJsonBody,
  sanitizeGroqRequest,
} from '../_shared/guards.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const encryptionSecret = Deno.env.get('GROQ_KEY_ENCRYPTION_SECRET')!;
const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
/** Uma importação de fatura usa até 4 chamadas (rodadas de continuação); 20/min deixa o uso
 *  normal folgado e ainda corta script rodando em loop com a conta. */
const AI_REQUESTS_PER_MINUTE = 20;
const KEY_REQUESTS_PER_MINUTE = 10;
const configuredOrigins = (Deno.env.get('APP_ORIGIN') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  ...configuredOrigins,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const admin = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'retry-after',
  'X-Content-Type-Options': 'nosniff',
};

function headersFor(request: Request): HeadersInit {
  const origin = request.headers.get('Origin');
  return {
    ...corsHeaders,
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : (configuredOrigins[0] ?? '*'),
    Vary: 'Origin',
  };
}

function json(body: unknown, request: Request, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headersFor(request), ...extraHeaders, 'Content-Type': 'application/json' } });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptionSecret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(value));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decrypt(value: string): Promise<string> {
  const [iv, encrypted] = value.split('.');
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await encryptionKey(), base64ToBytes(encrypted));
  return new TextDecoder().decode(decrypted);
}

async function currentUser(request: Request): Promise<{ id: string } | null> {
  const token = request.headers.get('Authorization');
  if (!token) return null;
  const client = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: token } } });
  const { data: { user } } = await client.auth.getUser();
  return user;
}

async function loadGroqKey(userId: string): Promise<string | null> {
  const { data, error } = await admin.from('user_groq_keys').select('encrypted_key').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data?.encrypted_key ? decrypt(data.encrypted_key) : null;
}

async function callGroq(apiKey: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(groqUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { error: data?.error?.message ?? `Erro Groq ${response.status}`, status: response.status };
  return data;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headersFor(request) });
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: 'Não autenticado.' }, request, 401);
    const body = await readJsonBody<{ action?: string; key?: string; request?: unknown }>(request);

    if (body.action === 'chat' || body.action === 'extract') consumeRateLimit(`ai:${user.id}`, AI_REQUESTS_PER_MINUTE);
    else consumeRateLimit(`key:${user.id}`, KEY_REQUESTS_PER_MINUTE);

    if (body.action === 'save-key') {
      if (typeof body.key !== 'string' || body.key.length > 512 || !/^gsk_[A-Za-z0-9_-]+$/.test(body.key)) return json({ error: 'Chave Groq inválida.' }, request, 400);
      const { error } = await admin.from('user_groq_keys').upsert({ user_id: user.id, encrypted_key: await encrypt(body.key), updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ configured: true }, request);
    }
    if (body.action === 'delete-key') {
      const { error } = await admin.from('user_groq_keys').delete().eq('user_id', user.id);
      if (error) throw error;
      return json({ configured: false }, request);
    }
    if (body.action === 'status') return json({ configured: Boolean(await loadGroqKey(user.id)) }, request);
    if (body.action === 'chat' || body.action === 'extract') {
      const sanitized = sanitizeGroqRequest(body.request);
      if (!sanitized.ok) return json({ error: sanitized.message }, request, 400);
      const apiKey = await loadGroqKey(user.id);
      if (!apiKey) return json({ error: 'Configure sua chave Groq no Assistente.' }, request, 400);
      const result = await callGroq(apiKey, sanitized.body);
      if (typeof result === 'object' && result !== null && 'error' in result) return json(result, request, (result as { status?: number }).status ?? 502);
      return json(result, request);
    }
    return json({ error: 'Ação inválida.' }, request, 400);
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return json({ error: error.message }, request, 429, { 'Retry-After': String(error.retryAfterSeconds) });
    }
    if (error instanceof PayloadTooLargeError) return json({ error: error.message }, request, 413);
    if (error instanceof InvalidJsonError) return json({ error: error.message }, request, 400);
    // Detalhe técnico fica no log da função: o cliente recebe só a faixa de erro, porque
    // message pode carregar trecho da chave, da URL interna ou do corpo que falhou.
    console.error('[groq-proxy]', error);
    return json({ error: 'Não foi possível concluir a operação com a IA. Tente novamente em instantes.' }, request, 500);
  }
});
