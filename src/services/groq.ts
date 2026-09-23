import { supabase } from './supabase';

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: string;
}

async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (!(error instanceof Error)) return fallback;
  const context = (error as Error & { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json() as { error?: string; message?: string };
      if (body.error || body.message) return body.error ?? body.message ?? fallback;
    } catch {
      // Keep the SDK message when the response is not JSON.
    }
  }
  return error.message || fallback;
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

const GROQ_TIMEOUT_MS = 60000;

async function invokeGroq(action: 'chat' | 'extract', request: Record<string, unknown>): Promise<GroqResponse> {
  if (!supabase) throw new Error('Supabase não está configurado.');
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Tempo limite excedido ao consultar a IA. Tente novamente.')), GROQ_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([
      supabase.functions.invoke('groq-proxy', { body: { action, request } }),
      timeout,
    ]);
    if (error) throw new Error(await functionErrorMessage(error, 'Não foi possível consultar a IA.'));
    if (data?.error) throw new Error(data.error);
    return data as GroqResponse;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
