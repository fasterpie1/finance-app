import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const clientId = Deno.env.get('GOOGLE_CLIENT_ID')!;
const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const redirectUri = Deno.env.get('GOOGLE_REDIRECT_URI')!;
const appOrigin = Deno.env.get('APP_ORIGIN')!;
const encryptionSecret = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_SECRET')!;
const googleOAuthUrl = 'https://oauth2.googleapis.com/token';
const calendarUrl = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const admin = createClient(supabaseUrl, serviceRoleKey);

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') ?? appOrigin;
  const allowed = [appOrigin, 'http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'].includes(origin) ? origin : appOrigin;
  return {
  'Access-Control-Allow-Origin': allowed,
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
};

function json(body: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), 'Content-Type': 'application/json' } });
}

function redirect(status: string): Response {
  return Response.redirect(`${appOrigin}?google_calendar=${encodeURIComponent(status)}`, 302);
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function cryptoKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptionSecret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function base64(bytes: Uint8Array): string {
  let value = '';
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return btoa(value);
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function encrypt(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(), new TextEncoder().encode(value));
  return `${base64(iv)}.${base64(new Uint8Array(cipher))}`;
}

async function decrypt(value: string): Promise<string> {
  const [iv, cipher] = value.split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, await cryptoKey(), bytes(cipher));
  return new TextDecoder().decode(plain);
}

async function currentUser(request: Request): Promise<{ id: string; email?: string } | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser();
  return user;
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const response = await fetch(googleOAuthUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('A autorização do Google expirou.');
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken, expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000).toISOString() };
}

async function getAccessToken(userId: string): Promise<string> {
  const { data, error } = await admin.from('user_calendar_integrations').select('encrypted_access_token, encrypted_refresh_token, token_expires_at').eq('user_id', userId).maybeSingle();
  if (error || !data) throw new Error('Google Agenda não está conectado.');
  const refreshToken = await decrypt(data.encrypted_refresh_token);
  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;
  if (data.encrypted_access_token && expiresAt > Date.now() + 60_000) return decrypt(data.encrypted_access_token);
  const refreshed = await refreshAccessToken(refreshToken);
  await admin.from('user_calendar_integrations').update({ encrypted_access_token: await encrypt(refreshed.accessToken), encrypted_refresh_token: await encrypt(refreshed.refreshToken), token_expires_at: refreshed.expiresAt, updated_at: new Date().toISOString() }).eq('user_id', userId);
  return refreshed.accessToken;
}

async function googleRequest(userId: string, endpoint: string, init: RequestInit): Promise<Response> {
  const accessToken = await getAccessToken(userId);
  const response = await fetch(endpoint, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  if (response.status !== 401) return response;
  const { data } = await admin.from('user_calendar_integrations').select('encrypted_refresh_token').eq('user_id', userId).maybeSingle();
  if (!data) return response;
  const refreshed = await refreshAccessToken(await decrypt(data.encrypted_refresh_token));
  await admin.from('user_calendar_integrations').update({ encrypted_access_token: await encrypt(refreshed.accessToken), encrypted_refresh_token: await encrypt(refreshed.refreshToken), token_expires_at: refreshed.expiresAt, updated_at: new Date().toISOString() }).eq('user_id', userId);
  return fetch(endpoint, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${refreshed.accessToken}`, 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  const url = new URL(request.url);
  if (url.pathname.endsWith('/oauth-callback')) {
    try {
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (!state || !code) return redirect('cancelled');
      const stateHash = await sha256(state);
      const { data: stateRow } = await admin.from('google_calendar_oauth_states').select('user_id, expires_at').eq('state_hash', stateHash).maybeSingle();
      await admin.from('google_calendar_oauth_states').delete().eq('state_hash', stateHash);
      if (!stateRow || new Date(stateRow.expires_at).getTime() < Date.now()) return redirect('error');
      const tokenResponse = await fetch(googleOAuthUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.refresh_token) return redirect('error');
      const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const profile = await profileResponse.json().catch(() => ({}));
      await admin.from('user_calendar_integrations').upsert({ user_id: stateRow.user_id, provider: 'google', provider_account_id: profile.sub ?? null, provider_email: profile.email ?? null, encrypted_access_token: await encrypt(tokens.access_token), encrypted_refresh_token: await encrypt(tokens.refresh_token), token_expires_at: new Date(Date.now() + Number(tokens.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString() });
      return redirect('connected');
    } catch (error) {
      console.error('Google OAuth callback failed:', error instanceof Error ? error.message : 'unknown error');
      return redirect('error');
    }
  }
  try {
    const user = await currentUser(request);
    if (!user) return json({ error: 'Não autenticado.' }, 401, request);
    const body = await request.json() as { action?: string; title?: string; description?: string; start?: string; end?: string; reminder_minutes?: number; event_id?: string; time_min?: string; time_max?: string; query?: string };
    if (body.action === 'start-oauth') {
      const state = randomToken();
      await admin.from('google_calendar_oauth_states').delete().lt('expires_at', new Date().toISOString());
      const { error } = await admin.from('google_calendar_oauth_states').insert({ state_hash: await sha256(state), user_id: user.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
      if (error) throw error;
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'https://www.googleapis.com/auth/calendar.events', state });
      return json({ authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }, 200, request);
    }
    if (body.action === 'status') {
      const { data } = await admin.from('user_calendar_integrations').select('token_expires_at').eq('user_id', user.id).maybeSingle();
      if (!data) return json({ status: 'disconnected' }, 200, request);
      return json({ status: data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now() ? 'expired' : 'connected' }, 200, request);
    }
    if (body.action === 'disconnect') {
      await admin.from('user_calendar_integrations').delete().eq('user_id', user.id);
      return json({ status: 'disconnected' }, 200, request);
    }
    if (body.action === 'create-event') {
      if (!body.title || !body.start || !body.end) return json({ error: 'Título, início e fim são obrigatórios.' }, 400, request);
      const event = { summary: body.title, description: body.description ?? '', start: { dateTime: body.start }, end: { dateTime: body.end }, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: Math.max(0, Math.min(40320, Math.round(body.reminder_minutes ?? 1440))) }] } };
      const response = await googleRequest(user.id, calendarUrl, { method: 'POST', body: JSON.stringify(event) });
      if (!response.ok) return json({ error: 'O Google não aceitou a criação do evento.' }, response.status, request);
      return json(await response.json(), 200, request);
    }
    if (body.action === 'list-events') {
      const params = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
      if (body.time_min) params.set('timeMin', body.time_min);
      if (body.time_max) params.set('timeMax', body.time_max);
      if (body.query) params.set('q', body.query);
      const response = await googleRequest(user.id, `${calendarUrl}?${params.toString()}`, { method: 'GET' });
      if (!response.ok) return json({ error: 'Não foi possível consultar o Google Agenda.' }, response.status, request);
      const data = await response.json() as { items?: unknown[] };
      return json({ events: data.items ?? [] }, 200, request);
    }
    if (body.action === 'update-event' || body.action === 'delete-event') {
      if (!body.event_id) return json({ error: 'Evento inválido.' }, 400, request);
      const endpoint = `${calendarUrl}/${encodeURIComponent(body.event_id)}`;
      const updatePayload = body.action === 'delete-event' ? undefined : JSON.stringify({
        ...(body.title ? { summary: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.start ? { start: { dateTime: body.start } } : {}),
        ...(body.end ? { end: { dateTime: body.end } } : {}),
      });
      const response = await googleRequest(user.id, endpoint, { method: body.action === 'delete-event' ? 'DELETE' : 'PATCH', body: updatePayload });
      if (!response.ok) return json({ error: 'Não foi possível alterar o evento.' }, response.status, request);
      return body.action === 'delete-event' ? json({ ok: true }, 200, request) : json(await response.json(), 200, request);
    }
    return json({ error: 'Ação inválida.' }, 400, request);
  } catch (error) {
    console.error('Google Calendar request failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Não foi possível concluir a operação no Google Agenda.' }, 500, request);
  }
});
