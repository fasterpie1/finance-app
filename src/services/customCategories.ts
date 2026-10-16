import { useSyncExternalStore } from 'react';
import { BILL_CATEGORY_COLORS, BILL_CATEGORY_LABELS, type BillCategory, type CategoryId } from '../types';
import { readUserStorage, writeUserStorage } from './userStorage';

/** Categoria criada pelo próprio usuário. As fixas do código continuam valendo para todo mundo. */
export interface CustomCategory {
  id: string;
  label: string;
}

export type { CategoryId };

const STORAGE_KEY = 'financa_custom_categories_v1';
const MAX_CATEGORIES = 24;
const MAX_LABEL_LENGTH = 24;
/** Sem cor escolhida pelo usuário: o tom é estável pela posição, para a mesma categoria não
 *  mudar de cor entre a lista, o gráfico e o prompt da IA. */
const CUSTOM_PALETTE = ['#22d3ee', '#a3e635', '#f472b6', '#facc15', '#c084fc', '#34d399', '#fb923c', '#93c5fd'];

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function isBuiltIn(label: string): boolean {
  const normalized = normalizeLabel(label);
  return Object.values(BILL_CATEGORY_LABELS).some((value) => normalizeLabel(value) === normalized);
}

export function readCustomCategories(userId: string | null): CustomCategory[] {
  try {
    const raw = readUserStorage(userId, STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is CustomCategory => Boolean(item) && typeof item === 'object'
        && typeof (item as CustomCategory).id === 'string' && typeof (item as CustomCategory).label === 'string')
      .map((item) => ({ id: item.id.slice(0, 40), label: item.label.slice(0, MAX_LABEL_LENGTH) }))
      .filter((item) => item.label.length > 0);
  } catch {
    return [];
  }
}

function persist(userId: string | null, list: CustomCategory[]): void {
  writeUserStorage(userId, STORAGE_KEY, JSON.stringify(list));
}

let cachedUserId: string | null | undefined;
let cachedList: CustomCategory[] = [];
const listeners = new Set<() => void>();

function load(userId: string | null): CustomCategory[] {
  if (cachedUserId !== userId) {
    cachedUserId = userId;
    cachedList = readCustomCategories(userId);
  }
  return cachedList;
}

function commit(userId: string | null, next: CustomCategory[]): void {
  cachedUserId = userId;
  cachedList = next;
  persist(userId, next);
  listeners.forEach((listener) => listener());
}

export type CreateResult = { ok: true; category: CustomCategory } | { ok: false; reason: 'empty' | 'duplicate' | 'limit' };

export function createCustomCategory(userId: string | null, label: string): CreateResult {
  const clean = label.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL_LENGTH);
  if (!clean || isBuiltIn(clean)) return { ok: false, reason: 'empty' };
  const list = load(userId);
  if (list.some((item) => normalizeLabel(item.label) === normalizeLabel(clean))) return { ok: false, reason: 'duplicate' };
  if (list.length >= MAX_CATEGORIES) return { ok: false, reason: 'limit' };
  const category: CustomCategory = { id: `cat_${Math.random().toString(36).slice(2, 9)}`, label: clean };
  commit(userId, [...list, category]);
  return { ok: true, category };
}

export function renameCustomCategory(userId: string | null, id: string, label: string): CreateResult {
  const clean = label.trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL_LENGTH);
  if (!clean || isBuiltIn(clean)) return { ok: false, reason: 'empty' };
  const list = load(userId);
  if (list.some((item) => item.id !== id && normalizeLabel(item.label) === normalizeLabel(clean))) return { ok: false, reason: 'duplicate' };
  commit(userId, list.map((item) => (item.id === id ? { ...item, label: clean } : item)));
  return { ok: true, category: { id, label: clean } };
}

/** Remover não apaga lançamento: a linha volta a ficar "Sem categoria" na próxima leitura. */
export function removeCustomCategory(userId: string | null, id: string): void {
  commit(userId, load(userId).filter((item) => item.id !== id));
}

export function findCustomCategory(id: CategoryId | undefined, list: CustomCategory[]): CustomCategory | undefined {
  return id ? list.find((item) => item.id === id) : undefined;
}

export function isCustomCategoryId(id: CategoryId): boolean {
  return !Object.prototype.hasOwnProperty.call(BILL_CATEGORY_LABELS, id);
}

/** Label em qualquer tela: a fixa traduzida pelo app, ou o nome que a conta criou. */
export function getCategoryLabel(
  id: CategoryId,
  customCategories: CustomCategory[],
  builtInLabel: (category: BillCategory) => string,
): string {
  const custom = findCustomCategory(id, customCategories);
  return custom ? custom.label : builtInLabel(id as BillCategory);
}

export function getCategoryColor(id: CategoryId, customCategories: CustomCategory[]): string {
  const builtIn = BILL_CATEGORY_COLORS[id as BillCategory];
  if (builtIn) return builtIn;
  const index = customCategories.findIndex((item) => item.id === id);
  return CUSTOM_PALETTE[(index < 0 ? 0 : index) % CUSTOM_PALETTE.length];
}

/** Todas as telas lêem a mesma lista viva: criar no lançamento aparece no gráfico na hora. */
export function useCustomCategories(userId: string | null): CustomCategory[] {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => { listeners.delete(onStoreChange); };
    },
    () => load(userId),
    () => EMPTY,
  );
}

const EMPTY: CustomCategory[] = [];

/** Opções do seletor: as fixas do app primeiro, depois as desta conta. */
export function buildCategoryOptions(
  builtInLabel: (category: BillCategory) => string,
  customCategories: CustomCategory[],
): Array<{ value: string; label: string }> {
  return [
    ...(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((category) => ({ value: category, label: builtInLabel(category) })),
    ...customCategories.map((category) => ({ value: category.id, label: category.label })),
  ];
}
