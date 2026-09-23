import { useState, useCallback, useEffect, useRef } from 'react';
import { type Bill, type BudgetMonth, type BillCategory, type CardPaymentMethod, type CreditCardInvoice, type CreditCardTransaction, type IncomeSource, MONTH_NAMES, getMonthIndex, formatCurrency } from '../types';
import { sampleMonths } from '../data/sampleData';
import { supabase } from '../services/supabase';
import { readUserStorage, removeUserStorage, writeUserStorage } from '../services/userStorage';
import { centsToAmount, getInvoicePersonalTotalCents } from '../services/cardTransactions';

const STORAGE_KEY = 'financa_months_v1';
const SELECTED_KEY = 'financa_selected_v1';

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

function isCreditCardBill(bill: Bill): boolean {
  return bill.isOnCreditCard === true
    || (bill.type === 'parcela' && bill.category !== 'financiamento' && bill.cardPaymentMethod !== 'debito_pix');
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

export function getBillNotifications(months: BudgetMonth[], today = new Date()): BillNotification[] {
  const currentDate = dateAtMidnight(today);
  const dayMs = 24 * 60 * 60 * 1000;

  return months.flatMap((month) => {
    const notifications: BillNotification[] = [];
    // Card purchases live in creditCardInvoices now (legacy bills are migrated on
    // load), so the invoice reminder must be derived from unpaid invoices rather
    // than from month.bills, which no longer carries card data.
    const unpaidInvoices = (month.creditCardInvoices ?? []).filter((invoice) => !invoice.isPaid);

    if (unpaidInvoices.length > 0 && month.creditCardDueDay) {
      const dueDate = nextMonthDate(month, month.creditCardDueDay);
      const daysUntilDue = Math.round((dueDate.getTime() - currentDate.getTime()) / dayMs);
      notifications.push({
        billId: `credit-card-invoice-${month.id}`,
        name: 'Fatura do cartão',
        amount: centsToAmount(unpaidInvoices.reduce((total, invoice) => total + getInvoicePersonalTotalCents(invoice), 0)),
        dueDate,
        daysUntilDue,
        isOverdue: daysUntilDue < 0,
        plannedMonth: `${month.name} ${month.year}`,
      });
    }

    notifications.push(...month.bills
      .filter((bill) => !bill.isPaid && bill.cardPaymentMethod !== 'debito_pix' && !isCreditCardBill(bill))
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

export interface CreditCardPurchase {
  name: string;
  amount: number;
  dueDay?: number;
  category: BillCategory;
  installmentCurrent: number;
  installmentTotal: number;
  paymentMethod?: CardPaymentMethod;
  owner?: 'ME' | 'THIRD_PARTY' | 'SHARED' | 'UNCLASSIFIED';
  personalAmountCents?: number;
  thirdPartyName?: string;
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
        setSyncError(`Falha ao carregar dados: ${error.message}`);
      } else if (data?.months && Array.isArray(data.months) && data.months.length > 0) {
        const remoteMonths = sortMonths(migrateMonths(data.months as BudgetMonth[]));
        setMonths(remoteMonths);
        setSelectedMonthId(loadSelectedId(remoteMonths));
        setLastSyncedAt(data.updated_at ? new Date(data.updated_at) : new Date());
        setRemoteRevision(data.revision ?? 0);
        remoteRevisionRef.current = data.revision ?? 0;
        setSyncError(null);
      } else {
        const { error: insertError } = await client.from('user_finance_data').upsert({ user_id: userId, months: sampleMonths, selected_month_id: sampleMonths[0].id, revision: 0 });
        if (insertError) {
          console.error('Falha ao criar dados do usuário no Supabase:', insertError);
          setSyncError(`Falha ao criar dados: ${insertError.message}`);
        } else {
          setSyncError(null);
        }
      }
      remoteLoaded.current = true;
    };
    void loadRemote();
  }, [userId]);

  const refreshData = useCallback(async () => {
    if (!supabase || !userId || isRefreshing) return;
    setIsRefreshing(true);
    const { data, error } = await supabase.from('user_finance_data').select('months, selected_month_id, updated_at, revision').eq('user_id', userId).maybeSingle();
    if (error) {
      console.error('Falha ao atualizar dados do Supabase:', error);
      setSyncError(`Falha ao atualizar dados: ${error.message}`);
    } else if (data?.months && Array.isArray(data.months) && data.months.length > 0) {
      const remoteMonths = sortMonths(migrateMonths(data.months as BudgetMonth[]));
      const hasChanges = JSON.stringify(months) !== JSON.stringify(remoteMonths);
      setMonths(remoteMonths);
      setSelectedMonthId(loadSelectedId(remoteMonths));
      setLastSyncedAt(data.updated_at ? new Date(data.updated_at) : new Date());
      setRemoteRevision(data.revision ?? 0);
      remoteRevisionRef.current = data.revision ?? 0;
      setSyncNotice(hasChanges ? 'Alterações de outro dispositivo carregadas' : 'Nenhuma alteração nova');
      setSyncError(null);
    }
    setIsRefreshing(false);
  }, [isRefreshing, months, userId]);

  // Salvar automaticamente sempre que mudar
  useEffect(() => {
    if (!remoteLoaded.current) return;
    writeUserStorage(userId, STORAGE_KEY, JSON.stringify(months));
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
          setSyncError('Conflito de sincronização: os dados mudaram em outro dispositivo. Atualize antes de salvar novamente.');
        } else {
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
  const creditCardBills = billsSorted.filter(
    (b) => b.type === 'parcela' && b.category !== 'financiamento'
  );
  const debitPixBills = billsSorted.filter(
    (b) => b.isOnCreditCard === true && b.cardPaymentMethod === 'debito_pix'
  );
  const variableBills = billsSorted.filter((b) => b.type === 'variavel' && b.cardPaymentMethod !== 'debito_pix');

  const invoicePersonalTotal = (selectedMonth.creditCardInvoices ?? []).reduce(
    (total, invoice) => total + centsToAmount(getInvoicePersonalTotalCents(invoice)), 0
  );
  const invoicePersonalPaid = (selectedMonth.creditCardInvoices ?? [])
    .filter((invoice) => invoice.isPaid)
    .reduce((total, invoice) => total + centsToAmount(getInvoicePersonalTotalCents(invoice)), 0);
  const totalPlanned = selectedMonth.bills.reduce((s, b) => s + b.amount, 0) + invoicePersonalTotal;
  // Débito/pix é deduzido da conta na hora da compra (não depende de pagar a fatura)
  // e não tem toggle de pago na UI (showPaidToggle={false}), então conta como pago
  // independentemente do `isPaid` armazenado, que permanece false desde a criação.
  const totalPaid = selectedMonth.bills.filter((b) => b.isPaid || b.cardPaymentMethod === 'debito_pix').reduce((s, b) => s + b.amount, 0) + invoicePersonalPaid;
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
    (eventId?: string) => {
      setMonths((prev) => prev.map((month) => (
        month.id === selectedMonthId ? { ...month, creditCardCalendarEventId: eventId } : month
      )));
    },
    [selectedMonthId]
  );

  const clearCalendarEventIds = useCallback(() => {
    setMonths((prev) => prev.map((month) => ({
      ...month,
      creditCardCalendarEventId: undefined,
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

    monthInfos.forEach((mi, i) => {
      const installmentNum = purchase.installmentCurrent + i;
      const isDebitPix = purchase.paymentMethod === 'debito_pix';
      const bill: Bill = {
        id: uuid(), name: purchase.name, category: purchase.category, amount: purchase.amount,
        dueDay: purchase.dueDay ?? 1, type: 'variavel', isPaid: false, month: mi.name,
        note: 'Débito/Pix', isOnCreditCard: true, cardPaymentMethod: 'debito_pix',
        installmentCurrent: 1, installmentTotal: 1,
      };
      const invoiceId = `manual-invoice-${mi.year}-${mi.name}`;
      const transaction: CreditCardTransaction = {
        id: uuid(), invoiceId, merchant: purchase.name, amountCents: Math.round(purchase.amount * 100),
        type: purchase.installmentTotal > 1 ? 'INSTALLMENT' : 'PURCHASE',
        owner: purchase.owner ?? 'ME', personalAmountCents: purchase.personalAmountCents, thirdPartyName: purchase.thirdPartyName,
        category: purchase.category, installmentCurrent: installmentNum,
        installmentTotal: purchase.installmentTotal, source: 'MANUAL',
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
            income: updated[updated.length - 1]?.income ?? 8000,
            bills: isDebitPix ? [bill] : [],
            savingsGoal: 0,
            creditCardInvoices: isDebitPix ? [] : [{ id: invoiceId, month: mi.name, year: mi.year, transactions: [transaction] }],
          },
        ];
      } else {
        updated = updated.map((m, idx) =>
          idx === mIdx
            ? isDebitPix
              ? { ...m, bills: [...m.bills, bill] }
              : {
                ...m,
                creditCardInvoices: (m.creditCardInvoices ?? []).some((invoice) => invoice.id === invoiceId)
                  ? (m.creditCardInvoices ?? []).map((invoice) => invoice.id === invoiceId ? { ...invoice, transactions: [...invoice.transactions, transaction] } : invoice)
                  : [...(m.creditCardInvoices ?? []), { id: invoiceId, month: mi.name, year: mi.year, transactions: [transaction] }],
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

  // ====== PAGAR CARTÃO DE CRÉDITO (tudo de uma vez) ======
  const payCreditCard = useCallback(() => {
    setMonths((prev) =>
      prev.map((m) => {
        if (m.id !== selectedMonthId) return m;
        return {
          ...m,
          creditCardInvoices: (m.creditCardInvoices ?? []).map((invoice) => ({ ...invoice, isPaid: true })),
          bills: m.bills.map((b) => {
            // Marca parcelas do cartão como pagas
            const isCreditCardBill = b.type === 'parcela' && b.category !== 'financiamento' && b.cardPaymentMethod !== 'debito_pix';
            // Marca contas fixas vinculadas ao cartão como pagas. Débito/pix não
            // faz parte da fatura do cartão, então não deve ser marcado aqui.
            const isLinkedFixed = b.isOnCreditCard === true && b.cardPaymentMethod !== 'debito_pix';
            if (isCreditCardBill || isLinkedFixed) {
              return { ...b, isPaid: true };
            }
            return b;
          }),
        };
      })
    );
  }, [selectedMonthId]);

  // ====== DESFAZER PAGAMENTO DO CARTÃO ======
  const unpayCreditCard = useCallback(() => {
    setMonths((prev) =>
      prev.map((m) => {
        if (m.id !== selectedMonthId) return m;
        return {
          ...m,
          creditCardInvoices: (m.creditCardInvoices ?? []).map((invoice) => ({ ...invoice, isPaid: false })),
          bills: m.bills.map((b) => {
            const isCreditCardBill = b.type === 'parcela' && b.category !== 'financiamento' && b.cardPaymentMethod !== 'debito_pix';
            const isLinkedFixed = b.isOnCreditCard === true && b.cardPaymentMethod !== 'debito_pix';
            if (isCreditCardBill || isLinkedFixed) {
              return { ...b, isPaid: false };
            }
            return b;
          }),
        };
      })
    );
  }, [selectedMonthId]);

  const addCreditCardInvoice = useCallback((invoice: CreditCardInvoice) => {
    setMonths((prev) => prev.map((month) => (
      month.id === selectedMonthId
        ? { ...month, creditCardInvoices: [...(month.creditCardInvoices ?? []), invoice] }
        : month
    )));
  }, [selectedMonthId]);

  const updateCreditCardInvoice = useCallback((invoice: CreditCardInvoice) => {
    setMonths((prev) => prev.map((month) => (
      month.id === selectedMonthId
        ? { ...month, creditCardInvoices: (month.creditCardInvoices ?? []).map((item) => item.id === invoice.id ? invoice : item) }
        : month
    )));
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
          if (!data.months || !Array.isArray(data.months)) { resolve(false); return; }
          setMonths(sortMonths(migrateMonths(data.months)));
          if (data.selectedMonthId) setSelectedMonthId(data.selectedMonthId);
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
    creditCardBills,
    debitPixBills,
    variableBills,
    totalPlanned,
    totalPaid,
    remaining,
    saveBill,
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
