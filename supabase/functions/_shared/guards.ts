/** Guardas compartilhadas das Edge Functions: teto de corpo, limite de requisições por
 *  usuário e whitelist do que é repassado para a Groq.
 *
 *  A contagem mora no Postgres porque isolado não compartilha memória: um contador em
 *  variável de módulo zeraria a cada requisição despachada em outro isolado. */

export const MAX_BODY_BYTES = 30 * 1024 * 1024;
const WINDOW_SECONDS = 60;

/** Corpo maior que o app nunca enviaria: cortado antes de serializar na memória. */
export class PayloadTooLargeError extends Error {
  constructor() {
    super('Arquivo ou conteúdo maior do que o aceito pelo servidor.');
    this.name = 'PayloadTooLargeError';
  }
}

export class InvalidJsonError extends Error {
  constructor() {
    super('Corpo da requisição inválido.');
    this.name = 'InvalidJsonError';
  }
}

/** Estourou o limite por usuário; o chamador devolve 429 com Retry-After. */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Muitas requisições em pouco tempo. Aguarde alguns segundos e tente de novo.');
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RateLimitCaller {
  rpc(functionName: string, params: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

function secondsUntilNextWindow(): number {
  return Math.max(1, WINDOW_SECONDS - Math.floor((Date.now() / 1000) % WINDOW_SECONDS));
}

export async function consumeRateLimit(caller: RateLimitCaller, callerId: string, limitPerMinute: number): Promise<void> {
  const { data, error } = await caller.rpc('rate_limit_hit', {
    p_caller: callerId,
    p_window_seconds: WINDOW_SECONDS,
    p_limit: limitPerMinute,
  });
  if (error) {
    // Aberto de propósito: sem a tabela de contagem o app segue funcionando, e a barreira de
    // custo real continua sendo a cota da chave de cada usuário. O log denuncia o contador ausente.
    console.error('[rate-limit] contador indisponível:', error.message);
    return;
  }
  const hits = Number(data);
  if (Number.isFinite(hits) && hits > limitPerMinute) throw new RateLimitedError(secondsUntilNextWindow());
}

export async function readJsonBody<T>(request: Request, maxBytes = MAX_BODY_BYTES): Promise<T> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new PayloadTooLargeError();
  const text = await request.text();
  if (text.length > maxBytes) throw new PayloadTooLargeError();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new InvalidJsonError();
  }
}

const ALLOWED_MODELS = new Set(
  (Deno.env.get('GROQ_ALLOWED_MODELS') ?? 'openai/gpt-oss-20b,qwen/qwen3.8-27b')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean),
);
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);
const ALLOWED_REASONING = new Set(['minimal', 'low', 'medium', 'high']);
const ALLOWED_RESPONSE_FORMATS = new Set(['json_object', 'text']);
const MAX_MESSAGES = 16;
const MAX_CONTENT_PARTS = 4;
const MAX_TEXT_CHARS = 200_000;
/** O app aceita arquivo de até 20 MB; em base64 isso passa perto de 27 MB. */
const MAX_IMAGE_DATA_CHARS = 28_000_000;
const MAX_OUTPUT_TOKENS = 1500;

export type GroqRequestOutcome = { ok: true; body: Record<string, unknown> } | { ok: false; message: string };

function invalid(message: string): GroqRequestOutcome {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content.length > MAX_TEXT_CHARS ? 'Mensagem longa demais.' : null;
  }
  if (!Array.isArray(content) || content.length === 0 || content.length > MAX_CONTENT_PARTS) {
    return 'Conteúdo da mensagem inválido.';
  }
  for (const part of content) {
    if (!isRecord(part)) return 'Conteúdo da mensagem inválido.';
    if (part.type === 'text') {
      if (typeof part.text !== 'string' || part.text.length > MAX_TEXT_CHARS) return 'Mensagem longa demais.';
      continue;
    }
    if (part.type === 'image_url') {
      const url = isRecord(part.image_url) ? part.image_url.url : undefined;
      if (typeof url !== 'string' || !url.startsWith('data:image/') || url.length > MAX_IMAGE_DATA_CHARS) {
        return 'Imagem inválida ou grande demais.';
      }
      continue;
    }
    return 'Tipo de conteúdo não suportado.';
  }
  return null;
}

function validateTokenBudget(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_OUTPUT_TOKENS) {
    return `Parâmetro ${key} fora do intervalo permitido.`;
  }
  return null;
}

/**
 * Reconstrói o corpo enviado à Groq a partir de uma whitelist. Campos desconhecidos não passam,
 * então ninguém consegue transformar o proxy em chamador arbitrário da API (outro modelo,
 * streaming, ferramentas, resposta em outro formato).
 */
export function sanitizeGroqRequest(raw: unknown): GroqRequestOutcome {
  if (!isRecord(raw)) return invalid('Corpo da requisição de IA inválido.');
  const { model, messages } = raw;
  if (typeof model !== 'string' || !ALLOWED_MODELS.has(model)) return invalid('Modelo não permitido.');
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return invalid('Número de mensagens fora do permitido.');
  }
  const cleanMessages: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (!isRecord(message)) return invalid('Mensagem inválida.');
    const { role, content } = message;
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) return invalid('Papel de mensagem inválido.');
    const contentError = validateContent(content);
    if (contentError) return invalid(contentError);
    cleanMessages.push({ role, content });
  }
  const budgetError = validateTokenBudget(raw, 'max_tokens') ?? validateTokenBudget(raw, 'max_completion_tokens');
  if (budgetError) return invalid(budgetError);
  const temperature = raw.temperature;
  if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
    return invalid('Temperatura fora do intervalo permitido.');
  }
  const reasoningEffort = raw.reasoning_effort;
  if (reasoningEffort !== undefined && (typeof reasoningEffort !== 'string' || !ALLOWED_REASONING.has(reasoningEffort))) {
    return invalid('Esforço de raciocínio inválido.');
  }
  const responseFormat = raw.response_format;
  if (responseFormat !== undefined) {
    if (!isRecord(responseFormat) || typeof responseFormat.type !== 'string' || !ALLOWED_RESPONSE_FORMATS.has(responseFormat.type)) {
      return invalid('Formato de resposta inválido.');
    }
  }

  const body: Record<string, unknown> = { model, messages: cleanMessages };
  if (raw.max_tokens !== undefined) body.max_tokens = raw.max_tokens;
  if (raw.max_completion_tokens !== undefined) body.max_completion_tokens = raw.max_completion_tokens;
  if (raw.temperature !== undefined) body.temperature = raw.temperature;
  if (raw.reasoning_effort !== undefined) body.reasoning_effort = raw.reasoning_effort;
  if (raw.response_format !== undefined) body.response_format = raw.response_format;
  return { ok: true, body };
}
