import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSpeechInput, supportsSpeechInput } from './speechInput';

type Result = { isFinal: boolean; [index: number]: { transcript: string } };
type ResultEvent = { resultIndex: number; results: Result[] };

class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  static constructed = vi.fn();
  static startError: Error | undefined;

  lang = '';
  continuous = false;
  interimResults = true;
  maxAlternatives = 0;
  onresult: ((event: ResultEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  start = vi.fn(() => {
    if (FakeRecognizer.startError) throw FakeRecognizer.startError;
  });
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeRecognizer.instances.push(this);
    FakeRecognizer.constructed();
  }
}

const result = (transcript: string, isFinal = true): Result => ({
  isFinal,
  0: { transcript },
});

function makeCallbacks() {
  return { onTranscript: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
}

function setup(locale = 'pt-BR') {
  const callbacks = makeCallbacks();
  const controls = startSpeechInput(locale, callbacks);
  const recognition = FakeRecognizer.instances[0];
  return { callbacks, controls, recognition };
}

beforeEach(() => {
  FakeRecognizer.instances = [];
  FakeRecognizer.constructed.mockClear();
  FakeRecognizer.startError = undefined;
  vi.stubGlobal('window', { isSecureContext: true, SpeechRecognition: FakeRecognizer });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('supportsSpeechInput', () => {
  it('não instancia nem inicia reconhecimento no import ou na verificação', async () => {
    vi.resetModules();
    const service = await import('./speechInput');
    expect(service.supportsSpeechInput()).toBe(true);
    expect(service.supportsSpeechInput()).toBe(true);
    expect(FakeRecognizer.constructed).not.toHaveBeenCalled();
    expect(FakeRecognizer.instances).toHaveLength(0);
  });

  it('aceita constructor prefixado em contexto seguro', () => {
    vi.stubGlobal('window', { isSecureContext: true, webkitSpeechRecognition: FakeRecognizer });
    expect(supportsSpeechInput()).toBe(true);
    expect(FakeRecognizer.constructed).not.toHaveBeenCalled();
  });

  it.each([
    ['sem window', undefined],
    ['sem constructor', { isSecureContext: true }],
    ['contexto inseguro', { isSecureContext: false, SpeechRecognition: FakeRecognizer }],
    ['prefixo em contexto inseguro', { isSecureContext: false, webkitSpeechRecognition: FakeRecognizer }],
    ['sem contexto seguro explícito', { SpeechRecognition: FakeRecognizer }],
  ])('recusa %s e lança erro síncrono ao iniciar', (_name, speechWindow) => {
    vi.stubGlobal('window', speechWindow);
    expect(supportsSpeechInput()).toBe(false);
    expect(() => startSpeechInput('pt-BR', makeCallbacks())).toThrow('Speech input is not supported');
    expect(FakeRecognizer.constructed).not.toHaveBeenCalled();
  });
});

describe('startSpeechInput', () => {
  it.each([
    ['en', 'en-US'],
    ['pt-BR', 'pt-BR'],
    ['en-GB', 'en-GB'],
  ])('configura idioma %s como %s e flags antes de iniciar', (locale, expectedLanguage) => {
    const { recognition } = setup(locale);
    expect(recognition.lang).toBe(expectedLanguage);
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(false);
    expect(recognition.maxAlternatives).toBe(1);
    expect(recognition.start).toHaveBeenCalledExactlyOnceWith();
    expect(recognition.onresult).toEqual(expect.any(Function));
    expect(recognition.onend).toEqual(expect.any(Function));
    expect(recognition.onerror).toEqual(expect.any(Function));
  });

  it('inicia com constructor prefixado', () => {
    vi.stubGlobal('window', { isSecureContext: true, webkitSpeechRecognition: FakeRecognizer });
    const { recognition } = setup();
    expect(recognition.start).toHaveBeenCalledExactlyOnceWith();
  });

  it('prefere constructor não prefixado quando ambos existem', () => {
    const prefixedConstructor = vi.fn();
    vi.stubGlobal('window', {
      isSecureContext: true,
      SpeechRecognition: FakeRecognizer,
      webkitSpeechRecognition: prefixedConstructor,
    });
    setup();
    expect(FakeRecognizer.constructed).toHaveBeenCalledExactlyOnceWith();
    expect(prefixedConstructor).not.toHaveBeenCalled();
  });

  it('entrega somente textos finais novos em dois eventos acumulados', () => {
    const { recognition, callbacks } = setup();
    recognition.onresult?.({ resultIndex: 0, results: [result(' texto de teste ')] });
    recognition.onresult?.({
      resultIndex: 0,
      results: [result(' texto de teste '), result(''), result('   '), result(' segunda parte '), result(' final ')],
    });
    expect(callbacks.onTranscript.mock.calls).toEqual([['texto de teste'], ['segunda parte final']]);
  });

  it('lê somente a partir de resultIndex', () => {
    const { recognition, callbacks } = setup();
    recognition.onresult?.({ resultIndex: 1, results: [result('ignorado'), result('novo texto')] });
    expect(callbacks.onTranscript).toHaveBeenCalledExactlyOnceWith('novo texto');
  });

  it('ignora interim e aceita sua finalização posterior no mesmo índice', () => {
    const { recognition, callbacks } = setup();
    recognition.onresult?.({ resultIndex: 0, results: [result('rascunho', false)] });
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    recognition.onresult?.({ resultIndex: 0, results: [result('texto final')] });
    expect(callbacks.onTranscript).toHaveBeenCalledExactlyOnceWith('texto final');
  });

  it('não entrega evento composto somente de finais vazios', () => {
    const { recognition, callbacks } = setup();
    recognition.onresult?.({ resultIndex: 0, results: [result(''), result('   ')] });
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });

  it('stop solicita último resultado mantendo callbacks até onend', () => {
    const { recognition, callbacks, controls } = setup();
    controls.stop();
    expect(recognition.stop).toHaveBeenCalledExactlyOnceWith();
    expect(recognition.abort).not.toHaveBeenCalled();
    recognition.onresult?.({ resultIndex: 0, results: [result('último texto')] });
    recognition.onend?.();
    expect(callbacks.onTranscript).toHaveBeenCalledExactlyOnceWith('último texto');
    expect(callbacks.onEnd).toHaveBeenCalledExactlyOnceWith();
    expect(recognition.start).toHaveBeenCalledTimes(1);
  });

  it('abort desconecta antes de abortar, bloqueia callbacks tardios e é idempotente', () => {
    const { recognition, callbacks, controls } = setup();
    const lateResult = recognition.onresult;
    const lateEnd = recognition.onend;
    const lateError = recognition.onerror;
    recognition.abort.mockImplementation(() => {
      expect(recognition.onresult).toBeNull();
      expect(recognition.onend).toBeNull();
      expect(recognition.onerror).toBeNull();
      lateResult?.({ resultIndex: 0, results: [result('síncrono após abort')] });
      lateEnd?.();
      lateError?.({ error: 'aborted' });
    });
    controls.abort();
    lateResult?.({ resultIndex: 0, results: [result('tardio')] });
    lateEnd?.();
    lateError?.({ error: 'not-allowed' });
    controls.abort();
    controls.stop();
    expect(recognition.abort).toHaveBeenCalledExactlyOnceWith();
    expect(recognition.stop).not.toHaveBeenCalled();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('repassa permissão negada em onError sem reiniciar', () => {
    const { recognition, callbacks } = setup();
    recognition.onerror?.({ error: 'not-allowed' });
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith('not-allowed');
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    expect(recognition.start).toHaveBeenCalledTimes(1);
  });

  it('onend notifica o consumidor sem reinício automático', () => {
    const { recognition, callbacks } = setup();
    recognition.onend?.();
    expect(callbacks.onEnd).toHaveBeenCalledExactlyOnceWith();
    expect(recognition.start).toHaveBeenCalledTimes(1);
  });

  it('propaga exatamente o erro síncrono de start', () => {
    const error = new Error('synthetic start failure');
    FakeRecognizer.startError = error;
    const callbacks = makeCallbacks();
    let thrown: unknown;
    try {
      startSpeechInput('pt-BR', callbacks);
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBe(error);
    expect(FakeRecognizer.instances[0].start).toHaveBeenCalledExactlyOnceWith();
    expect(FakeRecognizer.instances[0].onresult).toBeNull();
    expect(FakeRecognizer.instances[0].onend).toBeNull();
    expect(FakeRecognizer.instances[0].onerror).toBeNull();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
