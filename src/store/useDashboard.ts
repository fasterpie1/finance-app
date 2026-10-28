import { useState, useCallback, useEffect, useRef } from 'react';
import { type Bill, type BudgetMonth, type CategoryId, type CardPaymentMethod, type CreditCardInvoice, type CreditCardTransaction, type IncomeSource, MONTH_NAMES, getMonthIndex, formatCurrency } from '../types';
import { sampleMonths } from '../data/sampleData';
import { supabase } from '../services/supabase';
import { readUserStorage, removeUserStorage, writeUserStorage } from '../services/userStorage';
import { amountToCents, centsToAmount, formatTransactionDay, getCardCharges, getInvoicePersonalTotalCents, getMonthPlannedCents, isOnCreditCardBill } from '../services/cardTransactions';
import { cardInvoiceId, findPaymentCard, getCardDueDay, getPaymentCardLabel, groupInvoicesByCard, resolveBillCardId, adoptPaymentCardsFromInvoices, type PaymentCard } from '../services/paymentCards';

const STORAGE_KEY = 'financa_months_v1';
const SELECTED_KEY = 'financa_selected_v1';
/** Carimbo da última escrita local ainda não confirmada no Supabase: o valor é a revision
 *  da nuvem em que ela se apoiou. Sem isso não dá para saber se o servidor mudou por outro
 *  aparelho, e empurrar o local sobrescreve os dados daquele aparelho. */
const PENDING_SYNC_KEY = 'financa_pending_sync_v1';

/** Revision de referência da escrita pendente; -1 para carimbo de versão antiga (sem base). */
function readPendingBaseRevision(userId: string | null): number | null {
  const raw = readUserStorage(userId, PENDING_SYNC_KEY);
  if (raw == null) return null;
  const base = Number(raw);
  return Number.isInteger(base) ? base : -1;
}

/** Só é seguro o local substituir a nuvem se ninguém escreveu nela depois da nossa base.
 *  Revision 0 só é segura quando a linha ainda tem os meses de exemplo. */
function cloudMatchesPendingBase(baseRevision: number, remoteRevision: number, remoteMonths: BudgetMonth[]): boolean {
  if (remoteRevision === 0) return !isSampleMonthList(remoteMonths);
  return baseRevision === remoteRevision;
}

function isSampleMonthList(months: BudgetMonth[]): boolean {
  return months.length === sampleMonths.length && months.every((month, index) => month.id === sampleMonths[index].id);
}

/**
 * Texto do banner de sync. O detalhe do PostgREST (schema, JWT, SQL) fica somente no console:
 * um print da tela ou um vídeo de suporte entregariam isso a terceiros.
 */
function syncFailureMessage(prefix: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? '');
  if (/jwt expired|invalid claim|401|not authenticated/i.test(detail)) {
    return 'Sessão expirada: os dados estão salvos apenas neste aparelho. Entre novamente para sincronizar.';
  }
  return `${prefix}. Seus dados continuam salvos neste aparelho; verifique a conexão e tente de novo.`;
}

/** Migra dados antigos (sem year) para o novo formato */
function migrateLegacyCardBills(months: BudgetMonth[]): BudgetMonth[] {
  return months.map((month) => {
    const legacyCardBills = month.bills.filter((bill) => (
      bill.type === 'parcela'
      && bill.category !== 'financiamento'
      && bill.cardPaymentMethod !== 'debito_pix'
    ));
    if (legacyCardBills.length === 0) return month;

    const invoiceId = `legacy-invoice-${month.id}`;
    const transactions: CreditCardTransaction[] = legacyCardBills.map((bill) => ({
      id: `legacy-card-transaction-${bill.id}`,
      invoiceId,
      merchant: bill.name,
      amountCents: Math.round(bill.amount * 100),
      type: bill.installmentTotal && bill.installmentTotal > 1 ? 'INSTALLMENT' : 'PURCHASE',
      owner: 'ME',
      category: bill.category,
      installmentCurrent: bill.installmentCurrent,
      installmentTotal: bill.installmentTotal,
      source: 'MANUAL',
    }));
    const invoice: CreditCardInvoice = {
      id: invoiceId,
      month: month.name,
      year: month.year,
      isPaid: legacyCardBills.every((bill) => bill.isPaid),
      transactions,
    };

    return {
      ...month,
      bills: month.bills.filter((bill) => !legacyCardBills.includes(bill)),
      creditCardInvoices: [...(month.creditCardInvoices ?? []).filter((item) => item.id !== invoiceId), invoice],
    };
  });
}

function migrateMonths(months: BudgetMonth[]): BudgetMonth[] {
  const currentYear = new Date().getFullYear();
  const migrated = months.map((m) => ({
    ...m,
    year: m.year || currentYear,
    savingsGoal: m.savingsGoal ?? 0,
    savingsGoalMode: m.savingsGoalMode ?? (m.savingsGoal && m.savingsGoal > 0 ? 'manual' : 'auto'),
    savedAmount: m.savedAmount ?? 0,
    creditCardInvoices: m.creditCardInvoices ?? [],
    incomeSources: m.incomeSources ?? [],
  }));
  return migrateLegacyCardBills(migrated);
}

function loadMonths(userId: string | null): BudgetMonth[] {
  try {
    const raw = readUserStorage(userId, STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BudgetMonth[];
      if (!Array.isArray(parsed) || parsed.length === 0) return sampleMonths;
      const isOldDemo = parsed.length === 3 && parsed.some((month) => month.id === '1') && parsed.some((month) => month.id === '2') && parsed.some((month) => month.id === '3');
      if (!isOldDemo) return migrateMonths(parsed);
    }
  } catch { /* ignore */ }
  return sampleMonths;
}

function loadSelectedId(months: BudgetMonth[]): string {
  const current = months.find((month) => {
    const today = new Date();
    return month.year === today.getFullYear() && getMonthIndex(month.name) === today.getMonth();
  });
  return current?.id ?? months[0].id;
}

/** Ordena meses por ano e índice do mês */
function sortMonths(months: BudgetMonth[]): BudgetMonth[] {
  return [...months].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return getMonthIndex(a.name) - getMonthIndex(b.name);
  });
}

export interface MonthInfo {
  name: string;
  year: number;
}

export interface BillNotification {
  billId: string;
  name: string;
  amount: number;
  dueDate: Date;
  daysUntilDue: number;
  isOverdue: boolean;
  plannedMonth: string;
}

function dateAtMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextMonthDate(month: BudgetMonth, dueDay: number): Date {
  const monthIndex = getMonthIndex(month.name);
  const dueMonthIndex = monthIndex < 0 ? 0 : (monthIndex + 1) % 12;
  const dueYear = dueMonthIndex === 0 ? month.year + 1 : month.year;
  const lastDay = new Date(dueYear, dueMonthIndex + 1, 0).getDate();
  return new Date(dueYear, dueMonthIndex, Math.min(Math.max(dueDay, 1), lastDay));
}

export function getBillNotifications(months: BudgetMonth[], today = new Date(), cards: PaymentCard[] = []): BillNotification[] {
  const currentDate = dateAtMidnight(today);
  const dayMs = 24 * 60 * 60 * 1000;

  return months.flatMap((month) => {
    const notifications: BillNotification[] = [];
    // Compras do cartão moram em creditCardInvoices (as contas antigas são migradas na
    // leitura), então o lembrete da fatura não pode vir de month.bills.
    const invoices = month.creditCardInvoices ?? [];
    // Cada banco cobra a própria fatura em dia próprio: um lembrete por cartão do mês.
    const pendingCardBills = getCardCharges(invoices, month.bills).pendingBills
      .filter((bill) => !bill.isPaid);
    const invoiceGroups = groupInvoicesByCard(invoices, cards);
    // Um cartão pode ter só conta lançada na mão, sem fatura: ele também precisa do próprio lembrete.
    const dueCardIds: Array<string | undefined> = [...new Set([
      ...invoiceGroups.map((group) => group.cardId),
      ...pendingCardBills.map((bill) => resolveBillCardId(bill, cards)),
    ])];
    const dueGroups = dueCardIds.map((cardId) => ({
      cardId,
      cents: (invoiceGroups.find((group) => group.cardId === cardId)?.invoices ?? [])
        .filter((invoice) => !invoice.isPaid)
        .reduce((total, invoice) => total + getInvoicePersonalTotalCents(invoice), 0)
        // A conta lançada na mão vence no cartão escolhido nela, ou no único cadastrado.
        + pendingCardBills
          .filter((bill) => resolveBillCardId(bill, cards) === cardId)
          .reduce((total, bill) => total + amountToCents(bill.amount), 0),
    }));
    dueGroups.forEach((group) => {
      if (group.cents <= 0) return;
      const dueDay = getCardDueDay(group.cardId, cards, month.creditCardDueDay);
      if (!dueDay) return;
      const dueDate = nextMonthDate(month, dueDay);
      const daysUntilDue = Math.round((dueDate.getTime() - currentDate.getTime()) / dayMs);
      const card = findPaymentCard(group.cardId, cards);
      notifications.push({
        billId: `credit-card-invoice-${month.id}-${group.cardId ?? 'sem-cartao'}`,
        name: card ? getPaymentCardLabel(card) : 'Fatura do cartão',
        amount: centsToAmount(group.cents),
        dueDate,
        daysUntilDue,
        isOverdue: daysUntilDue < 0,
        plannedMonth: `${month.name} ${month.year}`,
      });
    });

    notifications.push(...month.bills
      .filter((bill) => !bill.isPaid && bill.cardPaymentMethod !== 'debito_pix' && !isOnCreditCardBill(bill))
      .map((bill) => {
        const dueDate = nextMonthDate(month, bill.dueDay);
        const daysUntilDue = Math.round((dueDate.getTime() - currentDate.getTime()) / dayMs);
        return {
          billId: bill.id,
          name: bill.name,
          amount: bill.amount,
          dueDate,
          daysUntilDue,
          isOverdue: daysUntilDue < 0,
          plannedMonth: `${month.name} ${month.year}`,
        };
      }));

    return notifications.filter((notification) => notification.daysUntilDue <= 3);
  }).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

export function getMonthsFrom(startName: string, startYear: number, count: number): MonthInfo[] {
  const idx = getMonthIndex(startName);
  const start = idx === -1 ? 0 : idx;
  return Array.from({ length: count }, (_, i) => {
    const monthIdx = (start + i) % 12;
    const yearOffset = Math.floor((start + i) / 12);
    return { name: MONTH_NAMES[monthIdx], year: startYear + yearOffset };
  });
}

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Renda do mês imediatamente anterior (em ordem cronológica), para não nascer zerada. */
function incomeOfPreviousMonth(months: BudgetMonth[], name: string, year: number): number {
  const idx = getMonthIndex(name);
  const prevIdx = idx <= 0 ? 11 : idx - 1;
  const prevYear = idx <= 0 ? year - 1 : year;
  const previous = months.find(
    (m) => m.name.toLowerCase() === MONTH_NAMES[prevIdx].toLowerCase() && m.year === prevYear
  );
  const fallback = [...months].sort((a, b) => a.year - b.year || getMonthIndex(a.name) - getMonthIndex(b.name))[0]?.income;
  return previous?.income ?? fallback ?? 0;
}

/** Mesma cobrança já lançada no mês (comprador, valor, parcela e data).
 *  `cardId` é o dono da fatura que está entrando. Dois cartões cadastrados podem cobrar a
 *  mesma compra; dentro deles a comparação não cruza. Fatura antiga (sem cadastro) compara
 *  com tudo, senão reimportar a mesma fatura passaria a contar o lançamento duas vezes. */
function hasSameCardTransaction(month: BudgetMonth, tx: CreditCardTransaction, cardId?: string): boolean {
  return (month.creditCardInvoices ?? []).some((invoice) => {
    if (cardId && invoice.cardId && invoice.cardId !== cardId) return false;
    return (invoice.transactions ?? []).some((existing) => (
      existing.merchant === tx.merchant
      && existing.amountCents === tx.amountCents
      && (existing.installmentCurrent ?? 1) === (tx.installmentCurrent ?? 1)
      && (existing.installmentTotal ?? 1) === (tx.installmentTotal ?? 1)
      && (existing.date ?? '') === (tx.date ?? '')
    ));
  });
}

export interface CreditCardPurchase {
  name: string;
  amount: number;
  dueDay?: number;
  category: CategoryId;
  installmentCurrent: number;
  installmentTotal: number;
  paymentMethod?: CardPaymentMethod;
  owner?: 'ME' | 'THIRD_PARTY' | 'SHARED' | 'UNCLASSIFIED';
  personalAmountCents?: number;
  thirdPartyName?: string;
  /** Cartão que vai cobrar esta compra. Sem ele, a compra entra no grupo "sem cartão". */
  cardId?: string;
  cardLabel?: string;
}

/** Destino de um lançamento movido entre cartões (ver `moveCreditCardTransactions`). */
export interface CardMoveTarget {
  invoiceId: string;
  cardId: string;
  cardLabel?: string;
}

export function useDashboard(userId: string | null = null) {
  const [months, setMonths] = useState<BudgetMonth[]>(() => sortMonths(loadMonths(userId)));
  const [selectedMonthId, setSelectedMonthId] = useState<string>(() => loadSelectedId(loadMonths(userId)));
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [, setRemoteRevision] = useState(0);
  const remoteRevisionRef = useRef(0);
  const remoteLoaded = useRef(!supabase || !userId);
  // Debounce coalesces rapid edits; the chain serializes in-flight updates so each
  // one reads the latest revision only after the previous write has resolved.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!supabase || !userId) {
      remoteLoaded.current = true;
      return;
    }
    const client = supabase;
    remoteLoaded.current = false;
    const loadRemote = async () => {
      const { data, error } = await client.from('user_finance_data').select('months, selected_month_id, updated_at, revision').eq('user_id', userId).maybeSingle();
      if (error) {
        console.error('Falha ao carregar dados do Supabase:', error);
        setSyncError(syncFailureMessage('Falha ao carregar dados', error));
      } else if (data?.months && Array.isArray(data.months) && data.months.length > 0) {
        const remoteMonths = sortMonths(migrateMonths(data.months as BudgetMonth[]));
        const remoteRevision = data.revision ?? 0;
        const syncedAt = data.updated_at ? new Date(data.updated_at) : new Date();
        const pendingBase = readPendingBaseRevision(userId);
        if (pendingBase !== null && !cloudMatchesPendingBase(pendingBase, remoteRevision, remoteMonths)) {
          // Os dois lados mudaram depois da última confirmação: nenhum é mais novo que o
          // outro, então ninguém é sobrescrito. O push local fica barrado pelo controle de
          // revision e o usuário decide com "Atualizar" (que baixa a nuvem).
          setLastSyncedAt(syncedAt);
          setSyncError('Este aparelho e a nuvem têm alterações diferentes. Nada foi substituído: toque em Atualizar para carregar a versão da nuvem.');
        } else if (pendingBase !== null && readUserStorage(userId, STORAGE_KEY) !== JSON.stringify(remoteMonths)) {
          // Havia edição local não enviada e a nuvem não mudou desde a nossa base:
          // manter o local e deixá-la ser empurrada pelo efeito de salvamento.
          setSyncNotice('Alterações deste aparelho eram mais novas e foram mantidas');
          setRemoteRevision(remoteRevision);
          remoteRevisionRef.current = remoteRevision;
          setLastSyncedAt(syncedAt);
          setSyncError(null);
        } else {
          setMonths(remoteMonths);
          setSelectedMonthId(loadSelectedId(remoteMonths));
          removeUserStorage(userId, PENDING_SYNC_KEY);
          setLastSyncedAt(syncedAt);
          setRemoteRevision(remoteRevision);
          remoteRevisionRef.current = remoteRevision;
          setSyncError(null);
        }
      } else if (!data) {
        const { error: insertError } = await client.from('user_finance_data').upsert({ user_id: userId, months: sampleMonths, selected_month_id: sampleMonths[0].id, revision: 0 });
        if (insertError) {
          console.error('Falha ao criar dados do usuário no Supabase:', insertError);
          setSyncError(syncFailureMessage('Falha ao criar dados', insertError));
        } else {
          setSyncError(null);
        }
      } else {
        // A linha existe sem meses: não regravar dados de exemplo por cima dela.
        // Assumimos a revision atual para o próximo salvamento local passar no controle otimista.
        setLastSyncedAt(data.updated_at ? new Date(data.updated_at) : new Date());
        setRemoteRevision(data.revision ?? 0);
        remoteRevisionRef.current = data.revision ?? 0;
      }
      remoteLoaded.current = true;
    };
    void loadRemote();
  }, [userId]);

  // O cadastro de cartões mora neste aparelho, a fatura vem da nuvem: num celular novo nenhum
  // cartão foi digitado e todas as faturas cairiam em "sem cartão", deixando a tela só com o
  // total. A própria fatura traz o id e o nome do dono, então o cadastro volta a existir aqui.
  // Começa pelo mês aberto: o teto de oito cartões não pode ser gasto com histórico velho.
  useEffect(() => {
    const openMonth = months.find((month) => month.id === selectedMonthId);
    const invoices = [...(openMonth ? [openMonth] : []), ...months.filter((month) => month.id !== selectedMonthId).reverse()]
      .flatMap((month) => month.creditCardInvoices ?? []);
    adoptPaymentCardsFromInvoices(userId, invoices);
  }, [months, selectedMonthId, userId]);

  const refreshData = useCallback(async () => {
    if (!supabase || !userId || isRefreshing) return;
    setIsRefreshing(true);
    const { data, error } = await supabase.from('user_finance_data').select('months, selected_month_id, updated_at, revision').eq('user_id', userId).maybeSingle();
    if (error) {
      console.error('Falha ao atualizar dados do Supabase:', error);
      setSyncError(syncFailureMessage('Falha ao atualizar dados', error));
    } else if (data?.months && Array.isArray(data.months) && data.months.length > 0) {
      const remoteMonths = sortMonths(migrateMonths(data.months as BudgetMonth[]));
      const hasChanges = JSON.stringify(months) !== JSON.stringify(remoteMonths);
      const remoteRevision = data.revision ?? 0;
      const pendingBase = readPendingBaseRevision(userId);
      if (pendingBase !== null && !cloudMatchesPendingBase(pendingBase, remoteRevision, remoteMonths)) {
        // Conflito real: só o clique em "Atualizar" dá o consentimento para baixar a nuvem.
        // Antes isto mantinha o local e adotava a revision remota, o que empurrava o local
        // por cima das mudanças do outro aparelho sem avisar.
        setMonths(remoteMonths);
        setSelectedMonthId(loadSelectedId(remoteMonths));
        removeUserStorage(userId, PENDING_SYNC_KEY);
        setLastSyncedAt(data.updated_at ? new Date(data.updated_at) : new Date());
        setRemoteRevision(remoteRevision);
        remoteRevisionRef.current = remoteRevision;
        setSyncNotice('Versão da nuvem carregada. O que estava só neste aparelho foi substituído.');
        setSyncError(null);
      } else if (pendingBase !== null) {
        // Atualizar não pode apagar edição feita offline: mantém a local e a empurra.
        setSyncNotice('Suas alterações locais eram mais novas e foram mantidas');
        setRemoteRevision(remoteRevision);
        remoteRevisionRef.current = remoteRevision;
        setLastSyncedAt(data.updated_at ? new Date(data.updated_at) : new Date());
        setSyncError(null);
      } else {
        setMonths(remoteMonths);
        setSelectedMonthId(loadSelectedId(remoteMonths));
        setLastSyncedAt(data.updated_at ? new Date(data.updated_at) : new Date());
        setRemoteRevision(remoteRevision);
        remoteRevisionRef.current = remoteRevision;
        setSyncNotice(hasChanges ? 'Alterações de outro dispositivo carregadas' : 'Nenhuma alteração nova');
        setSyncError(null);
      }
    }
    setIsRefreshing(false);
  }, [isRefreshing, months, userId]);

  // Salvar automaticamente sempre que mudar
  useEffect(() => {
    if (!remoteLoaded.current) return;
    writeUserStorage(userId, STORAGE_KEY, JSON.stringify(months));
    writeUserStorage(userId, PENDING_SYNC_KEY, String(remoteRevisionRef.current));
    const client = supabase;
    const uid = userId;
    if (!client || !uid) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveChainRef.current = saveChainRef.current.then(async () => {
        const expectedRevision = remoteRevisionRef.current;
        const { data, error } = await client.from('user_finance_data')
          .update({ months, selected_month_id: selectedMonthId, updated_at: new Date().toISOString(), revision: expectedRevision + 1 })
          .eq('user_id', uid).eq('revision', expectedRevision)
          .select('revision').maybeSingle();
        if (error || !data) {
          console.error('Falha ao salvar dados no Supabase:', error);
          const authLost = /jwt expired|invalid claim|401|not authenticated|failed to fetch/i.test(String(error?.message ?? ''));
          setSyncError(authLost
            ? 'Sessão expirada: os dados estão salvos apenas neste aparelho. Entre novamente para sincronizar.'
            : 'Este aparelho não sobrescreveu a nuvem: os dados mudaram em outro dispositivo. Suas alterações continuam salvas aqui; Atualizar carrega a versão da nuvem.');
        } else {
          removeUserStorage(uid, PENDING_SYNC_KEY);
          remoteRevisionRef.current = data.revision;
          setRemoteRevision(data.revision);
          setSyncError(null);
        }
      }).catch((err) => console.error('Falha inesperada ao salvar dados:', err));
    }, 600);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [months, selectedMonthId, userId]);

  useEffect(() => {
    if (!remoteLoaded.current) return;
    writeUserStorage(userId, SELECTED_KEY, selectedMonthId);
  }, [selectedMonthId, userId]);

  const selectedMonth = months.find((m) => m.id === selectedMonthId) ?? months[0];

  const billsSorted = [...selectedMonth.bills].sort((a, b) => a.dueDay - b.dueDay);
  // Financiamento é conta fixa mensal; parcelas de cartão são separadas
  const fixedBills = billsSorted.filter(
    (b) => b.type === 'mensal' || b.type === 'fixa' || (b.type === 'parcela' && b.category === 'financiamento')
  );
  const debitPixBills = billsSorted.filter(
    (b) => b.isOnCreditCard === true && b.cardPaymentMethod === 'debito_pix'
  );
  const variableBills = billsSorted.filter((b) => b.type === 'variavel' && b.cardPaymentMethod !== 'debito_pix');

  const cardCharges = getCardCharges(selectedMonth.creditCardInvoices ?? [], selectedMonth.bills);
  const invoicePersonalPaid = (selectedMonth.creditCardInvoices ?? [])
    .filter((invoice) => invoice.isPaid)
    .reduce((total, invoice) => total + centsToAmount(getInvoicePersonalTotalCents(invoice)), 0);
  // O que está no cartão sai da lista de contas: a fatura já responde por isso, e uma conta que
  // também veio importada não pode entrar duas vezes no previsto.
  const plainBills = selectedMonth.bills.filter((b) => !isOnCreditCardBill(b));
  const paidPendingCardBills = cardCharges.pendingBills.filter((b) => b.isPaid);
  const totalPlanned = centsToAmount(getMonthPlannedCents(selectedMonth.bills, selectedMonth.creditCardInvoices ?? []));
  // Débito/pix é deduzido da conta na hora da compra (não depende de pagar a fatura)
  // e não tem toggle de pago na UI (showPaidToggle={false}), então conta como pago
  // independentemente do `isPaid` armazenado, que permanece false desde a criação.
  const totalPaid = plainBills.filter((b) => b.isPaid || b.cardPaymentMethod === 'debito_pix').reduce((s, b) => s + b.amount, 0)
    + paidPendingCardBills.reduce((s, b) => s + b.amount, 0)
    + invoicePersonalPaid;
  const remaining = selectedMonth.income - totalPlanned;

  const selectMonth = useCallback((id: string) => setSelectedMonthId(id), []);

  const togglePaid = useCallback(
    (billId: string) => {
      setMonths((prev) =>
        prev.map((m) =>
          m.id === selectedMonthId
            ? { ...m, bills: m.bills.map((b) => (b.id === billId ? { ...b, isPaid: !b.isPaid } : b)) }
            : m
        )
      );
    },
    [selectedMonthId]
  );

  const saveBill = useCallback(
    (bill: Bill) => {
      setMonths((prev) =>
        prev.map((m) => {
          if (m.id !== selectedMonthId) return m;
          const exists = m.bills.some((b) => b.id === bill.id);
          return {
            ...m,
            bills: exists
              ? m.bills.map((b) => (b.id === bill.id ? bill : b))
              : [...m.bills, bill],
          };
        })
      );
    },
    [selectedMonthId]
  );

  /** Reclassificar uma cobrança que se repete precisa alcançar todos os meses em que ela existe;
   *  `saveBill` só enxerga o mês aberto. */
  const reclassifyBills = useCallback(
    (targets: { monthId: string; billId: string }[], category: CategoryId) => {
      setMonths((prev) => prev.map((m) => {
        const ids = new Set(targets.filter((target) => target.monthId === m.id).map((target) => target.billId));
        if (ids.size === 0) return m;
        return { ...m, bills: m.bills.map((b) => (ids.has(b.id) ? { ...b, category } : b)) };
      }));
    },
    []
  );

  const addBill = useCallback(
    (bill: Bill) => {
      setMonths((prev) =>
        prev.map((m) =>
          m.id === selectedMonthId ? { ...m, bills: [...m.bills, { ...bill, id: uuid() }] } : m
        )
      );
    },
    [selectedMonthId]
  );

  const deleteBill = useCallback(
    (billId: string) => {
      setMonths((prev) =>
        prev.map((m) =>
          m.id === selectedMonthId
            ? { ...m, bills: m.bills.filter((b) => b.id !== billId) }
            : m
        )
      );
    },
    [selectedMonthId]
  );

  const updateIncome = useCallback(
    (income: number) => {
      setMonths((prev) =>
        prev.map((m) => (m.id === selectedMonthId ? { ...m, income } : m))
      );
    },
    [selectedMonthId]
  );

  const updateIncomeSources = useCallback(
    (sources: IncomeSource[]) => {
      const cleaned = sources.filter((source) => source.label.trim() || source.amount > 0);
      const income = cleaned.reduce((sum, source) => sum + source.amount, 0);
      setMonths((prev) =>
        prev.map((m) => (m.id === selectedMonthId ? { ...m, income, incomeSources: cleaned } : m))
      );
    },
    [selectedMonthId]
  );

  // ====== COPIAR CONTAS FIXAS DO MÊS ANTERIOR ======
  const copyFixedBillsFromPrevious = useCallback(() => {
    const currentIdx = getMonthIndex(selectedMonth.name);
    const prevIdx = (currentIdx - 1 + 12) % 12;
    const prevMonthName = MONTH_NAMES[prevIdx];
    const prevYear = prevIdx === 11 ? selectedMonth.year - 1 : selectedMonth.year;

    setMonths((prev) => {
      const prevMonth = prev.find(
        (m) => m.name.toLowerCase() === prevMonthName.toLowerCase() && m.year === prevYear
      );
      if (!prevMonth) return prev;

      const billsToCopy = prevMonth.bills.filter(
        (b) => b.type === 'mensal' || b.type === 'fixa' || (b.type === 'parcela' && b.category === 'financiamento')
      );
      if (billsToCopy.length === 0) return prev;

      return prev.map((m) => {
        if (m.id !== selectedMonthId) return m;
        // Idempotency: skip bills already present this month so calling this twice
        // (e.g. a double-tap) does not duplicate every fixed bill.
        const billKey = (b: Bill) => `${b.name}|${b.type}|${b.category}|${b.dueDay}`;
        const existingKeys = new Set(m.bills.map(billKey));
        const newBills = billsToCopy
          .filter((b) => !existingKeys.has(billKey(b)))
          .map((b) => ({
            ...b,
            id: uuid(),
            isPaid: false,
            month: selectedMonth.name,
            // Incrementar parcela se for financiamento
            installmentCurrent: b.installmentCurrent ? b.installmentCurrent + 1 : undefined,
          }));
        if (newBills.length === 0) return m;
        return { ...m, bills: [...m.bills, ...newBills] };
      });
    });
  }, [selectedMonth, selectedMonthId]);

  // ====== ADICIONAR NOVO MÊS ======
  const addNextMonth = useCallback(() => {
    setMonths((prev) => {
      const sorted = sortMonths(prev);
      const last = sorted[sorted.length - 1];
      const lastIdx = getMonthIndex(last.name);
      const nextIdx = (lastIdx + 1) % 12;
      const nextYear = nextIdx === 0 ? last.year + 1 : last.year;
      const nextName = MONTH_NAMES[nextIdx];

      // Verificar se já existe
      if (prev.some((m) => m.name.toLowerCase() === nextName.toLowerCase() && m.year === nextYear)) {
        return prev;
      }

      const newMonth: BudgetMonth = {
        id: uuid(),
        name: nextName,
        year: nextYear,
        income: last.income,
        incomeSources: last.incomeSources?.map((source) => ({ ...source, id: uuid() })) ?? [],
        bills: [],
        savingsGoal: last.savingsGoal ?? 0,
        savingsGoalMode: last.savingsGoalMode ?? 'auto',
        savedAmount: 0,
        creditCardDueDay: last.creditCardDueDay,
      };
      return sortMonths([...prev, newMonth]);
    });
  }, []);

  // ====== META DE ECONOMIA ======
  const updateSavingsGoal = useCallback(
    (goal: number) => {
      setMonths((prev) =>
        prev.map((m) => (m.id === selectedMonthId ? { ...m, savingsGoal: goal, savingsGoalMode: 'manual' } : m))
      );
    },
    [selectedMonthId]
  );

  const usePredictedSavingsGoal = useCallback(() => {
    setMonths((prev) => prev.map((m) => (
      m.id === selectedMonthId ? { ...m, savingsGoal: 0, savingsGoalMode: 'auto' } : m
    )));
  }, [selectedMonthId]);

  const updateSavedAmount = useCallback(
    (amount: number) => {
      setMonths((prev) => prev.map((m) => (
        m.id === selectedMonthId ? { ...m, savedAmount: Math.max(0, amount) } : m
      )));
    },
    [selectedMonthId]
  );

  const updateCreditCardDueDay = useCallback(
    (dueDay: number) => {
      setMonths((prev) => {
        const sorted = sortMonths(prev);
        const selectedIndex = sorted.findIndex((month) => month.id === selectedMonthId);
        const nextMonthId = selectedIndex >= 0 ? sorted[selectedIndex + 1]?.id : undefined;
        const normalizedDueDay = Math.max(1, Math.min(31, Math.round(dueDay)));
        return prev.map((month) => (
          month.id === selectedMonthId || month.id === nextMonthId
            ? { ...month, creditCardDueDay: normalizedDueDay }
            : month
        ));
      });
    },
    [selectedMonthId]
  );

  const updateCreditCardCalendarEventId = useCallback(
    (eventId?: string, cardId?: string) => {
      setMonths((prev) => prev.map((month) => {
        if (month.id !== selectedMonthId) return month;
        if (!cardId) return { ...month, creditCardCalendarEventId: eventId };
        const events = { ...(month.creditCardCalendarEventIds ?? {}) };
        // Guardar undefined como chave existiria para sempre no JSON sincronizado.
        if (eventId) events[cardId] = eventId; else delete events[cardId];
        return { ...month, creditCardCalendarEventIds: events };
      }));
    },
    [selectedMonthId]
  );

  const clearCalendarEventIds = useCallback(() => {
    setMonths((prev) => prev.map((month) => ({
      ...month,
      creditCardCalendarEventId: undefined,
      creditCardCalendarEventIds: undefined,
      bills: month.bills.map((bill) => (bill.calendarEventId ? { ...bill, calendarEventId: undefined } : bill)),
    })));
  }, []);

  // ====== CARTÃO DE CRÉDITO ======
  const applyCreditCardPurchase = (
    updated: BudgetMonth[],
    purchase: CreditCardPurchase,
    startName: string,
    startYear: number,
  ): BudgetMonth[] => {
    const count = purchase.installmentTotal - purchase.installmentCurrent + 1;
    const monthInfos = getMonthsFrom(startName, startYear, count);
    // A data é única para a série: todas as parcelas nasceram no mesmo dia da compra.
    const purchaseDate = purchase.dueDay ? formatTransactionDay(purchase.dueDay, getMonthIndex(startName)) : undefined;

    monthInfos.forEach((mi, i) => {
      const installmentNum = purchase.installmentCurrent + i;
      const isDebitPix = purchase.paymentMethod === 'debito_pix';
      const bill: Bill = {
        id: uuid(), name: purchase.name, category: purchase.category, amount: purchase.amount,
        dueDay: purchase.dueDay ?? 1, type: 'variavel', isPaid: false, month: mi.name,
        note: 'Débito/Pix', isOnCreditCard: true, cardPaymentMethod: 'debito_pix',
        installmentCurrent: 1, installmentTotal: 1,
      };
      const invoiceId = cardInvoiceId('manual-invoice', mi.year, mi.name, purchase.cardId);
      const transaction: CreditCardTransaction = {
        id: uuid(), invoiceId, merchant: purchase.name, amountCents: Math.round(purchase.amount * 100),
        type: purchase.installmentTotal > 1 ? 'INSTALLMENT' : 'PURCHASE',
        owner: purchase.owner ?? 'ME', personalAmountCents: purchase.personalAmountCents, thirdPartyName: purchase.thirdPartyName,
        category: purchase.category, installmentCurrent: installmentNum, date: purchaseDate,
        installmentTotal: purchase.installmentTotal, source: 'MANUAL',
      };
      const invoice: CreditCardInvoice = {
        id: invoiceId, month: mi.name, year: mi.year, cardId: purchase.cardId, cardLabel: purchase.cardLabel, transactions: [transaction],
      };
      const mIdx = updated.findIndex(
        (m) => m.name.toLowerCase() === mi.name.toLowerCase() && m.year === mi.year
      );
      if (mIdx === -1) {
        updated = [
          ...updated,
          {
            id: uuid(),
            name: mi.name,
            year: mi.year,
            income: incomeOfPreviousMonth(updated, mi.name, mi.year),
            bills: isDebitPix ? [bill] : [],
            savingsGoal: 0,
            creditCardInvoices: isDebitPix ? [] : [invoice],
          },
        ];
      } else {
        updated = updated.map((m, idx) =>
          idx === mIdx
            ? isDebitPix
              ? { ...m, bills: [...m.bills, bill] }
              : {
                ...m,
                creditCardInvoices: (m.creditCardInvoices ?? []).some((item) => item.id === invoiceId)
                  ? (m.creditCardInvoices ?? []).map((item) => item.id === invoiceId ? { ...item, transactions: [...item.transactions, transaction] } : item)
                  : [...(m.creditCardInvoices ?? []), invoice],
              }
            : m
        );
      }
    });
    return updated;
  };

  const addCreditCardPurchase = useCallback(
    (purchase: CreditCardPurchase) => {
      setMonths((prev) =>
        sortMonths(applyCreditCardPurchase([...prev], purchase, selectedMonth.name, selectedMonth.year))
      );
    },
    [selectedMonth.name, selectedMonth.year]
  );

  const addCreditCardPurchasesBatch = useCallback(
    (purchases: CreditCardPurchase[]) => {
      if (purchases.length === 0) return;
      setMonths((prev) => {
        let updated = [...prev];
        for (const purchase of purchases) {
          updated = applyCreditCardPurchase(updated, purchase, selectedMonth.name, selectedMonth.year);
        }
        return sortMonths(updated);
      });
    },
    [selectedMonth.name, selectedMonth.year]
  );

  const getAffectedMonths = useCallback(
    (installmentCurrent: number, installmentTotal: number): MonthInfo[] => {
      const count = installmentTotal - installmentCurrent + 1;
      return getMonthsFrom(selectedMonth.name, selectedMonth.year, count);
    },
    [selectedMonth.name, selectedMonth.year]
  );

  // ====== PAGAR CARTÃO DE CRÉDITO (tudo de uma vez, ou um cartão só) ======
  /** `invoiceIds` marca somente aquelas faturas. `billIds` marca somente aquelas contas do
   *  cartão; sem os dois, é o "pagar tudo" de sempre. */
  const payCreditCard = useCallback((invoiceIds?: string[], billIds?: string[]) => {
    if (!invoiceIds) {
      setMonths((prev) =>
        prev.map((m) => {
          if (m.id !== selectedMonthId) return m;
          return {
            ...m,
            creditCardInvoices: (m.creditCardInvoices ?? []).map((invoice) => ({ ...invoice, isPaid: true })),
            bills: m.bills.map((b) => (isOnCreditCardBill(b) ? { ...b, isPaid: true } : b)),
          };
        })
      );
      return;
    }
    const only = new Set(invoiceIds);
    const onlyBills = new Set(billIds ?? []);
    setMonths((prev) =>
      prev.map((m) => {
        if (m.id !== selectedMonthId) return m;
        return {
          ...m,
          creditCardInvoices: (m.creditCardInvoices ?? []).map((invoice) => (
            only.has(invoice.id) ? { ...invoice, isPaid: true } : invoice
          )),
          bills: m.bills.map((b) => (onlyBills.has(b.id) ? { ...b, isPaid: true } : b)),
        };
      })
    );
  }, [selectedMonthId]);

  // ====== DESFAZER PAGAMENTO DO CARTÃO ======
  const unpayCreditCard = useCallback((invoiceIds?: string[], billIds?: string[]) => {
    if (!invoiceIds) {
      setMonths((prev) =>
        prev.map((m) => {
          if (m.id !== selectedMonthId) return m;
          return {
            ...m,
            creditCardInvoices: (m.creditCardInvoices ?? []).map((invoice) => ({ ...invoice, isPaid: false })),
            bills: m.bills.map((b) => (isOnCreditCardBill(b) ? { ...b, isPaid: false } : b)),
          };
        })
      );
      return;
    }
    const only = new Set(invoiceIds);
    const onlyBills = new Set(billIds ?? []);
    setMonths((prev) =>
      prev.map((m) => {
        if (m.id !== selectedMonthId) return m;
        return {
          ...m,
          creditCardInvoices: (m.creditCardInvoices ?? []).map((invoice) => (
            only.has(invoice.id) ? { ...invoice, isPaid: false } : invoice
          )),
          bills: m.bills.map((b) => (onlyBills.has(b.id) ? { ...b, isPaid: false } : b)),
        };
      })
    );
  }, [selectedMonthId]);

  /** `forceDuplicateIds` são as linhas que o usuário reconheceu como repetidas e mesmo assim
   *  mandou lançar (duas cervejas de R$ 12 no mesmo dia). Sem isso, reimportar a mesma fatura
   *  continuaria sem contar nada duas vezes. */
  const addCreditCardInvoice = useCallback((invoice: CreditCardInvoice, forceDuplicateIds: string[] = []) => {
    setMonths((prev) => {
      // Uma fatura importada por cartão e mês: o id é derivado deles, então reimportar a mesma
      // fatura consolida as linhas na mesma fatura em vez de criar outra com o mesmo
      // statementTotalCents (que aparecia dobrado no total do cartão).
      const invoiceId = cardInvoiceId('imported-invoice', invoice.year, invoice.month, invoice.cardId);
      const normalized: CreditCardInvoice = {
        ...invoice,
        id: invoiceId,
        transactions: invoice.transactions.map((tx) => ({ ...tx, invoiceId })),
      };
      // Reimportar a mesma fatura não pode contar o lançamento duas vezes no mês. Duas linhas
      // idênticas no MESMO lote são compras diferentes (duas cervejas no mesmo dia), então aqui
      // não se descarta nada dentro do lote: passa pela comparação com o que já está salvo
      // apenas a linha que o usuário marcou como "é outra compra".
      const target = prev.find((month) => month.id === selectedMonthId);
      const forced = new Set(forceDuplicateIds);
      const freshTransactions = normalized.transactions.filter((tx) => (
        forced.has(tx.id) || !target || !hasSameCardTransaction(target, tx, invoice.cardId)
      ));
      let updated = prev.map((month) => {
        if (month.id !== selectedMonthId) return month;
        if (freshTransactions.length === 0) return month;
        const merged: CreditCardInvoice = { ...normalized, transactions: freshTransactions };
        const existingIndex = (month.creditCardInvoices ?? []).findIndex((item) => item.id === merged.id);
        const invoices = existingIndex === -1
          ? [...(month.creditCardInvoices ?? []), merged]
          : (month.creditCardInvoices ?? []).map((item, idx) => idx === existingIndex
            ? {
              ...item,
              statementTotalCents: item.statementTotalCents ?? merged.statementTotalCents,
              transactions: [...item.transactions, ...freshTransactions],
            }
            : item);
        return { ...month, creditCardInvoices: invoices };
      });

      // A fatura importada só traz as parcelas cobradas no mês atual. Uma compra
      // "4/5" importa apenas a 4/5; as demais (5/5) precisam ser lançadas nos
      // meses seguintes, espelhando o comportamento do "Lançar compra no cartão".
      const startName = invoice.month;
      const startYear = invoice.year;
      invoice.transactions.forEach((tx) => {
        const cur = tx.installmentCurrent ?? 1;
        const total = tx.installmentTotal ?? 1;
        if (total <= cur) return;
        const futureMonths = getMonthsFrom(startName, startYear, total - cur + 1).slice(1);
        futureMonths.forEach((mi, i) => {
          const installmentNum = cur + 1 + i;
          const invoiceId = cardInvoiceId('manual-invoice', mi.year, mi.name, invoice.cardId);
          const futureTx: CreditCardTransaction = { ...tx, id: uuid(), invoiceId, installmentCurrent: installmentNum };
          const futureInvoice: CreditCardInvoice = {
            id: invoiceId, month: mi.name, year: mi.year, cardId: invoice.cardId, cardLabel: invoice.cardLabel, transactions: [futureTx],
          };
          const mIdx = updated.findIndex(
            (m) => m.name.toLowerCase() === mi.name.toLowerCase() && m.year === mi.year
          );
          // Evita duplicar ao reimportar a mesma fatura ou ao importar depois a
          // fatura real do mês seguinte: pula se a parcela já existir no mês.
          const alreadyExists = !forced.has(tx.id) && mIdx !== -1 && hasSameCardTransaction(updated[mIdx], futureTx, invoice.cardId);
          if (alreadyExists) return;
          if (mIdx === -1) {
            updated = [
              ...updated,
              {
                id: uuid(),
                name: mi.name,
                year: mi.year,
                income: incomeOfPreviousMonth(updated, mi.name, mi.year),
                bills: [],
                savingsGoal: 0,
                creditCardInvoices: [futureInvoice],
              },
            ];
          } else {
            updated = updated.map((m, idx) =>
              idx === mIdx
                ? {
                  ...m,
                  creditCardInvoices: (m.creditCardInvoices ?? []).some((inv) => inv.id === invoiceId)
                    ? (m.creditCardInvoices ?? []).map((inv) => inv.id === invoiceId ? { ...inv, transactions: [...inv.transactions, futureTx] } : inv)
                    : [...(m.creditCardInvoices ?? []), futureInvoice],
                }
                : m
            );
          }
        });
      });

      return sortMonths(updated);
    });
  }, [selectedMonthId]);

  const updateCreditCardInvoice = useCallback((invoice: CreditCardInvoice) => {
    setMonths((prev) => prev.map((month) => (
      month.id === selectedMonthId
        ? { ...month, creditCardInvoices: (month.creditCardInvoices ?? []).map((item) => item.id === invoice.id ? invoice : item) }
        : month
    )));
  }, [selectedMonthId]);

  /** Corrigir categoria e dono de lançamentos já importados, sem tocar nas demais linhas. */
  const patchCreditCardTransactions = useCallback((
    transactionIds: string[],
    patch: Partial<Pick<CreditCardTransaction, 'category' | 'owner' | 'thirdPartyName' | 'personalAmountCents'>>,
  ) => {
    const only = new Set(transactionIds);
    if (only.size === 0) return;
    setMonths((prev) => prev.map((month) => (
      month.id === selectedMonthId
        ? {
          ...month,
          creditCardInvoices: (month.creditCardInvoices ?? []).map((invoice) => ({
            ...invoice,
            transactions: invoice.transactions.map((tx) => (only.has(tx.id) ? { ...tx, ...patch } : tx)),
          })),
        }
        : month
    )));
  }, [selectedMonthId]);

  /** Trocar o cartão que cobra estes lançamentos — é a operação "o resto das compras é do 8649".
   *  O destino usa o mesmo id que a importação daquele cartão e mês geraria, então reimportar o
   *  extrato depois consolida na mesma fatura em vez de duplicar nada. */
  const moveCreditCardTransactions = useCallback((transactionIds: string[], target: CardMoveTarget) => {
    const only = new Set(transactionIds);
    if (only.size === 0) return;
    setMonths((prev) => prev.map((month) => {
      if (month.id !== selectedMonthId) return month;
      const moved: CreditCardTransaction[] = [];
      const stripped: CreditCardInvoice[] = [];
      (month.creditCardInvoices ?? []).forEach((invoice) => {
        const keep = invoice.transactions.filter((tx) => !only.has(tx.id));
        if (keep.length === invoice.transactions.length) {
          stripped.push(invoice);
          return;
        }
        moved.push(...invoice.transactions.filter((tx) => only.has(tx.id)));
        if (keep.length === 0) return;
        // Tirou linha da fatura: o total do extrato do banco não é mais o total desta fatura, então
        // ele sai e a soma passa a ser a dos lançamentos que ficaram — senão o cartão cobriria duas vezes.
        stripped.push({ ...invoice, transactions: keep, statementTotalCents: undefined });
      });
      if (moved.length === 0) return month;
      const movedTransactions = moved.map((tx) => ({ ...tx, invoiceId: target.invoiceId }));
      const existingIndex = stripped.findIndex((invoice) => invoice.id === target.invoiceId);
      const creditCardInvoices = existingIndex === -1
        ? [...stripped, {
          id: target.invoiceId,
          month: month.name,
          year: month.year,
          cardId: target.cardId,
          cardLabel: target.cardLabel,
          transactions: movedTransactions,
        }]
        : stripped.map((invoice, index) => (
          index === existingIndex ? { ...invoice, transactions: [...invoice.transactions, ...movedTransactions] } : invoice
        ));
      return { ...month, creditCardInvoices };
    }));
  }, [selectedMonthId]);

  const resetData = useCallback(() => {
    removeUserStorage(userId, STORAGE_KEY);
    removeUserStorage(userId, SELECTED_KEY);
    setMonths(sampleMonths);
    setSelectedMonthId(sampleMonths[0].id);
  }, [userId]);

  // Exportar todos os dados como JSON
  const exportData = useCallback(() => {
    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      months,
      selectedMonthId,
      chatHistory: undefined,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `financa-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [months, selectedMonthId]);

  // Importar dados de um arquivo JSON
  const importData = useCallback((file: File): Promise<boolean> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const raw = e.target?.result;
          if (typeof raw !== 'string') { resolve(false); return; }
          const data = JSON.parse(raw);
          if (!data.months || !Array.isArray(data.months) || data.months.length === 0) { resolve(false); return; }
          const imported = sortMonths(migrateMonths(data.months as BudgetMonth[]));
          setMonths(imported);
          setSelectedMonthId(imported.some((month) => month.id === data.selectedMonthId) ? data.selectedMonthId : imported[0].id);
          resolve(true);
        } catch {
          resolve(false);
        }
      };
      reader.onerror = () => resolve(false);
      reader.readAsText(file);
    });
  }, []);

  return {
    months,
    selectedMonth,
    selectedMonthId,
    selectMonth,
    billsSorted,
    fixedBills,
    debitPixBills,
    variableBills,
    totalPlanned,
    totalPaid,
    remaining,
    saveBill,
    reclassifyBills,
    addBill,
    deleteBill,
    togglePaid,
    updateIncome,
    updateIncomeSources,
    addCreditCardPurchase,
    addCreditCardPurchasesBatch,
    getAffectedMonths,
    copyFixedBillsFromPrevious,
    addNextMonth,
    updateSavingsGoal,
    usePredictedSavingsGoal,
    updateSavedAmount,
    updateCreditCardDueDay,
    updateCreditCardCalendarEventId,
    clearCalendarEventIds,
    payCreditCard,
    unpayCreditCard,
    addCreditCardInvoice,
    updateCreditCardInvoice,
    patchCreditCardTransactions,
    moveCreditCardTransactions,
    resetData,
    exportData,
    importData,
    syncError,
    isRefreshing,
    lastSyncedAt,
    syncNotice,
    refreshData,
    formatCurrency,
  };
}
