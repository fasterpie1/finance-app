import { supabase } from './supabase';

export type GoogleCalendarStatus = 'disconnected' | 'connected' | 'expired' | 'error';

interface FunctionResponse {
  status?: GoogleCalendarStatus;
  authorization_url?: string;
  error?: string;
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

export async function createCalendarEvent(input: CalendarEventInput): Promise<unknown> {
  return invoke({ action: 'create-event', ...input });
}

export async function updateCalendarEvent(eventId: string, input: Partial<CalendarEventInput>): Promise<unknown> {
  return invoke({ action: 'update-event', event_id: eventId, ...input });
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await invoke({ action: 'delete-event', event_id: eventId });
}
