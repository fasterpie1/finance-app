import { useState, useCallback, useEffect } from 'react';
import { type Bill, type BudgetMonth, type BillCategory, MONTH_NAMES, getMonthIndex, formatCurrency } from '../types';
import { sampleMonths } from '../data/sampleData';

const STORAGE_KEY = 'financa_months_v1';
const SELECTED_KEY = 'financa_selected_v1';

/** Migra dados antigos (sem year) para o novo formato */
function migrateMonths(months: BudgetMonth[]): BudgetMonth[] {
  const currentYear = new Date().getFullYear();
  return months.map((m) => ({
    ...m,
    year: m.year || currentYear,
    savingsGoal: m.savingsGoal ?? 0,
  }));
}

function loadMonths(): BudgetMonth[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateMonths(JSON.parse(raw) as BudgetMonth[]);
  } catch { /* ignore */ }
  return sampleMonths;
}

function loadSelectedId(months: BudgetMonth[]): string {
  try {
    const saved = localStorage.getItem(SELECTED_KEY);
    if (saved && months.some((m) => m.id === saved)) return saved;
  } catch { /* ignore */ }
  return months[0].id;
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
  dueDay: number;
  category: BillCategory;
  installmentCurrent: number;
  installmentTotal: number;
}

export function useDashboard() {
  const [months, setMonths] = useState<BudgetMonth[]>(() => sortMonths(loadMonths()));
  const [selectedMonthId, setSelectedMonthId] = useState<string>(() => loadSelectedId(loadMonths()));

  // Salvar automaticamente sempre que mudar
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(months));
  }, [months]);

  useEffect(() => {
    localStorage.setItem(SELECTED_KEY, selectedMonthId);
  }, [selectedMonthId]);

  const selectedMonth = months.find((m) => m.id === selectedMonthId) ?? months[0];

  const billsSorted = [...selectedMonth.bills].sort((a, b) => a.dueDay - b.dueDay);
  // Financiamento é conta fixa mensal; parcelas de cartão são separadas
  const fixedBills = billsSorted.filter(
    (b) => b.type === 'mensal' || b.type === 'fixa' || (b.type === 'parcela' && b.category === 'financiamento')
  );
  const creditCardBills = billsSorted.filter(
    (b) => b.type === 'parcela' && b.category !== 'financiamento'
  );
  const variableBills = billsSorted.filter((b) => b.type === 'variavel');

  const totalPlanned = selectedMonth.bills.reduce((s, b) => s + b.amount, 0);
  const totalPaid = selectedMonth.bills.filter((b) => b.isPaid).reduce((s, b) => s + b.amount, 0);
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
        const newBills = billsToCopy.map((b) => ({
          ...b,
          id: uuid(),
          isPaid: false,
          month: selectedMonth.name,
          // Incrementar parcela se for financiamento
          installmentCurrent: b.installmentCurrent ? b.installmentCurrent + 1 : undefined,
        }));
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
        bills: [],
        savingsGoal: last.savingsGoal ?? 0,
      };
      return sortMonths([...prev, newMonth]);
    });
  }, []);

  // ====== META DE ECONOMIA ======
  const updateSavingsGoal = useCallback(
    (goal: number) => {
      setMonths((prev) =>
        prev.map((m) => (m.id === selectedMonthId ? { ...m, savingsGoal: goal } : m))
      );
    },
    [selectedMonthId]
  );

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
      const bill: Bill = {
        id: uuid(),
        name: purchase.name,
        category: purchase.category,
        amount: purchase.amount,
        dueDay: purchase.dueDay,
        type: 'parcela',
        isPaid: false,
        month: mi.name,
        note: 'Cartão de crédito',
        installmentCurrent: installmentNum,
        installmentTotal: purchase.installmentTotal,
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
            bills: [bill],
            savingsGoal: 0,
          },
        ];
      } else {
        updated = updated.map((m, idx) =>
          idx === mIdx ? { ...m, bills: [...m.bills, bill] } : m
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
          bills: m.bills.map((b) => {
            // Marca parcelas do cartão como pagas
            const isCreditCardBill = b.type === 'parcela' && b.category !== 'financiamento';
            // Marca contas fixas vinculadas ao cartão como pagas
            const isLinkedFixed = b.isOnCreditCard === true;
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
          bills: m.bills.map((b) => {
            const isCreditCardBill = b.type === 'parcela' && b.category !== 'financiamento';
            const isLinkedFixed = b.isOnCreditCard === true;
            if (isCreditCardBill || isLinkedFixed) {
              return { ...b, isPaid: false };
            }
            return b;
          }),
        };
      })
    );
  }, [selectedMonthId]);

  const resetData = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SELECTED_KEY);
    setMonths(sampleMonths);
    setSelectedMonthId(sampleMonths[0].id);
  }, []);

  // Exportar todos os dados como JSON
  const exportData = useCallback(() => {
    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      months,
      selectedMonthId,
      chatHistory: localStorage.getItem('finance_chat_history') || '[]',
      groqKey: localStorage.getItem('groq_api_key') || '',
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
          if (data.chatHistory) localStorage.setItem('finance_chat_history', data.chatHistory);
          if (data.groqKey) localStorage.setItem('groq_api_key', data.groqKey);
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
    variableBills,
    totalPlanned,
    totalPaid,
    remaining,
    saveBill,
    addBill,
    deleteBill,
    togglePaid,
    updateIncome,
    addCreditCardPurchase,
    addCreditCardPurchasesBatch,
    getAffectedMonths,
    copyFixedBillsFromPrevious,
    addNextMonth,
    updateSavingsGoal,
    payCreditCard,
    unpayCreditCard,
    resetData,
    exportData,
    importData,
    formatCurrency,
  };
}
