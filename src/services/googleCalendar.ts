import { supabase } from './supabase';

export type GoogleCalendarStatus = 'disconnected' | 'connected' | 'expired' | 'error';

interface FunctionResponse {
  status?: GoogleCalendarStatus;
  authorization_url?: string;
  error?: string;
  id?: string;
  events?: CalendarEvent[];
}

async function invoke(body: Record<string, unknown>): Promise<FunctionResponse> {
  if (!supabase) throw new Error('Supabase não está configurado.');
  const { data, error } = await supabase.functions.invoke('google-calendar', { body });
  if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Não foi possível acessar o Google Agenda.');
  return data as FunctionResponse;
}

export async function getGoogleCalendarStatus(): Promise<GoogleCalendarStatus> {
  const data = await invoke({ action: 'status' });
  return data.status ?? 'error';
}

export async function startGoogleCalendarOAuth(): Promise<void> {
  const data = await invoke({ action: 'start-oauth' });
  if (!data.authorization_url) throw new Error('Não foi possível iniciar a conexão com o Google.');
  window.location.assign(data.authorization_url);
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
  await invoke({ action: 'delete-event', event_id: eventId });
}

export async function listCalendarEvents(input: { timeMin?: string; timeMax?: string; query?: string } = {}): Promise<CalendarEvent[]> {
  const data = await invoke({ action: 'list-events', time_min: input.timeMin, time_max: input.timeMax, query: input.query });
  return data.events ?? [];
}
