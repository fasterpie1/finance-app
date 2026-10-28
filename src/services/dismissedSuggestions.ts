import { readUserStorage, writeUserStorage } from './userStorage';

/** Lista de sugestões dispensadas, guardada por usuário: dispensar no celular não cala o tablet. */
export function readDismissed(userId: string | null, storageKey: string): string[] {
  try {
    const saved = JSON.parse(readUserStorage(userId, storageKey) || '[]') as unknown;
    return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

export function writeDismissed(userId: string | null, storageKey: string, keys: string[]): void {
  writeUserStorage(userId, storageKey, JSON.stringify(keys));
}
