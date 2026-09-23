import { supabase } from './supabase';

export type GoogleCalendarStatus = 'disconnected' | 'connected' | 'expired' | 'error';

interface FunctionResponse {
  status?: GoogleCalendarStatus;
  authorization_url?: string;
  error?: string;
  id?: string;
  events?: CalendarEvent[];
}

async function invokeOnce(body: Record<string, unknown>): Promise<{ data: FunctionResponse | null; error: unknown }> {
  if (!supabase) throw new Error('Supabase não está configurado.');
  return supabase.functions.invoke('google-calendar', { body });
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const context = (error as { context?: { status?: number } }).context;
  return typeof context?.status === 'number' ? context.status : undefined;
}

function isUnauthorized(error: unknown): boolean {
  return statusOf(error) === 401;
}

function isNotFound(error: unknown): boolean {
  return statusOf(error) === 404;
}

async function invoke(body: Record<string, unknown>, options: { treatNotFoundAsSuccess?: boolean } = {}): Promise<FunctionResponse> {
  const first = await invokeOnce(body);
  if (!first.error && !first.data?.error) return first.data as FunctionResponse;
  if (options.treatNotFoundAsSuccess && isNotFound(first.error)) return {};
  if (isUnauthorized(first.error)) {
    const refreshed = await supabase?.auth.refreshSession();
    if (refreshed?.error || !refreshed?.data.session) throw new Error('A sessão do aplicativo expirou. Atualize a sessão da conta para reconectar o Google Agenda.');
    const retry = await invokeOnce(body);
    if (!retry.error && !retry.data?.error) return retry.data as FunctionResponse;
    if (options.treatNotFoundAsSuccess && isNotFound(retry.error)) return {};
    if (isUnauthorized(retry.error)) throw new Error('A sessão do aplicativo expirou. Atualize a sessão da conta para reconectar o Google Agenda.');
    throw new Error(retry.data?.error ?? (retry.error as { message?: string } | null)?.message ?? 'Não foi possível acessar o Google Agenda.');
  }
  throw new Error(first.data?.error ?? (first.error as { message?: string } | null)?.message ?? 'Não foi possível acessar o Google Agenda.');
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  const data = await invoke({ action: 'status' });
  return data.status ?? 'error';
}

export async function startGoogleCalendarOAuth(popup?: Window | null): Promise<Window | null> {
  const target = popup ?? window.open('', 'google-calendar-oauth', 'popup,width=520,height=720');
  if (!target) return null;
  const data = await invoke({ action: 'start-oauth' });
  if (!data.authorization_url) throw new Error('Não foi possível iniciar a conexão com o Google.');
  target.location.href = data.authorization_url;
  return target;
}

export async function disconnectGoogleCalendar(): Promise<void> {
  await invoke({ action: 'disconnect' });
}

export interface CalendarEventInput {
  title: string;
  description?: string;
  start: string;
  end: string;
  reminder_minutes?: number;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
}

export async function createCalendarEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  const data = await invoke({ action: 'create-event', ...input });
  if (!data.id) throw new Error('O Google não retornou o ID do evento.');
  return data as CalendarEvent;
}

export async function updateCalendarEvent(eventId: string, input: Partial<CalendarEventInput>): Promise<CalendarEvent> {
  return invoke({ action: 'update-event', event_id: eventId, ...input }) as Promise<CalendarEvent>;
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  // 404 = o evento já não existe no Google (removido manualmente). Tratar como
  // sucesso idempotente permite limpar o calendarEventId local em vez de travar
  // o botão como "já adicionado" para sempre.
  await invoke({ action: 'delete-event', event_id: eventId }, { treatNotFoundAsSuccess: true });
}

export async function listCalendarEvents(input: { timeMin?: string; timeMax?: string; query?: string } = {}): Promise<CalendarEvent[]> {
  const data = await invoke({ action: 'list-events', time_min: input.timeMin, time_max: input.timeMax, query: input.query });
  return data.events ?? [];
}
