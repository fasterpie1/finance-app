import type { BudgetMonth } from '../types';

export const sampleMonths: BudgetMonth[] = [
  {
    id: '1',
    name: 'Abril',
    income: 8000,
    bills: [
      { id: 'a1', name: 'Luz', category: 'luz', amount: 200, dueDay: 7, type: 'mensal', isPaid: true, month: 'Abril', note: '' },
      { id: 'a2', name: 'Água', category: 'agua', amount: 66.04, dueDay: 10, type: 'mensal', isPaid: true, month: 'Abril', note: '' },
      { id: 'a3', name: 'Internet', category: 'internet', amount: 287, dueDay: 12, type: 'mensal', isPaid: true, month: 'Abril', note: '' },
      { id: 'a4', name: 'Gás', category: 'gas', amount: 397.39, dueDay: 15, type: 'mensal', isPaid: false, month: 'Abril', note: '' },
      { id: 'a5', name: 'Condomínio', category: 'condominio', amount: 695.92, dueDay: 20, type: 'mensal', isPaid: false, month: 'Abril', note: '' },
      { id: 'a6', name: 'Financiamento', category: 'financiamento', amount: 330, dueDay: 25, type: 'parcela', isPaid: false, month: 'Abril', note: '', installmentCurrent: 34, installmentTotal: 48 },
      { id: 'a7', name: 'Limpeza', category: 'limpeza', amount: 461.22, dueDay: 28, type: 'fixa', isPaid: false, month: 'Abril', note: '' },
    ],
  },
  {
    id: '2',
    name: 'Maio',
    income: 8000,
    bills: [
      { id: 'b1', name: 'Luz', category: 'luz', amount: 210, dueDay: 7, type: 'mensal', isPaid: false, month: 'Maio', note: '' },
      { id: 'b2', name: 'Água', category: 'agua', amount: 70, dueDay: 10, type: 'mensal', isPaid: false, month: 'Maio', note: '' },
      { id: 'b3', name: 'Internet', category: 'internet', amount: 287, dueDay: 12, type: 'mensal', isPaid: false, month: 'Maio', note: '' },
      { id: 'b4', name: 'Gás', category: 'gas', amount: 150, dueDay: 15, type: 'mensal', isPaid: false, month: 'Maio', note: '' },
      { id: 'b5', name: 'Financiamento', category: 'financiamento', amount: 330, dueDay: 20, type: 'parcela', isPaid: false, month: 'Maio', note: '', installmentCurrent: 35, installmentTotal: 48 },
      { id: 'b6', name: 'Reserva', category: 'outros', amount: 500, dueDay: 22, type: 'variavel', isPaid: false, month: 'Maio', note: 'Meta mensal' },
    ],
  },
  {
    id: '3',
    name: 'Junho',
    income: 8000,
    bills: [],
  },
];
