declare const __APP_VERSION__: string;

export async function getAppUpdate(): Promise<string | null> {
  if (import.meta.env.DEV) return null;
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?${Date.now()}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (
      typeof payload !== 'object' || payload === null || Array.isArray(payload) ||
      !('version' in payload) || typeof payload.version !== 'string' ||
      payload.version.trim().length === 0 || payload.version.length > 128
    ) return null;

    return payload.version === __APP_VERSION__ ? null : payload.version;
  } catch {
    return null;
  }
}

export function watchAppUpdate(callback: (version: string) => void): () => void {
  if (import.meta.env.DEV) return () => {};

  let stopped = false;
  let busy = false;
  let notified = false;

  async function check(): Promise<void> {
    if (stopped || notified || busy || document.visibilityState !== 'visible') return;
    busy = true;
    try {
      const version = await getAppUpdate();
      if (!stopped && !notified && version !== null) {
        notified = true;
        callback(version);
      }
    } finally {
      busy = false;
    }
  }

  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', check);
  const interval = window.setInterval(check, 60_000);
  void check();

  return () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('pageshow', check);
    window.clearInterval(interval);
  };
}
