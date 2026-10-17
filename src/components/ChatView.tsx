import React, { useState, useRef, useEffect } from 'react';
import { buildAssistantChatRequest, buildAssistantHistory, classifyGroqError, deleteGroqKey, GroqRequestError, hasGroqKey, saveGroqKey, sendGroqChat } from '../services/groq';
import { prepareChatImage, type ChatImage } from '../services/statementFiles';
import { startSpeechInput, supportsSpeechInput } from '../services/speechInput';
import { readUserStorage, removeUserStorage, writeUserStorage } from '../services/userStorage';
import { usePreferences } from '../i18n';
import { MarkdownLite } from './MarkdownLite';
import {
  type AssistantUniverse,
  answerAssistantQuestion,
  buildAssistantDataSection,
  buildProtocolSection,
  classifyAssistantIntents,
  monthLabel,
  resolveMonthRef,
} from '../services/assistantContext';
import { type BudgetMonth } from '../types';
import { type AssistantCommand, type AssistantOutcome } from '../services/assistantCommands';

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  photoName?: string;
}

interface Props {
  universe: AssistantUniverse;
  userId: string | null;
  isActive?: boolean;
  calendarActions?: CalendarAssistantActions;
  /** Interpreta o JSON do modelo contra os dados reais e devolve a resposta ou a mudança pendente. */
  onCommand?: (command: AssistantCommand) => AssistantOutcome;
}

export interface CalendarAssistantActions {
  createBillReminder: (name: string) => Promise<string>;
  createInvoiceReminder: () => Promise<string>;
  listEvents: (day?: string) => Promise<string>;
  createEvent: (input: { title: string; date: string; time?: string; durationMinutes?: number; description?: string }) => Promise<string>;
  updateEvent: (input: { eventId?: string; query?: string; title?: string; date?: string; time?: string; description?: string }) => Promise<string>;
  deleteEvent: (query: string) => Promise<string>;
}

const STORAGE_KEY_CHAT = 'finance_chat_history';
const STORAGE_KEY_GROQ_STATUS = 'groq_configured';
const MAX_STORED_MESSAGES = 50;

const SUGGESTION_KEYS = ['suggestion1', 'suggestion2', 'suggestion3', 'suggestion4', 'suggestion5', 'suggestion6'];

function loadChat(userId: string | null): Message[] {
  try { const raw = readUserStorage(userId, STORAGE_KEY_CHAT); if (raw) return JSON.parse(raw) as Message[]; } catch { /* ignore */ }
  return [];
}

/** O comando da IA: os campos do aplicativo vêm de assistantCommands, os de agenda ficam aqui. */
type ChatCommand = AssistantCommand & {
  title?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  description?: string;
  eventId?: string;
  query?: string;
};

interface PendingChange {
  summary: string[];
  apply: () => string;
}

function parseAssistantCommand(content: string): ChatCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }
  const invalid = () => { throw new GroqRequestError('Resposta inválida da IA.', 'format'); };
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return invalid();
  const command = parsed as Record<string, unknown>;
  const strings = ['action', 'response', 'month', 'card', 'category', 'owner', 'thirdPartyName', 'name', 'paymentMethod', 'billName', 'bank', 'last4', 'label', 'title', 'date', 'time', 'description', 'eventId', 'query'];
  const numbers = ['personalAmount', 'amount', 'day', 'installmentCurrent', 'installmentTotal', 'dueDay', 'durationMinutes'];
  if (strings.some((key) => command[key] !== undefined && typeof command[key] !== 'string')
    || numbers.some((key) => command[key] !== undefined && (typeof command[key] !== 'number' || !Number.isFinite(command[key])))) return invalid();
  if (command.scope !== undefined) {
    if (typeof command.scope !== 'object' || command.scope === null || Array.isArray(command.scope)) return invalid();
    const scope = command.scope as Record<string, unknown>;
    if (['category', 'card', 'owner', 'merchant'].some((key) => scope[key] !== undefined && typeof scope[key] !== 'string')
      || ['withoutCard', 'unclassifiedCategory'].some((key) => scope[key] !== undefined && typeof scope[key] !== 'boolean')
      || (scope.day !== undefined && (typeof scope.day !== 'number' || !Number.isFinite(scope.day)))) return invalid();
  }
  if ((!command.action || command.action === 'none') && (typeof command.response !== 'string' || !command.response.trim())) return invalid();
  return command as ChatCommand;
}

const IconAI = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a4 4 0 014 4v1h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2V6a4 4 0 014-4z" />
    <circle cx="9" cy="13" r="1" fill="currentColor" /><circle cx="15" cy="13" r="1" fill="currentColor" />
  </svg>
);

export const ChatView: React.FC<Props> = ({ universe, userId, isActive = true, calendarActions, onCommand }) => {
  const { t, locale } = usePreferences();
  const [messages, setMessages] = useState<Message[]>(() => loadChat(userId));
  const [input, setInput] = useState('');
  const [attachment, setAttachment] = useState<ChatImage | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [retryUntil, setRetryUntil] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const speechSupported = supportsSpeechInput();
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKeySetup, setShowKeySetup] = useState(() => readUserStorage(userId, STORAGE_KEY_GROQ_STATUS) !== 'true');
  const [keyLoading, setKeyLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRequestRef = useRef(0);
  const speechRef = useRef<ReturnType<typeof startSpeechInput> | null>(null);
  const dictationBaseRef = useRef('');
  const inFlightRef = useRef(false);
  const requestRef = useRef(0);
  const retryUntilRef = useRef(0);

  useEffect(() => {
    if (!retryUntil) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((retryUntil - Date.now()) / 1000));
      setRetrySeconds(seconds);
      if (!seconds) setRetryUntil(0);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  useEffect(() => () => {
    speechRef.current?.abort();
    speechRef.current = null;
    setDictating(false);
  }, [isActive, locale, showKeySetup]);
  useEffect(() => () => { imageRequestRef.current += 1; requestRef.current += 1; }, []);

  useEffect(() => {
    // offsetParent é null quando o chat está oculto (outra aba): não rolar a página.
    if (bottomRef.current && bottomRef.current.offsetParent !== null) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let lastHeight = vv.height;
    const onResize = () => {
      const node = bottomRef.current;
      // O teclado encolhe o chat depois da última resposta; sem reposicionar, a mensagem
      // final ficava atrás das sugestões. Só age quando a altura diminui (teclado abrindo).
      if (node && node.offsetParent !== null && lastHeight - vv.height > 140) node.scrollIntoView({ block: 'end' });
      lastHeight = vv.height;
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => { if (userId) writeUserStorage(userId, STORAGE_KEY_CHAT, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES))); }, [messages, userId]);
  useEffect(() => {
    const cachedStatus = readUserStorage(userId, STORAGE_KEY_GROQ_STATUS);
    if (cachedStatus === 'true') {
      setShowKeySetup(false);
      setKeyLoading(false);
      void hasGroqKey().then((configured) => {
        if (!configured) {
          removeUserStorage(userId, STORAGE_KEY_GROQ_STATUS);
          setShowKeySetup(true);
        }
      }).catch(() => undefined);
      return;
    }
    // A chave já não fica em localStorage global: quem tivesse a cópia legada precisa
    // colá-la de novo, porque subir a chave global para a conta que abriu o app primeiro
    // entregava a chave de uma conta à outra no mesmo aparelho.
    void hasGroqKey().then((configured) => {
      setShowKeySetup(!configured);
      if (configured) writeUserStorage(userId, STORAGE_KEY_GROQ_STATUS, 'true');
    }).catch(() => setShowKeySetup(true)).finally(() => setKeyLoading(false));
  }, [userId]);

  const saveKey = async () => { const k = apiKeyInput.trim(); if (!k.startsWith('gsk_')) return; setKeyLoading(true); try { await saveGroqKey(k); writeUserStorage(userId, STORAGE_KEY_GROQ_STATUS, 'true'); setShowKeySetup(false); setApiKeyInput(''); } catch (err) { setMessages((prev) => [...prev, { role: 'error', content: err instanceof Error ? err.message : t('googleErrorDescription') }]); } finally { setKeyLoading(false); } };
  const removeKey = async () => { setKeyLoading(true); try { await deleteGroqKey(); removeUserStorage(userId, STORAGE_KEY_GROQ_STATUS); setShowKeySetup(true); } catch (err) { setMessages((prev) => [...prev, { role: 'error', content: err instanceof Error ? err.message : t('googleErrorDescription') }]); } finally { setKeyLoading(false); } };
  const clearChat = () => { requestRef.current += 1; inFlightRef.current = false; setLoading(false); setPending(null); setMessages([]); removeUserStorage(userId, STORAGE_KEY_CHAT); };

  const removePhoto = () => {
    imageRequestRef.current += 1;
    setAttachment(null);
    setImageLoading(false);
    setComposerError(null);
  };

  const selectPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || loading) return;
    const requestId = ++imageRequestRef.current;
    setAttachment(null);
    setImageLoading(true);
    setComposerError(null);
    try {
      const image = await prepareChatImage(file);
      if (requestId === imageRequestRef.current) setAttachment(image);
    } catch (error) {
      if (requestId === imageRequestRef.current) {
        const key = error instanceof Error && ['chatPhotoSize', 'chatPhotoInvalid', 'chatPhotoReadError'].includes(error.message)
          ? error.message : 'chatPhotoReadError';
        setComposerError(t(key));
      }
    } finally {
      if (requestId === imageRequestRef.current) setImageLoading(false);
    }
  };

  const toggleDictation = () => {
    if (speechRef.current) {
      speechRef.current.stop();
      return;
    }
    if (!speechSupported || loading || !isActive) return;
    dictationBaseRef.current = input;
    setComposerError(null);
    setDictating(true);
    try {
      speechRef.current = startSpeechInput(locale, {
        onTranscript: (text) => setInput((previous) => `${previous}${previous && !/\s$/.test(previous) ? ' ' : ''}${text}`),
        onEnd: () => {
          speechRef.current?.abort();
          speechRef.current = null;
          setDictating(false);
        },
        onError: (error) => {
          speechRef.current?.abort();
          speechRef.current = null;
          setDictating(false);
          const key = error === 'not-allowed' || error === 'service-not-allowed' ? 'chatVoiceDenied'
            : error === 'no-speech' ? 'chatVoiceNoSpeech'
            : error === 'network' ? 'chatVoiceNetwork'
            : error === 'audio-capture' ? 'chatVoiceNoMicrophone' : 'chatVoiceError';
          setComposerError(t(key));
        },
      });
    } catch {
      setDictating(false);
      setComposerError(t('chatVoiceError'));
    }
  };

  const cancelDictation = () => {
    speechRef.current?.abort();
    speechRef.current = null;
    setDictating(false);
    setInput(dictationBaseRef.current);
  };

  const sendMessage = async (text?: string) => {
    const image = attachment;
    const typed = (text ?? input).trim();
    const msg = typed || (image ? t('chatDescribePhoto') : '');
    if (!msg || showKeySetup || inFlightRef.current || imageLoading || dictating || !isActive) return;
    const intents = classifyAssistantIntents(msg, universe, Boolean(image));
    const localAnswer = image ? null : answerAssistantQuestion(msg, universe, t);
    if (!localAnswer && Date.now() < retryUntilRef.current) return;
    const requestId = ++requestRef.current;
    inFlightRef.current = true;
    setInput('');
    setAttachment(null);
    setComposerError(null);
    // Uma mudança por vez: se o usuário escrever de novo, a confirmação anterior é descartada.
    setPending(null);
    const userMsg: Message = { role: 'user', content: msg, ...(image ? { photoName: image.name } : {}) };
    const history = [...messages, userMsg].slice(-MAX_STORED_MESSAGES);
    setMessages(history);
    if (localAnswer) {
      setMessages((previous) => [...previous, { role: 'assistant', content: localAnswer }]);
      inFlightRef.current = false;
      return;
    }
    setLoading(true);
    const tokenMetrics = { calls: 0, measuredCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, latencyMs: 0 };
    let requestFailed = false;
    const sendMeasured = (request: Record<string, unknown>) => {
      tokenMetrics.calls += 1;
      return sendGroqChat(request, (metrics) => {
        tokenMetrics.latencyMs += metrics.latencyMs;
        if (metrics.totalTokens === undefined) return;
        tokenMetrics.measuredCalls += 1;
        tokenMetrics.inputTokens += metrics.inputTokens ?? 0;
        tokenMetrics.outputTokens += metrics.outputTokens ?? 0;
        tokenMetrics.totalTokens += metrics.totalTokens;
        tokenMetrics.cachedInputTokens += metrics.cachedInputTokens ?? 0;
      });
    };
    try {
      const today = new Date().toISOString().slice(0, 10);
      const calendarInstructions = `\n\nVocê também pode controlar o Google Agenda. Hoje é ${today}. Para qualquer pedido de agenda, responda SOMENTE um JSON válido, sem markdown, com este formato: {"action":"...","response":"..."}. Ações disponíveis: create_bill_reminder com billName para uma conta do mês atual (o lembrete usa automaticamente 9h no dia anterior ao vencimento); create_invoice_reminder para a fatura do mês atual (também usa 9h); create_event com title, date YYYY-MM-DD, time HH:mm, durationMinutes e description; list_events com date YYYY-MM-DD (omita para hoje); update_event com eventId ou query e os campos a alterar; delete_event com query ou eventId. Para create_event, NUNCA invente nem assuma título, data ou horário: se algum desses três campos faltar, use action none e escreva em response uma pergunta objetiva dizendo exatamente o que falta. Para perguntas normais use action none e coloque a resposta em response. Não invente IDs nem contas.\n`;
      const historyMessages = buildAssistantHistory(history.map((m) => ({
        role: m.role,
        content: `${m.content}${m.photoName ? `\n${t('chatPhotoLabel', { name: m.photoName })}` : ''}`,
      })));
      // Só um mês vai linha a linha no prompt: com o extrato de todos os meses o limite de tokens
      // por minuto da Groq gratuita estourava e a resposta chegava cortada.
      const includeDetails = intents.includes('action') || /\b(detalh\w*|list\w*|estabelec\w*|datas?|quando|qual dia|quem|quais compras|which purchases|merchant)\b/i.test(msg);
      const systemFor = (month: BudgetMonth, withCalendar: boolean, detailed = false) => `${buildAssistantDataSection(universe, month, detailed, intents)}\n\n${buildProtocolSection(universe, intents)}\nFotos de mensagens anteriores não estão disponíveis: use apenas os dados já descritos na conversa ou peça para anexar novamente.${withCalendar && calendarActions && !image ? calendarInstructions : ''}`;
      const sendWithJsonRetry = async (request: Record<string, unknown>) => {
        try {
          return await sendMeasured(request);
        } catch (error) {
          const format = request.response_format as { type?: unknown } | undefined;
          if (!(error instanceof GroqRequestError) || !/failed to generate json/i.test(error.message) || format?.type !== 'json_object') throw error;
          const requestMessages = request.messages as Array<{ role?: string; content?: unknown }>;
          const [systemMessage, ...otherMessages] = requestMessages;
          const fallbackSystem = {
            ...systemMessage,
            content: `${String(systemMessage?.content ?? '')}\nA formatação JSON do provedor falhou. Gere um único objeto JSON válido, sem markdown nem texto fora dele.`,
          };
          return sendMeasured({ ...request, response_format: { type: 'text' }, messages: [fallbackSystem, ...otherMessages] });
        }
      };
      let rawContent = await sendWithJsonRetry(buildAssistantChatRequest(systemFor(universe.selectedMonth, intents.includes('calendar'), includeDetails), historyMessages, image?.dataUrl));
      if (requestId !== requestRef.current) return;
      let command = parseAssistantCommand(rawContent);
      if (!command) throw new GroqRequestError('Resposta inválida da IA.', 'format');
      if (command?.action === 'get_month_detail') {
        const target = resolveMonthRef(universe, command.month);
        if (!target) {
          setMessages((prev) => [...prev, { role: 'assistant', content: `Não há mês cadastrado com o nome "${(command?.month ?? '').trim()}". Os meses disponíveis são ${universe.months.map((month) => monthLabel(month)).join(', ')}.` }]);
          return;
        }
        rawContent = await sendWithJsonRetry(buildAssistantChatRequest(systemFor(target, false, true), [
          ...historyMessages,
          { role: 'assistant', content: rawContent },
          { role: 'user', content: `Extrato completo de ${monthLabel(target)} carregado acima. Responda a pergunta agora, com action none.` },
        ], image?.dataUrl));
        if (requestId !== requestRef.current) return;
        command = parseAssistantCommand(rawContent);
        if (!command) throw new GroqRequestError('Resposta inválida da IA.', 'format');
      }
      // A IA pode mandar buscar o extrato de outro mês antes de responder.
      const CALENDAR_ACTIONS = ['create_bill_reminder', 'create_invoice_reminder', 'create_event', 'list_events', 'update_event', 'delete_event'];
      if (!command.action || command.action === 'none') {
        setMessages((prev) => [...prev, { role: 'assistant', content: command?.response ?? rawContent }]);
        return;
      }
      if (CALENDAR_ACTIONS.includes(command.action)) {
        if (image) {
          setMessages((prev) => [...prev, { role: 'assistant', content: t('chatPhotoCalendar') }]);
          return;
        }
        if (!calendarActions) { setMessages((prev) => [...prev, { role: 'assistant', content: command.response ?? rawContent }]); return; }
        let result: string;
        if (command.action === 'create_bill_reminder') result = command.billName ? await calendarActions.createBillReminder(command.billName) : 'Informe qual conta deve receber o lembrete.';
        else if (command.action === 'create_invoice_reminder') result = await calendarActions.createInvoiceReminder();
        else if (command.action === 'list_events') result = await calendarActions.listEvents(command.date);
        else if (command.action === 'create_event') result = command.title && command.date ? await calendarActions.createEvent({ title: command.title, date: command.date, time: command.time, durationMinutes: command.durationMinutes, description: command.description }) : 'Informe o título e a data do evento.';
        else if (command.action === 'update_event') result = await calendarActions.updateEvent({ eventId: command.eventId, query: command.query, title: command.title, date: command.date, time: command.time, description: command.description });
        else if (command.action === 'delete_event') result = command.query || command.eventId ? await calendarActions.deleteEvent(command.query ?? command.eventId ?? '') : 'Informe qual evento deve ser removido.';
        // Unknown/hallucinated action: never fall through to a destructive delete.
        else result = command.response ?? 'Não entendi o comando de agenda.';
        if (requestId !== requestRef.current) return;
        setMessages((prev) => [...prev, { role: 'assistant', content: result }]);
        return;
      }
      // Alteração no aplicativo: nada muda antes de o usuário tocar em Aplicar.
      const outcome = onCommand ? onCommand(command) : { kind: 'answer' as const, text: command.response ?? 'Não entendi esse pedido.' };
      if (outcome.kind === 'answer') {
        setMessages((prev) => [...prev, { role: 'assistant', content: outcome.text }]);
        return;
      }
      setPending({ summary: outcome.summary, apply: outcome.apply });
      setMessages((prev) => [...prev, { role: 'assistant', content: command.response ?? outcome.summary[0] ?? '' }]);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      requestFailed = true;
      if (image) setAttachment((current) => current ?? image);
      setInput((current) => current || typed);
      const error = err instanceof GroqRequestError ? err : classifyGroqError(err instanceof Error ? err.message : '');
      if (error.kind === 'rate_limit') {
        const seconds = error.retryAfterSeconds ?? 60;
        const until = Date.now() + seconds * 1000;
        retryUntilRef.current = until;
        setRetryUntil(until);
        setRetrySeconds(seconds);
      }
      const content = error.kind === 'rate_limit' ? t('chatRateLimited')
        : error.kind === 'session' ? t('sessionExpiredAssistant')
        : error.kind === 'format' ? t('chatFormatError')
        : error.kind === 'network' ? t('chatNetworkError') : t('chatRequestError');
      setMessages((prev) => [...prev, { role: 'error', content }]);
    } finally {
      if (requestId === requestRef.current) {
        if (tokenMetrics.calls > 0) console.info('[assistant-metrics]', {
          calls: tokenMetrics.calls,
          measuredCalls: tokenMetrics.measuredCalls,
          inputTokens: tokenMetrics.measuredCalls ? tokenMetrics.inputTokens : null,
          outputTokens: tokenMetrics.measuredCalls ? tokenMetrics.outputTokens : null,
          totalTokens: tokenMetrics.measuredCalls ? tokenMetrics.totalTokens : null,
          cachedInputTokens: tokenMetrics.measuredCalls ? tokenMetrics.cachedInputTokens : null,
          latencyMs: tokenMetrics.latencyMs || null,
          outcome: requestFailed ? 'error' : 'success',
        });
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void sendMessage(); } };

  const applyPending = () => {
    if (!pending) return;
    const result = pending.apply();
    setPending(null);
    setMessages((prev) => [...prev, { role: 'assistant', content: result }]);
  };

  const cancelPending = () => {
    setPending(null);
    setMessages((prev) => [...prev, { role: 'assistant', content: t('assistantCancelled') }]);
  };

  const waitingForAI = retrySeconds > 0 && (Boolean(attachment) || !answerAssistantQuestion(input.trim(), universe, t));

  if (keyLoading) {
    return (
      <div className="theme-chat-view" style={{ display: 'grid', placeItems: 'center', minHeight: 400, color: '#8f8f8f', fontSize: 12 }}>
        {t('checkingAssistant')}
      </div>
    );
  }

  if (showKeySetup) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 24, padding: '0 4px' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="theme-ai-icon" style={{ width: 48, height: 48, borderRadius: 12, background: '#111520', border: '1px solid #1e2a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#60a5fa' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 014 4v1h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2V6a4 4 0 014-4z" /><circle cx="9" cy="13" r="1" fill="currentColor" /><circle cx="15" cy="13" r="1" fill="currentColor" /></svg>
          </div>
          <h2 className="chat-title" style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#e0e0e0' }}>{t('financialAssistant')}</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#a3a3a3', maxWidth: 360 }}>{t('freeAi')}</p>
        </div>
        <div className="theme-ai-setup" style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, padding: 20, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 10, color: '#9a9a9a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>{t('groqKey')}</label>
            <input autoFocus type="password" placeholder="gsk_..." value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveKey()} style={{ width: '100%', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 6, color: '#e0e0e0', padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div className="theme-ai-info" style={{ background: '#0a1a0a', border: '1px solid #152515', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#4ade80', marginBottom: 8 }}>{t('setup')}</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#9a9a9a', lineHeight: 1.8 }}>
              <li>{t('setupAccess')} <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>console.groq.com/keys</a></li>
              <li>{t('setupCreateAccount')}</li>
              <li>{t('setupClick')} <strong style={{ color: '#c0c0c0' }}>Create API Key</strong></li>
              <li>{t('setupPaste')} <code style={{ color: '#f59e0b', background: '#1a1a0a', padding: '1px 4px', borderRadius: 2 }}>gsk_</code>{t('setupPasteEnd')}</li>
            </ol>
            <div className="chat-model-label" style={{ fontSize: 10, color: '#8f8f8f', marginTop: 8 }}>{t('chatModelLabel')}</div>
          </div>
          <button type="button" className="chat-save" onClick={saveKey} disabled={keyLoading || !apiKeyInput.startsWith('gsk_')} style={{ background: apiKeyInput.startsWith('gsk_') && !keyLoading ? '#3b82f6' : '#151520', border: 'none', borderRadius: 6, color: apiKeyInput.startsWith('gsk_') && !keyLoading ? '#fff' : '#3a4a5a', cursor: apiKeyInput.startsWith('gsk_') && !keyLoading ? 'pointer' : 'not-allowed', padding: '10px', fontSize: 13, fontWeight: 600 }}>{keyLoading ? t('saving') : t('saveAndStart')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="theme-chat-view theme-chat-active" style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, height: 'auto', overflow: 'hidden', gap: 0 }}>
      <div className="theme-chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="chat-avatar" style={{ width: 28, height: 28, borderRadius: 8, background: '#111520', border: '1px solid #1e2a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa' }}><IconAI /></div>
          <div>
            <div className="chat-title" style={{ fontSize: 13, fontWeight: 600, color: '#c0c0c0' }}>{t('financialAssistant')}</div>
            <div className="chat-model-label" style={{ fontSize: 11, color: '#8f8f8f' }} title={t('chatModelLabel')}>{monthLabel(universe.selectedMonth)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {messages.length > 0 && (
            <button type="button" onClick={clearChat} style={{ background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 6, color: '#8b8b8b', cursor: 'pointer', fontSize: 11, padding: '6px 9px', minWidth: 40, minHeight: 40, display: 'grid', placeItems: 'center' }} title={t('clearConversation')}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
            </button>
          )}
          <button type="button" onClick={removeKey} style={{ background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 6, color: '#8b8b8b', cursor: 'pointer', fontSize: 11, padding: '6px 9px', minWidth: 40, minHeight: 40, display: 'grid', placeItems: 'center' }} title={t('changeKey')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
            </button>
        </div>
      </div>

      <div className="theme-chat-messages" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16 }}>
            <div style={{ textAlign: 'center', color: '#8b8b8b', fontSize: 12 }}>{t('askAboutSpending')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {SUGGESTION_KEYS.map((key) => (<button type="button" className="theme-ai-suggestion" key={key} disabled={Boolean(attachment) || imageLoading || dictating || (retrySeconds > 0 && !answerAssistantQuestion(t(key), universe, t))} onClick={() => sendMessage(t(key))} title={t(key)} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 6, color: '#9a9a9a', cursor: 'pointer', padding: '7px 12px', fontSize: 12, minHeight: 40, transition: 'all 0.15s', textAlign: 'left' }}>{t(`${key}Short`)}</button>))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 6 }}>
            {m.role !== 'user' && (
              <div className={m.role === 'error' ? undefined : 'chat-avatar'} style={{ width: 22, height: 22, borderRadius: 6, background: m.role === 'error' ? '#1a1010' : '#111520', border: `1px solid ${m.role === 'error' ? '#2a1515' : '#1e2a3e'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.role === 'error' ? '#ef4444' : '#60a5fa', flexShrink: 0, marginBottom: 2 }}>
                {m.role === 'error' ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg> : <IconAI />}
              </div>
            )}
            <div className={`theme-ai-message theme-ai-message-${m.role}`} style={{ maxWidth: '85%', background: m.role === 'user' ? '#1a2a4a' : m.role === 'error' ? '#1a1010' : '#141414', border: `1px solid ${m.role === 'user' ? '#1e3050' : m.role === 'error' ? '#2a1515' : '#1e1e1e'}`, borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px', padding: '9px 13px', fontSize: 13, color: m.role === 'error' ? '#ef4444' : '#c0c0c0', lineHeight: 1.6, whiteSpace: m.role === 'assistant' ? 'normal' : 'pre-wrap', wordBreak: 'break-word' }}>
              {m.photoName && <div className="chat-media-note">{t('chatPhotoLabel', { name: m.photoName })}</div>}
              {m.role === 'assistant' ? <MarkdownLite text={m.content} /> : m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <div className="chat-avatar" style={{ width: 22, height: 22, borderRadius: 6, background: '#111520', border: '1px solid #1e2a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa' }}><IconAI /></div>
            <div className="chat-typing" role="status" style={{ background: '#141414', border: '1px solid #1e1e1e', borderRadius: '12px 12px 12px 4px', padding: '10px 14px' }}>
              <div className="chat-media-note" style={{ marginBottom: 6 }}>{t('chatResponding')}</div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0, 1, 2].map((d) => (<div key={d} style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6', animation: `bounce 1.2s ${d * 0.2}s infinite ease-in-out` }} />))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {pending && (
        <div className="chat-pending-change" style={{ flexShrink: 1, minHeight: 0, margin: '6px 0', padding: 12, background: '#0d1522', border: '1px solid #1e3050', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('assistantConfirmTitle')}</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#c0c0c0', lineHeight: 1.7, maxHeight: 120, overflowY: 'auto' }}>
            {pending.summary.map((line, index) => (<li key={index}>{line}</li>))}
          </ul>
          <div style={{ fontSize: 10, color: '#8a8a8a' }}>{t('assistantConfirmHint')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={cancelPending} style={{ flex: 1, background: 'transparent', border: '1px solid #22334a', borderRadius: 6, color: '#9a9a9a', cursor: 'pointer', padding: '10px', fontSize: 13, fontWeight: 600, minHeight: 40 }}>{t('assistantCancel')}</button>
            <button type="button" onClick={applyPending} style={{ flex: 1, background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '10px', fontSize: 13, fontWeight: 600, minHeight: 40 }}>{t('assistantApply')}</button>
          </div>
        </div>
      )}

      {messages.length > MAX_STORED_MESSAGES - 5 && (
        <div className="chat-history-note" style={{ fontSize: 10, color: '#8f8f8f', padding: '4px 0', textAlign: 'center', flexShrink: 0 }}>
          {t('chatHistoryLimit')}
        </div>
      )}

      <div className="theme-chat-composer chat-composer">
        {retrySeconds > 0 && <div className="chat-media-note" role="status" aria-live="off">{t('chatRetryCountdown', { seconds: retrySeconds })}</div>}
        {(attachment || imageLoading) && (
          <div className="chat-photo-preview">
            {attachment && <img src={attachment.dataUrl} alt={t('chatPhotoPreview')} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="chat-photo-name">{imageLoading ? t('chatPreparingPhoto') : attachment?.name}</div>
              <div className="chat-media-note">{t('chatPhotoHelp')}</div>
            </div>
            <button className="chat-media-button" type="button" onClick={removePhoto} aria-label={t('chatRemovePhoto')} title={t('chatRemovePhoto')}>×</button>
          </div>
        )}
        {composerError && <div className="chat-composer-error" role="alert">{composerError}</div>}
        {dictating && (
          <div className="chat-voice-status" role="status">
            <span>{t('chatListening')}</span>
            <button className="chat-media-button" type="button" onClick={cancelDictation}>{t('chatCancelDictation')}</button>
          </div>
        )}
        <div className="chat-input-box">
          <textarea className="chat-text-input" aria-label={t('askAboutExpenses')} placeholder={t('askAboutExpenses')} value={input} readOnly={dictating} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} rows={input ? 2 : 1} />
          <div className="chat-composer-actions">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void selectPhoto(event); }} hidden />
            <button className="chat-media-button" type="button" onClick={() => fileRef.current?.click()} disabled={loading || imageLoading} aria-label={t('chatAddPhoto')} title={t('chatAddPhoto')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
            </button>
            <button className={`chat-media-button${dictating ? ' is-listening' : ''}`} type="button" onClick={toggleDictation} disabled={!speechSupported || loading} aria-label={t(dictating ? 'chatStopDictation' : 'chatStartDictation')} aria-pressed={dictating} title={t(speechSupported ? (dictating ? 'chatStopDictation' : 'chatStartDictation') : 'chatVoiceUnavailable')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{dictating ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> : <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>}</svg>
            </button>
            <div style={{ flex: 1 }} />
            <button className="chat-send" type="button" aria-label={t('chatSendMessage')} onClick={() => { void sendMessage(); }} disabled={(!input.trim() && !attachment) || loading || imageLoading || dictating || waitingForAI}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
        </div>
        <div className="chat-media-note">{t(speechSupported ? 'chatMediaHint' : 'chatVoiceUnavailable')}</div>
      </div>

      <style>{`@keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }`}</style>
    </div>
  );
};
