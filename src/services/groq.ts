import { supabase } from './supabase';

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: string;
}

export async function saveGroqKey(key: string): Promise<void> {
  if (!supabase) throw new Error('Supabase não está configurado.');
  const { data, error } = await supabase.functions.invoke('groq-proxy', { body: { action: 'save-key', key } });
  if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Não foi possível salvar a chave.');
}

export async function deleteGroqKey(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.functions.invoke('groq-proxy', { body: { action: 'delete-key' } });
  if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Não foi possível remover a chave.');
}

export async function hasGroqKey(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.functions.invoke('groq-proxy', { body: { action: 'status' } });
  if (error) throw error;
  return Boolean(data?.configured);
}

async function invokeGroq(action: 'chat' | 'extract', request: Record<string, unknown>): Promise<GroqResponse> {
  if (!supabase) throw new Error('Supabase não está configurado.');
  const { data, error } = await supabase.functions.invoke('groq-proxy', { body: { action, request } });
  if (error || data?.error) throw new Error(data?.error ?? error?.message ?? 'Não foi possível consultar a IA.');
  return data as GroqResponse;
}

export async function sendGroqChat(request: Record<string, unknown>): Promise<string> {
  const data = await invokeGroq('chat', request);
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('A Groq encerrou a resposta antes de gerar o texto.');
  return content;
}

export async function extractWithGroq(request: Record<string, unknown>): Promise<string> {
  const data = await invokeGroq('extract', request);
  return data.choices?.[0]?.message?.content ?? '';
}
