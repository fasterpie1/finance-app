import { useSyncExternalStore } from 'react';
import { readUserStorage, writeUserStorage } from './userStorage';

/** Cartão cadastrado pela conta: o nome do banco e o final do plástico são a identidade vista nas telas. */
export interface PaymentCard {
  id: string;
  bank: string;
  last4: string;
  /** Dia de vencimento que a conta deste cartão costuma ter; a fatura do mês pode divergir. */
  dueDay?: number;
}

const STORAGE_KEY = 'financa_cards_v1';
const MAX_CARDS = 8;
const MAX_BANK_LENGTH = 20;

function normalizeBank(bank: string): string {
  return bank.trim().replace(/\s+/g, ' ').slice(0, MAX_BANK_LENGTH);
}

function normalizeLast4(last4: string): string {
  return last4.replace(/\D/g, '').slice(-4);
}

export function readPaymentCards(userId: string | null): PaymentCard[] {
  try {
    const raw = readUserStorage(userId, STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is PaymentCard => Boolean(item) && typeof item === 'object'
        && typeof (item as PaymentCard).id === 'string'
        && typeof (item as PaymentCard).bank === 'string'
        && typeof (item as PaymentCard).last4 === 'string')
      .map((item) => ({
        id: item.id.slice(0, 40),
        bank: normalizeBank(item.bank),
        last4: normalizeLast4(item.last4),
        dueDay: Number.isFinite(item.dueDay) ? Math.max(1, Math.min(31, Math.round(item.dueDay as number))) : undefined,
      }))
      .filter((card) => card.bank.length > 0 && card.last4.length === 4);
  } catch {
    return [];
  }
}

const cachedLists = new Map<string, PaymentCard[]>();
const listeners = new Set<() => void>();
const EMPTY: PaymentCard[] = [];
const userKey = (userId: string | null) => userId ?? 'anonymous';

function load(userId: string | null): PaymentCard[] {
  const key = userKey(userId);
  let list = cachedLists.get(key);
  if (!list) {
    list = readPaymentCards(userId);
    cachedLists.set(key, list);
  }
  return list;
}

function commit(userId: string | null, next: PaymentCard[]): void {
  cachedLists.set(userKey(userId), next);
  writeUserStorage(userId, STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
}

export type CardResult = { ok: true; card: PaymentCard } | { ok: false; reason: 'incomplete' | 'limit' };

/** Mesma pessoa, mesmo plástico: banco + final é o que distingue um cartão do outro. */
function findByBankAndLast4(list: PaymentCard[], bank: string, last4: string): PaymentCard | undefined {
  return list.find((card) => card.last4 === last4 && card.bank.toLowerCase() === bank.toLowerCase());
}

/**
 * Cartão declarado na hora de lançar ou de importar o print, o CSV e o PDF. Quem repete o mesmo
 * banco e final recebe o cartão já cadastrado de volta: a fatura continua sendo daquela mesma linha.
 */
export function findOrCreatePaymentCard(userId: string | null, bank: string, last4: string): CardResult {
  const cleanBank = normalizeBank(bank);
  const cleanLast4 = normalizeLast4(last4);
  if (!cleanBank || cleanLast4.length !== 4) return { ok: false, reason: 'incomplete' };
  const list = load(userId);
  const existing = findByBankAndLast4(list, cleanBank, cleanLast4);
  if (existing) return { ok: true, card: existing };
  if (list.length >= MAX_CARDS) return { ok: false, reason: 'limit' };
  const card: PaymentCard = { id: `card_${Math.random().toString(36).slice(2, 9)}`, bank: cleanBank, last4: cleanLast4 };
  commit(userId, [...list, card]);
  return { ok: true, card };
}

/** O vencimento mora no cartão, não no mês: assim todo mês futuro herda o dia certo. */
export function setPaymentCardDueDay(userId: string | null, id: string, dueDay: number): void {
  const list = load(userId);
  if (!list.some((card) => card.id === id)) return;
  commit(userId, list.map((card) => (card.id === id ? { ...card, dueDay } : card)));
}

/** "Nubank Patricia 5190" em "Nubank Patricia" + 5190; sem o final de quatro dígitos não é cartão. */
function parseCardLabel(label: string): { bank: string; last4: string } | null {
  const tokens = label.trim().split(/\s+/);
  const last4 = tokens[tokens.length - 1] ?? '';
  if (tokens.length < 2 || !/^\d{4}$/.test(last4)) return null;
  const bank = normalizeBank(tokens.slice(0, -1).join(' '));
  return bank ? { bank, last4 } : null;
}

/**
 * Cadastro é deste aparelho, fatura vem da nuvem: num celular novo os cartões nunca foram
 * digitados e cada fatura sincronizada cai no grupo "sem cartão", deixando a tela só com o
 * total. O rótulo gravado na própria fatura basta para refazer o cadastro aqui, com o MESMO id,
 * assim as faturas daquele cartão voltam a ser dele sem reimportar nada.
 */
export function deriveCardsFromInvoiceLabels<T extends { cardId?: string; cardLabel?: string }>(
  invoices: T[],
  existing: PaymentCard[],
): PaymentCard[] {
  const ids = new Set(existing.map((card) => card.id));
  const identities = new Set(existing.map((card) => `${card.bank.toLowerCase()}|${card.last4}`));
  const derived: PaymentCard[] = [];
  invoices.forEach((invoice) => {
    if (ids.size >= MAX_CARDS) return;
    const cardId = invoice.cardId;
    if (!cardId || cardId.length > 40 || ids.has(cardId)) return;
    const parsed = invoice.cardLabel ? parseCardLabel(invoice.cardLabel) : null;
    if (!parsed) return;
    const identity = `${parsed.bank.toLowerCase()}|${parsed.last4}`;
    if (identities.has(identity)) return;
    ids.add(cardId);
    identities.add(identity);
    derived.push({ id: cardId, bank: parsed.bank, last4: parsed.last4 });
  });
  return derived;
}

/** Quantos cartões este aparelho recuperou; 0 quando já estava tudo certo. */
export function adoptPaymentCardsFromInvoices(userId: string | null, invoices: Array<{ cardId?: string; cardLabel?: string }>): number {
  const list = load(userId);
  const derived = deriveCardsFromInvoiceLabels(invoices, list);
  if (derived.length === 0) return 0;
  commit(userId, [...list, ...derived]);
  return derived.length;
}

export function usePaymentCards(userId: string | null): PaymentCard[] {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => { listeners.delete(onStoreChange); };
    },
    () => getPaymentCardsSnapshot(userId),
    () => EMPTY,
  );
}

export function getPaymentCardsSnapshot(userId: string | null): PaymentCard[] {
  return load(userId);
}

export function findPaymentCard(id: string | undefined, cards: PaymentCard[]): PaymentCard | undefined {
  return id ? cards.find((card) => card.id === id) : undefined;
}

/** "Nubank 8649" — como o cartão aparece na fatura, no chip e no lembrete. */
export function getPaymentCardLabel(card: PaymentCard): string {
  return `${card.bank} ${card.last4}`;
}

/**
 * Dono de uma fatura. Um id que não está cadastrado neste aparelho vale como fatura antiga: sem
 * essa checagem a fatura ficaria num grupo que nenhuma barra percorre e sumiria da tela. Fatura
 * sem cartão (todo o histórico anterior a este recurso) pertence ao único cartão cadastrado;
 * com dois ou mais, ela fica no grupo "sem cartão" em vez de inventar dono.
 */
export function resolveInvoiceCardId(invoiceCardId: string | undefined, cards: PaymentCard[]): string | undefined {
  const found = findPaymentCard(invoiceCardId, cards);
  if (found) return found.id;
  return cards.length === 1 ? cards[0].id : undefined;
}

/**
 * Dono de uma conta lançada à mão na área do cartão ou no dashboard. Um cartão excluído não
 * pode sumir com a conta do mês: volta a herdar igual à fatura antiga.
 */
export function resolveBillCardId(bill: { cardId?: string }, cards: PaymentCard[]): string | undefined {
  return resolveInvoiceCardId(bill.cardId, cards);
}

/** Rótulo da fatura: o cartão cadastrado, ou o nome gravado na importação quando ele já foi excluído. */
export function getInvoiceCardLabel(invoice: { cardId?: string; cardLabel?: string }, cards: PaymentCard[]): string {
  const card = findPaymentCard(resolveInvoiceCardId(invoice.cardId, cards), cards);
  if (card) return getPaymentCardLabel(card);
  return invoice.cardLabel ?? '';
}

/** Vencimento usado pelo lembrete: o dia deste cartão, senão o dia geral do mês. */
export function getCardDueDay(cardId: string | undefined, cards: PaymentCard[], monthDueDay?: number): number | undefined {
  return findPaymentCard(cardId, cards)?.dueDay ?? monthDueDay;
}

/**
 * Uma fatura por cartão e mês. O sufixo só entra quando existe cartão, assim as faturas
 * antigas (sem cardId) continuam com o mesmo id e a reimportação segue consolidando na
 * mesma fatura em vez de criar uma segunda com o mesmo total.
 */
export function cardInvoiceId(kind: 'manual-invoice' | 'imported-invoice', year: number, month: string, cardId?: string): string {
  return cardId ? `${kind}-${year}-${month}-${cardId}` : `${kind}-${year}-${month}`;
}

/** Grupo de faturas do mês por cartão, na ordem do cadastro; o "sem cartão" vai por último. */
export function groupInvoicesByCard<T extends { cardId?: string }>(invoices: T[], cards: PaymentCard[]): Array<{ cardId: string | undefined; invoices: T[] }> {
  const groups = new Map<string | undefined, T[]>();
  invoices.forEach((invoice) => {
    const cardId = resolveInvoiceCardId(invoice.cardId, cards);
    groups.set(cardId, [...(groups.get(cardId) ?? []), invoice]);
  });
  const ordered: Array<{ cardId: string | undefined; invoices: T[] }> = [];
  cards.forEach((card) => {
    const group = groups.get(card.id);
    if (group) ordered.push({ cardId: card.id, invoices: group });
  });
  const unassigned = groups.get(undefined);
  if (unassigned) ordered.push({ cardId: undefined, invoices: unassigned });
  return ordered;
}
