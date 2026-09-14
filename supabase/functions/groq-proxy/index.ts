import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const encryptionSecret = Deno.env.get('GROQ_KEY_ENCRYPTION_SECRET')!;
const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
const allowedOrigin = Deno.env.get('APP_ORIGIN') ?? '*';
const admin = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: 'Não autenticado.' }, 401);
    const body = await request.json() as { action?: string; key?: string; request?: Record<string, unknown> };

    if (body.action === 'save-key') {
      if (!body.key || !/^gsk_[A-Za-z0-9_-]+$/.test(body.key)) return json({ error: 'Chave Groq inválida.' }, 400);
      const { error } = await admin.from('user_groq_keys').upsert({ user_id: user.id, encrypted_key: await encrypt(body.key), updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ configured: true });
    }
    if (body.action === 'delete-key') {
      const { error } = await admin.from('user_groq_keys').delete().eq('user_id', user.id);
      if (error) throw error;
      return json({ configured: false });
    }
    if (body.action === 'status') return json({ configured: Boolean(await loadGroqKey(user.id)) });
    if (body.action === 'chat' || body.action === 'extract') {
      const apiKey = await loadGroqKey(user.id);
      if (!apiKey) return json({ error: 'Configure sua chave Groq no Assistente.' }, 400);
      const result = await callGroq(apiKey, body.request ?? {});
      if (typeof result === 'object' && result !== null && 'error' in result) return json(result, (result as { status?: number }).status ?? 502);
      return json(result);
    }
    return json({ error: 'Ação inválida.' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Erro interno.' }, 500);
  }
});
