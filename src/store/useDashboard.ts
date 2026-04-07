import { useState, useCallback, useEffect } from 'react';
import { type Bill, type BudgetMonth, type BillCategory, formatCurrency } from '../types';
import { sampleMonths } from '../data/sampleData';

const STORAGE_KEY = 'financa_months_v1';
const SELECTED_KEY = 'financa_selected_v1';

function loadMonths(): BudgetMonth[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as BudgetMonth[];
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

export const MONTH_SEQUENCE = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function getMonthsFrom(startName: string, count: number): string[] {
  const idx = MONTH_SEQUENCE.findIndex(
    (m) => m.toLowerCase() === startName.toLowerCase()
  );
  const start = idx === -1 ? 0 : idx;
  return Array.from({ length: count }, (_, i) => MONTH_SEQUENCE[(start + i) % 12]);
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
  const [months, setMonths] = useState<BudgetMonth[]>(loadMonths);
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

  const addCreditCardPurchase = useCallback(
    (purchase: CreditCardPurchase) => {
      const count = purchase.installmentTotal - purchase.installmentCurrent + 1;
      const monthNames = getMonthsFrom(selectedMonth.name, count);

      setMonths((prev) => {
        let updated = [...prev];
        monthNames.forEach((monthName, i) => {
          const installmentNum = purchase.installmentCurrent + i;
          const bill: Bill = {
            id: uuid(),
            name: purchase.name,
            category: purchase.category,
            amount: purchase.amount,
            dueDay: purchase.dueDay,
            type: 'parcela',
            isPaid: false,
            month: monthName,
            note: 'Cartão de crédito',
            installmentCurrent: installmentNum,
            installmentTotal: purchase.installmentTotal,
          };
          const mIdx = updated.findIndex(
            (m) => m.name.toLowerCase() === monthName.toLowerCase()
          );
          if (mIdx === -1) {
            updated = [
              ...updated,
              {
                id: uuid(),
                name: monthName,
                income: updated[updated.length - 1]?.income ?? 8000,
                bills: [bill],
              },
            ];
          } else {
            updated = updated.map((m, idx) =>
              idx === mIdx ? { ...m, bills: [...m.bills, bill] } : m
            );
          }
        });
        return updated;
      });
    },
    [selectedMonth.name]
  );

  const getAffectedMonths = useCallback(
    (installmentCurrent: number, installmentTotal: number): string[] => {
      const count = installmentTotal - installmentCurrent + 1;
      return getMonthsFrom(selectedMonth.name, count);
    },
    [selectedMonth.name]
  );

  const resetData = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SELECTED_KEY);
    setMonths(sampleMonths);
    setSelectedMonthId(sampleMonths[0].id);
  }, []);

  // Exportar todos os dados como JSON
  const exportData = useCallback(() => {
    const data = {
      version: 1,
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
          setMonths(data.months);
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
    getAffectedMonths,
    resetData,
    exportData,
    importData,
    formatCurrency,
  };
}
