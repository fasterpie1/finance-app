export function userStorageKey(userId: string | null, key: string): string {
  return userId ? `${key}:${userId}` : `${key}:anonymous`;
}

export function readUserStorage(userId: string | null, key: string): string | null {
  try { return localStorage.getItem(userStorageKey(userId, key)); } catch { return null; }
}

export function writeUserStorage(userId: string | null, key: string, value: string): void {
  try { localStorage.setItem(userStorageKey(userId, key), value); } catch { /* ignore storage failures */ }
}

export function removeUserStorage(userId: string | null, key: string): void {
  try { localStorage.removeItem(userStorageKey(userId, key)); } catch { /* ignore storage failures */ }
}
