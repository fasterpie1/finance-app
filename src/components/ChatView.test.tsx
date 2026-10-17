// @vitest-environment node
import React, { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantUniverse } from '../services/assistantContext';
import type { startSpeechInput } from '../services/speechInput';
import type { ChatImage } from '../services/statementFiles';
import { classifyGroqError, type GroqCallMetrics } from '../services/groq';
import { ChatView } from './ChatView';

// Harness de handlers sem React/DOM montado; efeitos e cleanups são simulados.
const hooks = vi.hoisted(() => ({
  index: 0, values: [] as unknown[], dirty: false, stateUpdates: 0,
  effects: new Map<number, { deps?: readonly unknown[]; cleanup?: () => void }>(),
  queued: [] as Array<() => void>,
}));
const mocks = vi.hoisted(() => ({
  send: vi.fn<(request: Record<string, unknown>, onMetrics?: (metrics: GroqCallMetrics) => void) => Promise<string>>(),
  status: vi.fn<() => Promise<boolean>>(), save: vi.fn(), delete: vi.fn(),
  read: vi.fn<(id: string | null, key: string) => string | null>(),
  write: vi.fn<(id: string | null, key: string, value: string) => void>(), remove: vi.fn(),
  prepare: vi.fn<(file: File) => Promise<ChatImage>>(),
  supported: vi.fn<() => boolean>(), speech: vi.fn<typeof startSpeechInput>(),
  locale: 'pt-BR',
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useState = <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.values[index], (next: T | ((previous: T) => T)) => {
      hooks.stateUpdates++;
      const previous = hooks.values[index] as T;
      const value = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
      if (!Object.is(previous, value)) { hooks.values[index] = value; hooks.dirty = true; }
    }] as const;
  };
  const useRef = <T,>(current: T) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = { current };
    return hooks.values[index];
  };
  const useEffect = (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = hooks.index++;
    const previous = hooks.effects.get(index);
    if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
      hooks.queued.push(() => {
        previous?.cleanup?.();
        hooks.effects.set(index, { deps, cleanup: effect() || undefined });
      });
    }
  };
  return { ...actual, default: { ...actual, useState, useRef, useEffect }, useState, useRef, useEffect };
});
vi.mock('../services/supabase', () => ({ supabase: null }));
vi.mock('../services/groq', async () => ({
  ...await vi.importActual<typeof import('../services/groq')>('../services/groq'),
  sendGroqChat: mocks.send, hasGroqKey: mocks.status, saveGroqKey: mocks.save, deleteGroqKey: mocks.delete,
}));
vi.mock('../services/userStorage', () => ({ readUserStorage: mocks.read, writeUserStorage: mocks.write, removeUserStorage: mocks.remove }));
vi.mock('../i18n', () => ({
  usePreferences: () => ({
    locale: mocks.locale,
    t: (key: string, params?: { name?: string; seconds?: number }) => params?.name ? `${key}: ${params.name}`
      : params?.seconds !== undefined ? `${key}: ${params.seconds}` : key,
  }),
}));
vi.mock('../services/assistantContext', () => ({
  buildAssistantDataSection: () => 'CONTEXTO FICTÍCIO', buildProtocolSection: () => 'PROTOCOLO FICTÍCIO',
  classifyAssistantIntents: () => ['general'],
  answerAssistantQuestion: (question: string) => question === 'Olá tudo bem?' ? 'assistantGreeting' : question === 'Como estou indo financeiramente este mês?' ? 'assistantMonthSummary' : null,
  monthLabel: () => 'Outubro 2026', resolveMonthRef: vi.fn(),
}));
vi.mock('../services/speechInput', () => ({ startSpeechInput: mocks.speech, supportsSpeechInput: mocks.supported }));
vi.mock('../services/statementFiles', () => ({ prepareChatImage: mocks.prepare }));

type Props = React.ComponentProps<typeof ChatView>;
type ElementProps = {
  children?: ReactNode; type?: string; className?: string; role?: string; title?: string;
  'aria-label'?: string; disabled?: boolean; readOnly?: boolean; value?: string; src?: string; text?: string;
  onClick?: () => unknown;
  onChange?: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
};
type Element = ReactElement<ElementProps>;
const photo: ChatImage = { name: 'recibo-ficticio.jpg', dataUrl: 'data:image/jpeg;base64,/9j/' };
const file = { name: photo.name, type: 'image/jpeg', size: 3 } as File;
const month = { id: 'mes-teste', name: 'Outubro', year: 2026, income: 0, bills: [] };
const universe: AssistantUniverse = {
  months: [month], selectedMonth: month, cards: [], categoryNames: [],
  categoryLabel: (category) => category, money: (amount) => String(amount),
  dashboard: { totalPlanned: 0, totalPaid: 0, remaining: 0 },
};
let props: Props;
let tree: ReactNode;
let voice: Parameters<typeof startSpeechInput>[1];
let session: { stop: ReturnType<typeof vi.fn<() => void>>; abort: ReturnType<typeof vi.fn<() => void>> };
let forbidden: ReturnType<typeof vi.fn>;

function render(changes: Partial<Props> = {}) {
  props = { ...props, ...changes };
  for (let passes = 0; passes < 20; passes++) {
    hooks.index = 0;
    hooks.dirty = false;
    const result = ChatView(props);
    if (result instanceof Promise) throw new Error('O harness exige um componente síncrono');
    tree = result;
    hooks.queued.splice(0).forEach((effect) => effect());
    if (!hooks.dirty) return;
  }
  throw new Error('O harness não estabilizou');
}
function unmount() {
  hooks.effects.forEach((effect) => effect.cleanup?.());
  hooks.effects.clear();
  hooks.queued.length = 0;
}
function elements(node: ReactNode = tree): Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child ?? null));
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children ?? null)];
}
function find(predicate: (node: Element) => boolean) {
  const matches = elements().filter(predicate);
  expect(matches).toHaveLength(1);
  return matches[0];
}
const button = (label: string) => find((node) => node.type === 'button' && (node.props['aria-label'] === label || node.props.children === label));
const textarea = () => find((node) => node.type === 'textarea');
const previews = () => elements().filter((node) => node.props.className === 'chat-photo-preview');
const alerts = () => elements().filter((node) => node.props.role === 'alert');
function click(label: string) { button(label).props.onClick!(); render(); }
function type(text: string) {
  textarea().props.onChange!({ target: { value: text } } as React.ChangeEvent<HTMLTextAreaElement>);
  render();
}
function select(selected = file) {
  const currentTarget = { files: [selected], value: 'arquivo-ficticio' };
  find((node) => node.type === 'input' && node.props.type === 'file').props.onChange!({ currentTarget } as unknown as React.ChangeEvent<HTMLInputElement>);
  render();
  return currentTarget;
}
async function settle(renderAfter = true) {
  // Drena apenas as promises dos mocks; não remonta ao observar callbacks após unmount.
  for (let i = 0; i < 6; i++) await Promise.resolve();
  if (renderAfter) render();
}
async function attach() { select(); await settle(); }
async function send() { click('chatSendMessage'); await settle(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  hooks.index = 0; hooks.values = []; hooks.dirty = false; hooks.stateUpdates = 0; hooks.effects.clear(); hooks.queued = [];
  mocks.locale = 'pt-BR';
  mocks.read.mockImplementation((_id, key) => key === 'groq_configured' ? 'true' : null);
  mocks.status.mockResolvedValue(true);
  mocks.send.mockResolvedValue('{"action":"none","response":"Análise fictícia"}');
  mocks.prepare.mockResolvedValue(photo);
  mocks.supported.mockReturnValue(true);
  mocks.speech.mockImplementation((_locale, callbacks) => {
    let aborted = false;
    // Contrato mockado do adapter: abort silencia callbacks; stop admite resultado final.
    voice = {
      onTranscript: (text) => { if (!aborted) callbacks.onTranscript(text); },
      onEnd: () => { if (!aborted) callbacks.onEnd(); },
      onError: (error) => { if (!aborted) callbacks.onError(error); },
    };
    session = { stop: vi.fn(), abort: vi.fn(() => { aborted = true; }) };
    return session;
  });
  forbidden = vi.fn(() => { throw new Error('API real proibida neste teste'); });
  vi.useFakeTimers();
  vi.stubGlobal('window', { setInterval, clearInterval });
  vi.stubGlobal('fetch', forbidden);
  const storage = { getItem: forbidden, setItem: forbidden, removeItem: forbidden, clear: forbidden };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: forbidden } });
  props = {
    universe, userId: 'usuario-ficticio', isActive: true, onCommand: vi.fn(),
    calendarActions: {
      createBillReminder: vi.fn(), createInvoiceReminder: vi.fn(), listEvents: vi.fn(),
      createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(),
    },
  };
  render();
});
afterEach(() => {
  unmount();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  expect(forbidden).not.toHaveBeenCalled();
});

describe('foto no ChatView', () => {
  it('prepara e mostra a foto sem enviar; permite remover o anexo pronto', async () => {
    const target = select();
    expect(target.value).toBe('');
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(file);
    expect(button('chatSendMessage').props.disabled).toBe(true);
    await settle();
    expect(find((node) => node.type === 'img').props.src).toBe(photo.dataUrl);
    expect(button('chatSendMessage').props.disabled).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    click('chatRemovePhoto');
    expect(previews()).toHaveLength(0);
    expect(button('chatSendMessage').props.disabled).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(['Como isto se compara ao meu mês?', ''])('envia visão com pergunta ou análise default: %j', async (question) => {
    await attach();
    type(question);
    await send();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen/qwen3.8-27b', max_tokens: 900, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: expect.stringContaining('CONTEXTO FICTÍCIO') },
        { role: 'user', content: [
          { type: 'text', text: `${question || 'chatDescribePhoto'}\nchatPhotoLabel: ${photo.name}` },
          { type: 'image_url', image_url: { url: photo.dataUrl } },
        ] },
      ],
    }), expect.any(Function));
    expect(previews()).toHaveLength(0);
    expect(textarea().props.value).toBe('');
    expect(find((node) => node.props.text === 'Análise fictícia')).toBeDefined();
  });

  it('salva apenas texto/nome da foto e não reenvia base64 no próximo turno', async () => {
    await attach(); type('Compare a foto'); await send();
    const saved = mocks.write.mock.calls.filter(([, key]) => key === 'finance_chat_history');
    expect(saved.length).toBeGreaterThan(0);
    for (const [id, , value] of saved) {
      expect(id).toBe('usuario-ficticio');
      expect(value).not.toMatch(/base64|data:image|image_url|dataUrl/);
    }
    expect(JSON.parse(saved.at(-1)![2])).toEqual([
      { role: 'user', content: 'Compare a foto', photoName: photo.name },
      { role: 'assistant', content: 'Análise fictícia' },
    ]);
    type('Explique melhor'); await send();
    const followUp = mocks.send.mock.calls[1][0];
    expect(followUp.model).toBe('qwen/qwen3.8-27b');
    expect(JSON.stringify(followUp)).not.toMatch(/base64|image_url/);
    expect(followUp.messages).toEqual(expect.arrayContaining([
      { role: 'user', content: `Compare a foto\nchatPhotoLabel: ${photo.name}` },
    ]));
  });

  it.each(['resultado', 'erro'])('cancelar preparação ignora %s tardio e bloqueia envio enquanto prepara', async (late) => {
    const preparation = deferred<ChatImage>();
    mocks.prepare.mockReturnValueOnce(preparation.promise);
    select(); type('Pergunta');
    expect(button('chatSendMessage').props.disabled).toBe(true);
    click('chatSendMessage'); // Invocação direta também verifica o guard do handler.
    expect(mocks.send).not.toHaveBeenCalled();
    click('chatRemovePhoto');
    if (late === 'resultado') preparation.resolve(photo);
    else preparation.reject(new Error('chatPhotoInvalid'));
    await settle();
    expect(previews()).toHaveLength(0);
    expect(alerts()).toHaveLength(0);
    expect(textarea().props.value).toBe('Pergunta');
    expect(button('chatSendMessage').props.disabled).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('uma seleção mais recente não é substituída pela preparação antiga', async () => {
    const old = deferred<ChatImage>();
    const newer = { name: 'nova-ficticia.png', dataUrl: 'data:image/png;base64,YQ==' };
    mocks.prepare.mockReturnValueOnce(old.promise).mockResolvedValueOnce(newer);
    select(); select({ name: newer.name } as File); await settle();
    old.resolve(photo); await settle();
    expect(find((node) => node.type === 'img').props.src).toBe(newer.dataUrl);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('mostra erro de preparação sem anexar ou enviar', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('chatPhotoInvalid'));
    select(); await settle();
    expect(alerts().map((node) => node.props.children)).toEqual(['chatPhotoInvalid']);
    expect(previews()).toHaveLength(0);
    expect(button('chatSendMessage').props.disabled).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('erro no envio reanexa a foto e restaura a pergunta para tentar novamente', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Falha fictícia'));
    await attach(); type('Compare esta foto'); await send();
    expect(find((node) => node.type === 'img').props.src).toBe(photo.dataUrl);
    expect(textarea().props.value).toBe('Compare esta foto');
    expect(button('chatSendMessage').props.disabled).toBe(false);
    expect(find((node) => node.props.className === 'theme-ai-message theme-ai-message-error').props.children).toContain('chatRequestError');
    await send();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(previews()).toHaveLength(0);
  });

  it.each(['create_bill_reminder', 'create_invoice_reminder', 'list_events', 'create_event', 'update_event', 'delete_event'])('foto nunca executa calendarActions: %s', async (action) => {
    mocks.send.mockResolvedValueOnce(JSON.stringify({
      action, billName: 'Conta fictícia', title: 'Evento fictício', date: '2026-10-01', time: '09:00', query: 'Evento fictício', eventId: 'evento-teste',
    }));
    await attach(); type('Analise a foto'); await send();
    for (const handler of Object.values(props.calendarActions!)) expect(handler).not.toHaveBeenCalled();
    expect(props.onCommand).not.toHaveBeenCalled();
    expect(find((node) => node.props.text === 'chatPhotoCalendar')).toBeDefined();
    expect(JSON.stringify(mocks.send.mock.calls[0][0])).not.toContain('Ações disponíveis:');
  });

  it('pedido financeiro com foto cria somente prévia, sem executar apply', async () => {
    const apply = vi.fn(() => 'Aplicado');
    const command = { action: 'add_purchase', name: 'Compra fictícia', amount: 12, response: 'Revise a compra' };
    const onCommand = vi.fn(() => ({ kind: 'plan' as const, summary: ['Adicionar compra de 12'], apply }));
    render({ onCommand });
    mocks.send.mockResolvedValueOnce(JSON.stringify(command));
    await attach(); type('Cadastre a compra da foto'); await send();
    expect(onCommand).toHaveBeenCalledExactlyOnceWith(command);
    expect(find((node) => node.props.className === 'chat-pending-change')).toBeDefined();
    expect(find((node) => node.type === 'li' && node.props.children === 'Adicionar compra de 12')).toBeDefined();
    expect(button('assistantApply')).toBeDefined();
    expect(apply).not.toHaveBeenCalled();
    click('assistantCancel');
    expect(elements().some((node) => node.props.className === 'chat-pending-change')).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('ditado no ChatView', () => {
  it('acrescenta texto sem autoenviar e bloqueia Enviar/Enter durante o ditado', async () => {
    type('Texto anterior'); click('chatStartDictation');
    expect(mocks.speech).toHaveBeenCalledWith('pt-BR', expect.any(Object));
    voice.onTranscript('mais palavras'); render();
    voice.onTranscript('e outras'); render();
    expect(textarea().props.value).toBe('Texto anterior mais palavras e outras');
    expect(textarea().props.readOnly).toBe(true);
    expect(button('chatSendMessage').props.disabled).toBe(true);
    click('chatSendMessage');
    const preventDefault = vi.fn();
    textarea().props.onKeyDown!({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault } as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
    await settle();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('Parar preserva o texto e aceita callback final antes de liberar a edição', async () => {
    type('Antes'); click('chatStartDictation');
    voice.onTranscript('durante'); render();
    click('chatStopDictation');
    expect(session.stop).toHaveBeenCalledOnce();
    expect(session.abort).not.toHaveBeenCalled();
    expect(textarea().props.value).toBe('Antes durante');
    expect(textarea().props.readOnly).toBe(true);
    voice.onTranscript('final'); voice.onEnd(); render();
    expect(session.abort).toHaveBeenCalledOnce();
    expect(textarea().props.value).toBe('Antes durante final');
    expect(textarea().props.readOnly).toBe(false);
    expect(button('chatSendMessage').props.disabled).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    await send();
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen/qwen3.8-27b', messages: expect.arrayContaining([{ role: 'user', content: 'Antes durante final' }]),
    }), expect.any(Function));
  });

  it('Cancelar aborta e restaura exatamente o texto anterior', () => {
    type('Antes com espaço '); click('chatStartDictation');
    voice.onTranscript('descartar'); render();
    expect(textarea().props.value).toBe('Antes com espaço descartar');
    click('chatCancelDictation');
    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.stop).not.toHaveBeenCalled();
    voice.onTranscript('tardio'); voice.onEnd(); render();
    expect(textarea().props.value).toBe('Antes com espaço ');
    expect(textarea().props.readOnly).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(['isActive', 'locale', 'unmount'])('cleanup aborta na mudança de %s', (change) => {
    type('Texto'); click('chatStartDictation');
    voice.onTranscript('preservado'); render();
    expect(session.abort).not.toHaveBeenCalled(); // Rerender com mesmas dependências não limpa.
    if (change === 'unmount') unmount();
    else if (change === 'isActive') render({ isActive: false });
    else { mocks.locale = 'en'; render(); }
    expect(session.abort).toHaveBeenCalledOnce();
    if (change !== 'unmount') {
      expect(textarea().props.readOnly).toBe(false);
      expect(textarea().props.value).toBe('Texto preservado');
      click('chatStartDictation');
      if (change === 'isActive') expect(mocks.speech).toHaveBeenCalledOnce();
      else expect(mocks.speech).toHaveBeenLastCalledWith('en', expect.any(Object));
    }
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each(['not-allowed', 'service-not-allowed'])('permissão negada (%s) exibe erro sem perder texto', (error) => {
    type('Rascunho'); click('chatStartDictation');
    voice.onError(error); render();
    expect(alerts().map((node) => node.props.children)).toEqual(['chatVoiceDenied']);
    expect(session.abort).toHaveBeenCalledOnce();
    expect(textarea().props.value).toBe('Rascunho');
    expect(textarea().props.readOnly).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('indisponibilidade desabilita microfone e o handler não inicia ditado', () => {
    mocks.supported.mockReturnValue(false); render();
    expect(button('chatStartDictation').props.disabled).toBe(true);
    expect(button('chatStartDictation').props.title).toBe('chatVoiceUnavailable');
    click('chatStartDictation');
    expect(mocks.speech).not.toHaveBeenCalled();
    expect(textarea().props.readOnly).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('envio e parser no ChatView', () => {
  const errorTexts = () => elements()
    .filter((node) => node.props.className === 'theme-ai-message theme-ai-message-error')
    .map((node) => React.Children.toArray(node.props.children).filter((child) => typeof child === 'string').join(''));
  const assistantTexts = () => elements().filter((node) => typeof node.props.text === 'string').map((node) => node.props.text);
  const responding = () => elements().filter((node) => node.props.className === 'chat-typing');
  const countdown = () => elements().filter((node) => node.props.role === 'status' && node.props.className === 'chat-media-note');
  const suggestions = () => elements().filter((node) => node.props.className === 'theme-ai-suggestion');
  const clear = () => {
    find((node) => node.type === 'button' && node.props.title === 'clearConversation').props.onClick!();
    render();
  };

  it('botão e Enter do mesmo render fazem só uma chamada; sucesso libera o próximo envio', async () => {
    const first = deferred<string>();
    mocks.send.mockReturnValueOnce(first.promise);
    type('Primeira pergunta fictícia');
    const submit = button('chatSendMessage').props.onClick!;
    const enter = textarea().props.onKeyDown!;
    const preventDefault = vi.fn();
    submit();
    enter({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault } as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    render();
    expect(responding()).toHaveLength(1);
    expect(button('chatSendMessage').props.disabled).toBe(true);
    first.resolve('{"action":"none","response":"Primeira resposta fictícia"}');
    await settle();
    expect(responding()).toHaveLength(0);
    expect(assistantTexts()).toEqual(['Primeira resposta fictícia']);
    type('Segunda pergunta fictícia');
    expect(button('chatSendMessage').props.disabled).toBe(false);
    await send();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(assistantTexts()).toEqual(['Primeira resposta fictícia', 'Análise fictícia']);
  });

  it('tenta uma vez em texto estrito se Groq rejeitar o modo JSON', async () => {
    mocks.send.mockRejectedValueOnce(classifyGroqError('Failed to generate JSON. Please adjust your prompt.', 400));
    type('Explique meus gastos'); await send();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[0][0].response_format).toEqual({ type: 'json_object' });
    expect(mocks.send.mock.calls[1][0].response_format).toEqual({ type: 'text' });
    expect((mocks.send.mock.calls[1][0].messages as Array<{ content: string }>)[0].content).toContain('formatação JSON do provedor falhou');
    expect(assistantTexts()).toEqual(['Análise fictícia']);
  });

  it('falha libera a trava e restaura a pergunta quando o campo segue vazio', async () => {
    const first = deferred<string>();
    mocks.send.mockReturnValueOnce(first.promise);
    type('  Pergunta para tentar novamente  '); click('chatSendMessage');
    expect(textarea().props.value).toBe('');
    expect(responding()).toHaveLength(1);
    first.reject(new Error('Falha técnica fictícia'));
    await settle();
    expect(textarea().props.value).toBe('Pergunta para tentar novamente');
    expect(errorTexts()).toEqual(['chatRequestError']);
    expect(responding()).toHaveLength(0);
    expect(button('chatSendMessage').props.disabled).toBe(false);
    await send();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(assistantTexts()).toEqual(['Análise fictícia']);
  });

  it('erro tardio preserva exatamente o novo rascunho, sem restaurar a pergunta por cima', async () => {
    const request = deferred<string>();
    mocks.send.mockReturnValueOnce(request.promise);
    type('Pergunta enviada'); click('chatSendMessage');
    type('  Novo rascunho ainda não enviado  ');
    request.reject(new Error('Failed to fetch: detalhe fictício'));
    await settle();
    expect(textarea().props.value).toBe('  Novo rascunho ainda não enviado  ');
    expect(errorTexts()).toEqual(['chatNetworkError']);
    expect(button('chatSendMessage').props.disabled).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it.each(['resposta', 'erro'])('clearChat ignora %s antiga sem liberar loading/trava do novo pedido', async (late) => {
    await settle();
    const old = deferred<string>();
    const current = deferred<string>();
    mocks.send.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    type('Pedido antigo'); click('chatSendMessage');
    clear();
    expect(mocks.remove).toHaveBeenCalledWith('usuario-ficticio', 'finance_chat_history');
    expect(responding()).toHaveLength(0);
    expect(suggestions()).toHaveLength(6);
    type('Pedido novo'); click('chatSendMessage');
    type('Rascunho enquanto aguarda');
    const updates = hooks.stateUpdates;
    if (late === 'resposta') old.resolve('{"action":"add_purchase","name":"Compra antiga","amount":1,"response":"Resposta antiga"}');
    else old.reject(classifyGroqError('HTTP 429 fictício antigo', 429, '120'));
    await settle(false);
    expect(hooks.stateUpdates).toBe(updates);
    render();
    expect(props.onCommand).not.toHaveBeenCalled();
    expect(assistantTexts()).toEqual([]);
    expect(errorTexts()).toEqual([]);
    expect(countdown()).toHaveLength(0);
    expect(responding()).toHaveLength(1);
    expect(textarea().props.value).toBe('Rascunho enquanto aguarda');
    expect(button('chatSendMessage').props.disabled).toBe(true);
    click('chatSendMessage');
    expect(mocks.send).toHaveBeenCalledTimes(2);
    current.resolve('{"action":"none","response":"Resposta do novo pedido"}');
    await settle();
    expect(assistantTexts()).toEqual(['Resposta do novo pedido']);
    expect(responding()).toHaveLength(0);
    expect(button('chatSendMessage').props.disabled).toBe(false);
    await send();
    expect(mocks.send).toHaveBeenCalledTimes(3);
  });

  it.each(['resposta', 'erro'])('unmount ignora %s tardia sem chamar setters, onCommand ou persistência', async (late) => {
    await settle();
    const request = deferred<string>();
    mocks.send.mockReturnValueOnce(request.promise);
    type('Pedido antes de desmontar'); click('chatSendMessage');
    expect(responding()).toHaveLength(1);
    unmount();
    const updates = hooks.stateUpdates;
    const writes = mocks.write.mock.calls.length;
    if (late === 'resposta') request.resolve('{"action":"add_purchase","name":"Compra tardia","amount":1,"response":"Resposta tardia"}');
    else request.reject(classifyGroqError('HTTP 429 fictício após unmount', 429, '120'));
    await settle(false);
    expect(hooks.stateUpdates).toBe(updates);
    expect(mocks.write).toHaveBeenCalledTimes(writes);
    expect(props.onCommand).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['format', 'json_validate_failed: conteúdo técnico fictício', 'chatFormatError'],
    ['network', 'Failed to fetch: diagnóstico fictício', 'chatNetworkError'],
    ['session', 'jwt expired: diagnóstico fictício', 'sessionExpiredAssistant'],
    ['request', 'Falha interna fictícia não classificada', 'chatRequestError'],
  ])('erro %s mostra apenas mensagem amigável, nunca o texto cru', async (_kind, raw, friendly) => {
    mocks.send.mockRejectedValueOnce(new Error(raw));
    type('Pergunta fictícia'); await send();
    expect(errorTexts()).toEqual([friendly]);
    expect(assistantTexts()).toEqual([]);
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain(raw);
    expect(props.onCommand).not.toHaveBeenCalled();
    expect(responding()).toHaveLength(0);
  });

  it('não mostra texto livre do modelo quando o protocolo exige JSON', async () => {
    mocks.send.mockResolvedValueOnce('Posso ajudar. All actions via the defined JSON interface.');
    type('O que você consegue fazer?'); await send();
    expect(errorTexts()).toEqual(['chatFormatError']);
    expect(assistantTexts()).toEqual([]);
    expect(props.onCommand).not.toHaveBeenCalled();
  });

  it('429 conta até o deadline, bloqueia handlers diretos e só reenvia por ação explícita', async () => {
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    mocks.send.mockRejectedValueOnce(classifyGroqError('HTTP 429 técnico fictício', 429, '3'));
    type('Consulta fictícia à IA'); await send();
    expect(errorTexts()).toEqual(['chatRateLimited']);
    expect(textarea().props.value).toBe('Consulta fictícia à IA');
    expect(countdown().map((node) => node.props.children)).toEqual(['chatRetryCountdown: 3']);
    expect(button('chatSendMessage').props.disabled).toBe(true);
    const retry = button('chatSendMessage').props.onClick!;
    retry(); render();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); render();
    expect(countdown().map((node) => node.props.children)).toEqual(['chatRetryCountdown: 2']);
    vi.advanceTimersByTime(1999); render();
    expect(countdown().map((node) => node.props.children)).toEqual(['chatRetryCountdown: 1']);
    expect(button('chatSendMessage').props.disabled).toBe(true);
    retry();
    const preventDefault = vi.fn();
    textarea().props.onKeyDown!({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault } as unknown as React.KeyboardEvent<HTMLTextAreaElement>);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); await settle();
    expect(countdown()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(button('chatSendMessage').props.disabled).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    retry(); await settle();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(assistantTexts()).toEqual(['Análise fictícia']);
    vi.advanceTimersByTime(30000); await settle();
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('saudação e resumo locais continuam disponíveis durante limite, sem consultar IA', async () => {
    mocks.send.mockRejectedValueOnce(classifyGroqError('HTTP 429 fictício', 429, '60'));
    type('Consulta remota fictícia'); await send();
    for (const [question, answer] of [
      ['Olá tudo bem?', 'assistantGreeting'],
      ['Como estou indo financeiramente este mês?', 'assistantMonthSummary'],
    ]) {
      type(question);
      expect(button('chatSendMessage').props.disabled).toBe(false);
      await send();
      expect(assistantTexts()).toContain(answer);
      expect(textarea().props.value).toBe('');
      expect(responding()).toHaveLength(0);
      expect(mocks.send).toHaveBeenCalledTimes(1);
      expect(countdown().map((node) => node.props.children)).toEqual(['chatRetryCountdown: 60']);
    }
    type('Outra consulta remota fictícia');
    expect(button('chatSendMessage').props.disabled).toBe(true);
    click('chatSendMessage');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(props.onCommand).not.toHaveBeenCalled();
  });

  it('saudação em conversa vazia responde localmente e não usa IA nem onCommand', async () => {
    type('Olá tudo bem?'); await send();
    expect(assistantTexts()).toEqual(['assistantGreeting']);
    expect(textarea().props.value).toBe('');
    expect(suggestions()).toHaveLength(0);
    expect(responding()).toHaveLength(0);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(props.onCommand).not.toHaveBeenCalled();
  });

  it('próximo envio exclui pergunta falha e erro do histórico, preservando os turnos bem-sucedidos', async () => {
    type('Pergunta bem-sucedida'); await send();
    mocks.send.mockRejectedValueOnce(new Error('Falha fictícia do segundo turno'));
    type('Pergunta que falhou'); await send();
    expect(errorTexts()).toEqual(['chatRequestError']);
    type('Nova pergunta'); await send();
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(mocks.send.mock.calls[2][0].messages).toEqual([
      { role: 'system', content: expect.stringContaining('CONTEXTO FICTÍCIO') },
      { role: 'user', content: 'Pergunta bem-sucedida' },
      { role: 'assistant', content: 'Análise fictícia' },
      { role: 'user', content: 'Nova pergunta' },
    ]);
    expect(errorTexts()).toEqual(['chatRequestError']); // Continua visível, mas não vira contexto da IA.
  });

  it.each([
    ['array', [JSON.stringify([{ action: 'add_purchase', name: 'Compra fictícia', amount: 1 }])]],
    ['response objeto', [JSON.stringify({ action: 'add_purchase', response: { text: 'Não executar' }, amount: 1 })]],
    ['scope malformado', [null, [], 'todos', 1,
      { category: 1 }, { card: {} }, { owner: [] }, { merchant: false },
      { withoutCard: 'true' }, { unclassifiedCategory: 0 }, { day: '1' }, { day: null },
    ].map((scope) => JSON.stringify({ action: 'categorize_transactions', scope, response: 'Não executar' }))],
  ] as const)('%s nunca chega a onCommand e produz erro de formato', async (_label, payloads) => {
    for (const payload of payloads) {
      mocks.send.mockResolvedValueOnce(payload);
      type('Pedido fictício de alteração'); await send();
      expect(props.onCommand).not.toHaveBeenCalled();
      for (const handler of Object.values(props.calendarActions!)) expect(handler).not.toHaveBeenCalled();
      expect(errorTexts()).toEqual(['chatFormatError']);
      expect(assistantTexts()).toEqual([]);
      expect(elements().some((node) => node.props.className === 'chat-pending-change')).toBe(false);
      expect(textarea().props.value).toBe('Pedido fictício de alteração');
      expect(responding()).toHaveLength(0);
      clear();
    }
    expect(mocks.send).toHaveBeenCalledTimes(payloads.length);
  });

  it('aceita JSON válido em Markdown fenced e entrega apenas o comando validado', async () => {
    const command = {
      action: 'categorize_transactions', response: 'Comando fictício válido',
      scope: { category: 'Categoria fictícia', withoutCard: true, unclassifiedCategory: false, day: 1 },
    };
    const onCommand = vi.fn(() => ({ kind: 'answer' as const, text: 'Resposta do comando fictício' }));
    render({ onCommand });
    mocks.send.mockResolvedValueOnce(`\`\`\`json\n${JSON.stringify(command)}\n\`\`\``);
    type('Pedido fictício com JSON fenced'); await send();
    expect(onCommand).toHaveBeenCalledExactlyOnceWith(command);
    expect(assistantTexts()).toEqual(['Resposta do comando fictício']);
    expect(errorTexts()).toEqual([]);
    expect(responding()).toHaveLength(0);
  });

  it('atalhos só aparecem na conversa vazia, enviam o texto completo e mantêm o mês visível', async () => {
    const headerMonth = () => find((node) => node.props.className === 'chat-model-label' && node.props.title === 'chatModelLabel');
    expect(headerMonth().props.children).toBe('Outubro 2026');
    expect(suggestions().map((node) => node.props.children)).toEqual([
      'suggestion1Short', 'suggestion2Short', 'suggestion3Short',
      'suggestion4Short', 'suggestion5Short', 'suggestion6Short',
    ]);
    expect(suggestions().every((node) => node.props.disabled === false)).toBe(true);
    suggestions()[2].props.onClick!(); render(); await settle();
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        { role: 'system', content: expect.stringContaining('CONTEXTO FICTÍCIO') },
        { role: 'user', content: 'suggestion3' },
      ],
    }), expect.any(Function));
    expect(suggestions()).toHaveLength(0);
    expect(headerMonth().props.children).toBe('Outubro 2026');
    clear();
    expect(suggestions()).toHaveLength(6);
    expect(headerMonth().props.children).toBe('Outubro 2026');
    type('Olá tudo bem?'); await send();
    expect(suggestions()).toHaveLength(0);
    expect(headerMonth().props.children).toBe('Outubro 2026');
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
