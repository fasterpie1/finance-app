import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppUpdate, watchAppUpdate } from './appVersion';

declare const __APP_VERSION__: string;

const fetchMock = vi.fn<typeof fetch>();
const timestamp = 1_800_000_000_000;

function response(payload: unknown, ok = true): Response {
  return { ok, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeDocument() {
  const target = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.spyOn(target, 'addEventListener');
  vi.spyOn(target, 'removeEventListener');
  return target;
}

function makeWindow() {
  const target = Object.assign(new EventTarget(), {
    setInterval: vi.fn((handler: () => void, delay: number) => setInterval(handler, delay)),
    clearInterval: vi.fn((handle: ReturnType<typeof setInterval>) => clearInterval(handle)),
    location: { reload: vi.fn() },
  });
  vi.spyOn(target, 'addEventListener');
  vi.spyOn(target, 'removeEventListener');
  return target;
}

const storage = {
  getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(),
};
let documentMock: ReturnType<typeof makeDocument>;
let windowMock: ReturnType<typeof makeWindow>;
let cleanups: Array<() => void>;

function watch(callback = vi.fn<(version: string) => void>()) {
  const cleanup = watchAppUpdate(callback);
  cleanups.push(cleanup);
  return { callback, cleanup };
}

async function flushChecks() {
  // Drain fetch, JSON and watcher continuations without advancing the polling clock.
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(timestamp);
  vi.stubEnv('DEV', false);
  vi.stubEnv('BASE_URL', '/finance/');
  vi.stubGlobal('__APP_VERSION__', 'build-current');
  vi.stubGlobal('fetch', fetchMock);
  documentMock = makeDocument();
  windowMock = makeWindow();
  vi.stubGlobal('document', documentMock);
  vi.stubGlobal('window', windowMock);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  fetchMock.mockResolvedValue(response({ version: __APP_VERSION__ }));
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach(cleanup => cleanup());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('getAppUpdate', () => {
  it('usa BASE_URL, timestamp novo e cache no-store em cada requisição', async () => {
    expect(await getAppUpdate()).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/finance/version.json?${timestamp}`, {
      cache: 'no-store',
    });
    vi.setSystemTime(timestamp + 1);
    await getAppUpdate();
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/finance/version.json?${timestamp + 1}`, {
      cache: 'no-store',
    });
  });

  it('respeita BASE_URL na raiz', async () => {
    vi.stubEnv('BASE_URL', '/');
    await getAppUpdate();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/version.json?${timestamp}`, {
      cache: 'no-store',
    });
  });

  it('retorna null para a versão atual', async () => {
    expect(await getAppUpdate()).toBeNull();
  });

  it.each(['build-next', 'a', 'a'.repeat(128)])('aceita uma versão diferente válida: %s', async version => {
    fetchMock.mockResolvedValue(response({ version }));
    expect(await getAppUpdate()).toBe(version);
  });

  it('compara a versão inteira sem normalizar ou ordenar', async () => {
    const version = ` ${__APP_VERSION__} `;
    fetchMock.mockResolvedValue(response({ version }));
    expect(await getAppUpdate()).toBe(version);
  });

  it.each([
    ['null', null],
    ['array', [{ version: 'build-next' }]],
    ['string JSON', 'build-next'],
    ['número JSON', 123],
    ['booleano JSON', true],
    ['objeto vazio', {}],
    ['campo diferente', { appVersion: 'build-next' }],
    ['versão null', { version: null }],
    ['versão numérica', { version: 123 }],
    ['versão booleana', { version: true }],
    ['versão objeto', { version: {} }],
    ['versão array', { version: ['build-next'] }],
    ['versão vazia', { version: '' }],
    ['versão whitespace', { version: ' \t\n ' }],
    ['versão longa', { version: 'a'.repeat(129) }],
  ])('ignora %s sem lançar erro', async (_name, payload) => {
    fetchMock.mockResolvedValue(response(payload));
    await expect(getAppUpdate()).resolves.toBeNull();
  });

  it('não lê JSON de resposta HTTP não OK', async () => {
    const failedResponse = response({ version: 'build-next' }, false);
    fetchMock.mockResolvedValue(failedResponse);
    await expect(getAppUpdate()).resolves.toBeNull();
    expect(failedResponse.json).not.toHaveBeenCalled();
  });

  it('ignora JSON inválido', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON')),
    } as unknown as Response);
    await expect(getAppUpdate()).resolves.toBeNull();
  });

  it('ignora falha de leitura JSON síncrona', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn(() => { throw new SyntaxError('Invalid JSON'); }),
    } as unknown as Response);
    await expect(getAppUpdate()).resolves.toBeNull();
  });

  it('ignora rede offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Offline'));
    await expect(getAppUpdate()).resolves.toBeNull();
  });

  it('ignora falha síncrona do fetch', async () => {
    fetchMock.mockImplementation(() => { throw new TypeError('Fetch unavailable'); });
    await expect(getAppUpdate()).resolves.toBeNull();
  });
});

describe('watchAppUpdate', () => {
  it('importar o serviço não inicia rede, listeners ou timers', async () => {
    vi.resetModules();
    await import('./appVersion');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(documentMock.addEventListener).not.toHaveBeenCalled();
    expect(windowMock.addEventListener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('em DEV retorna cleanup no-op sem precisar de document/window', async () => {
    vi.stubEnv('DEV', true);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);
    const { callback, cleanup } = watch();
    expect(() => { cleanup(); cleanup(); }).not.toThrow();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(documentMock.addEventListener).not.toHaveBeenCalled();
    expect(windowMock.addEventListener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('verifica inicialmente e notifica uma vez sem reload ou storage', async () => {
    fetchMock.mockResolvedValue(response({ version: 'build-next' }));
    const { callback } = watch();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await flushChecks();
    expect(callback).toHaveBeenCalledExactlyOnceWith('build-next');
    fetchMock.mockResolvedValue(response({ version: 'build-newer' }));
    documentMock.dispatchEvent(new Event('visibilitychange'));
    windowMock.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(windowMock.location.reload).not.toHaveBeenCalled();
    for (const operation of Object.values(storage)) expect(operation).not.toHaveBeenCalled();
  });

  it('não notifica versão atual e verifica novamente a cada 60s', async () => {
    const { callback } = watch();
    await flushChecks();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callback).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response({ version: 'build-next' }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callback).toHaveBeenCalledExactlyOnceWith('build-next');
    expect(windowMock.setInterval).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 60_000);
  });

  it('ignora check inicial, eventos e polling ocultos; verifica ao voltar ao foreground', async () => {
    documentMock.visibilityState = 'hidden';
    const { callback } = watch();
    documentMock.dispatchEvent(new Event('visibilitychange'));
    windowMock.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).not.toHaveBeenCalled();
    documentMock.visibilityState = 'visible';
    documentMock.dispatchEvent(new Event('visibilitychange'));
    await flushChecks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    documentMock.visibilityState = 'hidden';
    documentMock.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    documentMock.visibilityState = 'visible';
    fetchMock.mockResolvedValue(response({ version: 'build-next' }));
    windowMock.dispatchEvent(new Event('pageshow'));
    await flushChecks();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledExactlyOnceWith('build-next');
  });

  it('coalesce eventos e polling enquanto fetch e JSON estão pendentes', async () => {
    const pendingFetch = deferred<Response>();
    const pendingJson = deferred<unknown>();
    fetchMock.mockReturnValueOnce(pendingFetch.promise);
    const { callback } = watch();
    documentMock.dispatchEvent(new Event('visibilitychange'));
    windowMock.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pendingFetch.resolve({ ok: true, json: () => pendingJson.promise } as Response);
    await flushChecks();
    windowMock.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pendingJson.resolve({ version: __APP_VERSION__ });
    await flushChecks();
    windowMock.dispatchEvent(new Event('pageshow'));
    await flushChecks();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callback).not.toHaveBeenCalled();
  });

  it.each(['offline', 'JSON inválido', 'HTTP não OK'])('libera busy após %s e tenta novamente', async failure => {
    if (failure === 'offline') fetchMock.mockRejectedValueOnce(new TypeError('Offline'));
    if (failure === 'JSON inválido') {
      fetchMock.mockResolvedValueOnce({
        ok: true, json: vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON')),
      } as unknown as Response);
    }
    if (failure === 'HTTP não OK') fetchMock.mockResolvedValueOnce(response({}, false));
    const { callback } = watch();
    await flushChecks();
    expect(callback).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response({ version: 'build-next' }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledExactlyOnceWith('build-next');
  });

  it('cleanup remove os mesmos listeners, cancela polling e é idempotente', async () => {
    const { callback, cleanup } = watch();
    await flushChecks();
    expect(documentMock.addEventListener).toHaveBeenCalledExactlyOnceWith('visibilitychange', expect.any(Function));
    expect(windowMock.addEventListener).toHaveBeenCalledExactlyOnceWith('pageshow', expect.any(Function));
    const documentListener = vi.mocked(documentMock.addEventListener).mock.calls[0][1] as EventListener;
    const windowListener = vi.mocked(windowMock.addEventListener).mock.calls[0][1] as EventListener;
    cleanup();
    cleanup();
    expect(documentMock.removeEventListener).toHaveBeenCalledExactlyOnceWith('visibilitychange', documentListener);
    expect(windowMock.removeEventListener).toHaveBeenCalledExactlyOnceWith('pageshow', windowListener);
    expect(windowMock.clearInterval).toHaveBeenCalledExactlyOnceWith(windowMock.setInterval.mock.results[0].value);
    expect(vi.getTimerCount()).toBe(0);
    documentMock.dispatchEvent(new Event('visibilitychange'));
    windowMock.dispatchEvent(new Event('pageshow'));
    documentListener(new Event('visibilitychange'));
    windowListener(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
  });

  it('cleanup ignora resposta fetch tardia com update', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const { callback, cleanup } = watch();
    cleanup();
    pending.resolve(response({ version: 'build-next' }));
    await flushChecks();
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleanup ignora JSON tardio com update', async () => {
    const pending = deferred<unknown>();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => pending.promise } as Response);
    const { callback, cleanup } = watch();
    await flushChecks();
    cleanup();
    pending.resolve({ version: 'build-next' });
    await flushChecks();
    expect(callback).not.toHaveBeenCalled();
  });

  it('cleanup ignora rejeição tardia sem erro ou notificação', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const { callback, cleanup } = watch();
    cleanup();
    pending.reject(new TypeError('Offline'));
    await flushChecks();
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
