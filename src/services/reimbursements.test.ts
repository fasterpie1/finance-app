// @vitest-environment node
import { isValidElement, type ChangeEvent, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetMonth, CreditCardTransaction, ReimbursementReceipt } from '../types';
import { getCardCharges, getMonthPlannedCents, getThirdPartyTotalsCents } from './cardTransactions';
import { addReimbursementReceipt, getReimbursementBalances, isValidReimbursementDate, removeReimbursementReceipt } from './reimbursements';
import { ReimbursementPanel, type ReimbursementPanelProps } from '../components/ReimbursementPanel';

function tx(overrides: Partial<CreditCardTransaction> = {}): CreditCardTransaction {
  return { id: 'tx-test', invoiceId: 'invoice-test', merchant: 'LOJA FICTÍCIA', amountCents: 10000,
    type: 'PURCHASE', owner: 'THIRD_PARTY', thirdPartyName: 'Pessoa Teste', ...overrides };
}
function receipt(overrides: Partial<ReimbursementReceipt> = {}): ReimbursementReceipt {
  return { id: 'receipt-test', personName: 'Pessoa Teste', amountCents: 3000, date: '2026-10-15', ...overrides };
}
function month(overrides: Partial<BudgetMonth> = {}): BudgetMonth {
  return { id: 'month-test', name: 'Outubro', year: 2026, income: 2000, bills: [],
    creditCardInvoices: [{ id: 'invoice-test', month: 'Outubro', year: 2026, transactions: [tx()] }], ...overrides };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
const transactionsOf = (value: BudgetMonth) => (value.creditCardInvoices ?? []).flatMap((invoice) => invoice.transactions);
const balancesOf = (value: BudgetMonth) => getReimbursementBalances(transactionsOf(value), value.reimbursementReceipts ?? []);

// Local handler harness: no DOM, persistence, network, environment files or real data.
const hooks = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
const preferences = vi.hoisted(() => ({ locale: 'pt-BR' as 'pt-BR' | 'en', money: vi.fn<(value: number) => string>() }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return { ...actual, useId: () => 'reimbursement-test', useState: <T,>(initial: T | (() => T)) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [hooks.values[index] as T, (next: T | ((previous: T) => T)) => {
      hooks.values[index] = typeof next === 'function' ? (next as (previous: T) => T)(hooks.values[index] as T) : next;
    }] as const;
  } };
});
vi.mock('../i18n', () => ({ usePreferences: () => ({
  locale: preferences.locale,
  t: (key: string) => ({ save: preferences.locale === 'en' ? 'Save' : 'Salvar',
    cancel: preferences.locale === 'en' ? 'Cancel' : 'Cancelar', amount: preferences.locale === 'en' ? 'Amount' : 'Valor' }[key] ?? key),
  formatMoney: preferences.money,
  parseAmount: (input: string) => {
    const raw = input.replace(/[^\d.,-]/g, '');
    let normalized = raw;
    if (raw.includes('.') && raw.includes(',')) {
      const [first, last] = raw.indexOf('.') < raw.indexOf(',') ? ['.', ','] : [',', '.'];
      normalized = raw.split(first).join('').replace(last, '.');
    } else if (raw.includes(',') || raw.includes('.')) {
      const separator = raw.includes(',') ? ',' : '.';
      normalized = raw.slice(raw.lastIndexOf(separator) + 1).length === 3 ? raw.split(separator).join('') : raw.replace(separator, '.');
    }
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : 0;
  },
}) }));

beforeEach(() => {
  hooks.index = 0;
  hooks.values = [];
  preferences.locale = 'pt-BR';
  preferences.money.mockReset().mockImplementation((value) => `MONEY:${value.toFixed(2)}`);
});

describe('getReimbursementBalances', () => {
  it('groups trimmed case-insensitive names and adds exact integer cents', () => {
    expect(getReimbursementBalances([
      tx({ thirdPartyName: ' Pessoa Teste ', amountCents: 29 }),
      tx({ thirdPartyName: 'pessoa teste', amountCents: 101 }),
      tx({ thirdPartyName: 'Outra Pessoa', amountCents: 1 }),
    ], [receipt({ personName: ' PESSOA TESTE ', amountCents: 30 })])).toEqual([
      { name: 'Pessoa Teste', owedCents: 130, receivedCents: 30, remainingCents: 100, creditCents: 0 },
      { name: 'Outra Pessoa', owedCents: 1, receivedCents: 0, remainingCents: 1, creditCents: 0 },
    ]);
  });

  it('uses shared third-party portions and negative refunds, ignoring payments and other owners', () => {
    const transactions = [
      tx({ amountCents: 1000 }), tx({ type: 'REFUND', amountCents: 123 }),
      tx({ owner: 'SHARED', amountCents: 3000, personalAmountCents: 1200 }),
      tx({ owner: 'SHARED', type: 'REFUND', amountCents: 1000, personalAmountCents: 400 }),
      tx({ owner: 'SHARED', amountCents: 29 }),
      tx({ owner: 'SHARED', amountCents: 100, personalAmountCents: 150 }),
      tx({ type: 'PAYMENT', amountCents: 9000 }), tx({ owner: 'ME' }),
      tx({ owner: 'UNCLASSIFIED' }), tx({ thirdPartyName: '  ' }),
    ];
    expect(getThirdPartyTotalsCents(transactions)[0].cents).toBe(2106);
    expect(getReimbursementBalances(transactions, [receipt({ amountCents: 1000 })])).toEqual([
      { name: 'Pessoa Teste', owedCents: 2106, receivedCents: 1000, remainingCents: 1106, creditCents: 0 },
    ]);
  });

  it('keeps net refunds negative and clamps only remaining and credit', () => {
    expect(getReimbursementBalances([tx({ type: 'REFUND', amountCents: 200 })], [receipt({ amountCents: 50 })])).toEqual([
      { name: 'Pessoa Teste', owedCents: -200, receivedCents: 50, remainingCents: 0, creditCents: 250 },
    ]);
    expect(getReimbursementBalances([tx({ amountCents: 100 }), tx({ type: 'REFUND', amountCents: 100 })], [])[0])
      .toMatchObject({ owedCents: 0, remainingCents: 0, creditCents: 0 });
  });

  it('preserves receipt-only people after removal or renaming and reports excess credit', () => {
    const receipts = freeze([receipt(), receipt({ id: 'orphan', personName: ' Outra Pessoa ', amountCents: 25 })]);
    expect(getReimbursementBalances([], receipts)).toEqual([
      { name: 'Pessoa Teste', owedCents: 0, receivedCents: 3000, remainingCents: 0, creditCents: 3000 },
      { name: 'Outra Pessoa', owedCents: 0, receivedCents: 25, remainingCents: 0, creditCents: 25 },
    ]);
    const renamed = getReimbursementBalances([tx({ thirdPartyName: 'Novo Nome' })], receipts);
    expect(renamed.find((group) => group.name === 'Novo Nome')).toMatchObject({ receivedCents: 0, remainingCents: 10000 });
    expect(renamed.find((group) => group.name === 'Pessoa Teste')).toMatchObject({ owedCents: 0, creditCents: 3000 });
    expect(getReimbursementBalances([tx({ amountCents: 1000 })], receipts)[0]).toMatchObject({ remainingCents: 0, creditCents: 2000 });
  });

  it('does not mutate inputs or reuse mutable balance results', () => {
    const transactions = freeze([tx()]);
    const receipts = freeze([receipt()]);
    const first = getReimbursementBalances(transactions, receipts);
    first[0].receivedCents = 99999;
    expect(getReimbursementBalances(transactions, receipts)[0].receivedCents).toBe(3000);
    expect(getReimbursementBalances([], [])).toEqual([]);
  });
});

describe('addReimbursementReceipt', () => {
  it('accepts successive partial receipts and an exact settlement in cents', () => {
    const original = freeze(month({ creditCardInvoices: [{ id: 'invoice-test', month: 'Outubro', year: 2026,
      transactions: [tx({ amountCents: 299 })] }] }));
    const first = addReimbursementReceipt(original, receipt({ id: 'one', amountCents: 1 }));
    const second = addReimbursementReceipt(first, receipt({ id: 'two', amountCents: 98 }));
    const settled = addReimbursementReceipt(second, receipt({ id: 'three', amountCents: 200 }));
    expect(balancesOf(first)[0].remainingCents).toBe(298);
    expect(balancesOf(second)[0].remainingCents).toBe(200);
    expect(balancesOf(settled)[0]).toMatchObject({ receivedCents: 299, remainingCents: 0, creditCents: 0 });
    expect(addReimbursementReceipt(settled, receipt({ id: 'four', amountCents: 1 }))).toBe(settled);
    expect(original.reimbursementReceipts).toBeUndefined();
  });

  it('uses only invoices of the supplied month, across cards, not transaction or receipt dates', () => {
    const original = month({ creditCardInvoices: [
      { id: 'card-one', month: 'Outubro', year: 2026, transactions: [tx({ amountCents: 100, date: '30/09' })] },
      { id: 'card-two', month: 'Outubro', year: 2026, transactions: [tx({ amountCents: 101, owner: 'SHARED', personalAmountCents: 1 })] },
    ] });
    const added = addReimbursementReceipt(original, receipt({ amountCents: 200, date: '2026-11-02' }));
    expect(balancesOf(added)[0].remainingCents).toBe(0);
    const anotherMonth = month({ id: 'another-month', name: 'Novembro', income: 999999, creditCardInvoices: [] });
    expect(addReimbursementReceipt(anotherMonth, receipt({ amountCents: 1 }))).toBe(anotherMonth);
    expect(anotherMonth.reimbursementReceipts).toBeUndefined();
  });

  it('checks the net open balance including refunds and previously received amounts', () => {
    const original = month({ creditCardInvoices: [{ id: 'invoice-test', month: 'Outubro', year: 2026,
      transactions: [tx({ amountCents: 1000 }), tx({ type: 'REFUND', amountCents: 200 })] }],
    reimbursementReceipts: [receipt({ amountCents: 500 })] });
    expect(addReimbursementReceipt(original, receipt({ id: 'overpay', amountCents: 301 }))).toBe(original);
    expect(balancesOf(addReimbursementReceipt(original, receipt({ id: 'settle', amountCents: 300 })))[0].remainingCents).toBe(0);
    const creditOnly = month({ creditCardInvoices: [], reimbursementReceipts: [receipt()] });
    expect(addReimbursementReceipt(creditOnly, receipt({ id: 'new', amountCents: 1 }))).toBe(creditOnly);
  });

  it.each([0, -1, 1.25, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid cents %s by identity', (amountCents) => {
    const original = freeze(month());
    expect(addReimbursementReceipt(original, receipt({ amountCents }))).toBe(original);
  });

  it.each(['', '   ', 'a'.repeat(121)])('rejects empty or excessive names', (personName) => {
    const original = month();
    expect(addReimbursementReceipt(original, receipt({ personName }))).toBe(original);
  });

  it('accepts a trimmed 120-character name and copies the receipt at the boundary', () => {
    const name = 'A'.repeat(120);
    const original = month({ creditCardInvoices: [{ id: 'invoice-test', month: 'Outubro', year: 2026,
      transactions: [tx({ thirdPartyName: name })] }] });
    const input = receipt({ personName: ` ${name.toLowerCase()} ` });
    const added = addReimbursementReceipt(original, input);
    expect(added.reimbursementReceipts![0].personName).toBe(name.toLowerCase());
    expect(added.reimbursementReceipts![0]).not.toBe(input);
    input.amountCents = 1;
    expect(added.reimbursementReceipts![0].amountCents).toBe(3000);
  });

  it('rejects duplicate IDs across people, missing IDs, unknown people and malformed runtime receipts', () => {
    const original = freeze(month({ reimbursementReceipts: [receipt()] }));
    for (const input of [receipt(), receipt({ personName: 'Outro Nome' }), receipt({ id: '' }), receipt({ id: '  ' }),
      receipt({ id: 'unknown', personName: 'Outro Nome' }), null, undefined,
      { ...receipt(), id: 12 }, { ...receipt(), personName: null }, { ...receipt(), amountCents: '1' }]) {
      expect(addReimbursementReceipt(original, input as ReimbursementReceipt)).toBe(original);
    }
  });

  it.each(['2026-02-29', '2024-02-30', '1900-02-29', '2026-04-31', '2026-00-10', '2026-13-01',
    '2026-01-00', '2026-10-32', '2026-1-01', '15/10/2026', '2026-10-15T12:00:00Z', ' 2026-10-15 ', '', 'not-a-date'])(
    'rejects non-real or non-date-only ISO date %s', (date) => {
      const original = month();
      expect(isValidReimbursementDate(date)).toBe(false);
      expect(addReimbursementReceipt(original, receipt({ date }))).toBe(original);
    });

  it.each(['2024-02-29', '2000-02-29', '2026-04-30', '2026-12-31'])('accepts real calendar date %s', (date) => {
    expect(isValidReimbursementDate(date)).toBe(true);
    expect(addReimbursementReceipt(month(), receipt({ date })).reimbursementReceipts![0].date).toBe(date);
  });
});

describe('removeReimbursementReceipt and financial invariants', () => {
  it('immutably removes only the requested receipt, reopening the balance', () => {
    const original = freeze(month({ reimbursementReceipts: [receipt(), receipt({ id: 'second', amountCents: 500 })] }));
    const removed = removeReimbursementReceipt(original, 'receipt-test');
    expect(removed).not.toBe(original);
    expect(removed.reimbursementReceipts).toEqual([original.reimbursementReceipts![1]]);
    expect(removed.reimbursementReceipts![0]).toBe(original.reimbursementReceipts![1]);
    expect(removed.bills).toBe(original.bills);
    expect(removed.creditCardInvoices).toBe(original.creditCardInvoices);
    expect(balancesOf(removed)[0]).toMatchObject({ receivedCents: 500, remainingCents: 9500 });
    expect(original.reimbursementReceipts).toHaveLength(2);
    expect(removeReimbursementReceipt(original, 'unknown')).toBe(original);
    expect(removeReimbursementReceipt(month({ reimbursementReceipts: undefined }), 'unknown').reimbursementReceipts).toBeUndefined();
    expect(removeReimbursementReceipt(removed, 'second').reimbursementReceipts).toEqual([]);
  });

  it('adding and undoing never changes original total/personal/planned/income/remaining budget or expenses', () => {
    const original = freeze(month({ incomeSources: [{ id: 'source-test', label: 'FICTÍCIO', amount: 2000 }], savedAmount: 50,
      bills: [{ id: 'bill-test', name: 'CONTA FICTÍCIA', category: 'luz', amount: 10.29,
        dueDay: 10, type: 'mensal', isPaid: false, month: 'Outubro', note: '' }],
      creditCardInvoices: [{ id: 'invoice-test', month: 'Outubro', year: 2026, statementTotalCents: 20000, transactions: [
        tx({ owner: 'ME', amountCents: 9000 }), tx({ amountCents: 6000 }),
        tx({ owner: 'SHARED', amountCents: 5000, personalAmountCents: 2000 }),
      ] }],
    }));
    const planned = getMonthPlannedCents(original.bills, original.creditCardInvoices!);
    const charges = getCardCharges(original.creditCardInvoices!, original.bills);
    const added = addReimbursementReceipt(original, receipt());
    const removed = removeReimbursementReceipt(added, 'receipt-test');
    expect(added).not.toBe(original);
    for (const current of [added, removed]) {
      expect(getMonthPlannedCents(current.bills, current.creditCardInvoices!)).toBe(planned);
      expect(getCardCharges(current.creditCardInvoices!, current.bills)).toEqual(charges);
      expect(current.income - planned / 100).toBe(original.income - planned / 100);
      expect(current.incomeSources).toBe(original.incomeSources);
      expect(current.savedAmount).toBe(original.savedAmount);
      expect(current.bills).toBe(original.bills);
      expect(current.creditCardInvoices).toBe(original.creditCardInvoices);
    }
  });
});

type ElementProps = {
  children?: ReactNode; type?: string; id?: string; role?: string; value?: string; hidden?: boolean;
  disabled?: boolean; 'aria-label'?: string; 'aria-invalid'?: boolean; 'aria-expanded'?: boolean; 'aria-describedby'?: string;
  onClick?: () => void; onChange?: (event: ChangeEvent<HTMLInputElement>) => void; onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
};
type Element = ReactElement<ElementProps>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return isValidElement<ElementProps>(node) ? textOf(node.props.children) : '';
}
function panel(initial: Partial<ReimbursementPanelProps> = {}) {
  let props: ReimbursementPanelProps = { personName: ' Pessoa Teste ', transactions: [tx()], receipts: [],
    onAdd: vi.fn(), onRemove: vi.fn(), ...initial };
  let tree: ReactNode;
  let previousKey: string | null = null;
  const render = (changes: Partial<ReimbursementPanelProps> = {}) => {
    props = { ...props, ...changes };
    const outer = ReimbursementPanel(props);
    if (!outer) { tree = null; return; }
    if (outer.key !== previousKey) hooks.values = [];
    previousKey = outer.key;
    hooks.index = 0;
    tree = (outer.type as (value: ReimbursementPanelProps) => ReactNode)(outer.props);
  };
  const find = (predicate: (node: Element) => boolean) => {
    const matches = elements(tree).filter(predicate);
    expect(matches).toHaveLength(1);
    return matches[0];
  };
  const button = (label: string) => find((node) => node.type === 'button' && textOf(node.props.children) === label);
  const click = (label: string) => { button(label).props.onClick!(); render(); };
  const input = (suffix: string) => find((node) => node.type === 'input' && node.props.id?.endsWith(suffix) === true);
  const change = (suffix: string, value: string) => {
    input(suffix).props.onChange!({ target: { value } } as ChangeEvent<HTMLInputElement>);
    render();
  };
  const submit = () => {
    find((node) => node.type === 'form').props.onSubmit!({ preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>);
    render();
  };
  render();
  return { render, button, click, input, change, submit, nodes: () => elements(tree), text: () => textOf(tree), props: () => props };
}

describe('ReimbursementPanel local interactions and privacy', () => {
  it('is absent without a selected person; starts with no form or history rows and no callbacks', () => {
    const view = panel({ personName: '  ' });
    expect(view.nodes()).toEqual([]);
    view.render({ personName: 'Pessoa Teste', receipts: [receipt()] });
    expect(view.nodes().some((node) => node.type === 'form' || node.type === 'li')).toBe(false);
    expect(view.button('Histórico').props['aria-expanded']).toBe(false);
    expect(view.props().onAdd).not.toHaveBeenCalled();
    expect(view.props().onRemove).not.toHaveBeenCalled();
  });

  it('opens a blank draft with today from local calendar fields and accessible errors', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 15, 23, 59));
      const view = panel();
      view.click('Registrar recebimento');
      expect(view.input('-amount').props.value).toBe('');
      expect(view.input('-date').props.value).toBe('2026-10-15');
      expect(view.button('Salvar').props.disabled).toBe(true);
      expect(view.input('-amount').props['aria-invalid']).toBe(true);
      expect(view.nodes().some((node) => node.props.role === 'alert' && node.props.id === view.input('-amount').props['aria-describedby'])).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('adds exact cents with the selected trimmed name and closes/clears, including dot and comma drafts', () => {
    const view = panel();
    for (const draft of ['0,29', '0.29']) {
      view.click('Registrar recebimento');
      view.change('-amount', draft);
      view.change('-date', '2024-02-29');
      expect(view.button('Salvar').props.disabled).toBe(false);
      view.submit();
      expect(view.props().onAdd).toHaveBeenLastCalledWith({ personName: 'Pessoa Teste', amountCents: 29, date: '2024-02-29' });
      expect(view.nodes().some((node) => node.type === 'form')).toBe(false);
    }
    view.click('Registrar recebimento');
    expect(view.input('-amount').props.value).toBe('');
    view.change('-amount', '10');
    view.click('Cancelar');
    expect(view.props().onAdd).toHaveBeenCalledTimes(2);
    expect(view.props().onRemove).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', 'Infinity', 'NaN', '1.2345', '1,2345', '1abc', '1,2,3', '100.01', '90071992547409999'])(
    'disables and blocks invalid/overpay draft %s, even direct form submission', (draft) => {
      const view = panel();
      view.click('Registrar recebimento');
      view.change('-amount', draft);
      expect(view.button('Salvar').props.disabled).toBe(true);
      view.submit();
      expect(view.props().onAdd).not.toHaveBeenCalled();
    });

  it('blocks invalid dates and revalidates the open balance when props change', () => {
    const view = panel();
    view.click('Registrar recebimento');
    view.change('-amount', '100');
    view.change('-date', '2026-02-29');
    expect(view.input('-date').props['aria-invalid']).toBe(true);
    view.submit();
    expect(view.props().onAdd).not.toHaveBeenCalled();
    view.change('-date', '2026-10-15');
    expect(view.button('Salvar').props.disabled).toBe(false);
    view.render({ receipts: [receipt()] });
    expect(view.button('Salvar').props.disabled).toBe(true);
    view.submit();
    expect(view.props().onAdd).not.toHaveBeenCalled();
  });

  it('history filters by canonical person, remains immutable and undoes only by user click', () => {
    const receipts = freeze([receipt(), receipt({ id: 'other', personName: 'Outra Pessoa' }),
      receipt({ id: 'latest', personName: ' PESSOA TESTE ', date: '2026-10-16', amountCents: 100 })]);
    const view = panel({ receipts });
    view.click('Histórico');
    const rows = view.nodes().filter((node) => node.type === 'li');
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe('latest');
    expect(view.props().onRemove).not.toHaveBeenCalled();
    const undo = elements(rows[0]).find((node) => node.type === 'button')!;
    undo.props.onClick!();
    expect(view.props().onRemove).toHaveBeenCalledExactlyOnceWith('latest');
    expect(receipts.map((entry) => entry.id)).toEqual(['receipt-test', 'other', 'latest']);
    view.click('Histórico');
    expect(view.nodes().some((node) => node.type === 'li')).toBe(false);
  });

  it('masks summary, excess credit and history in text/aria, does not call formatMoney or prefill balances', () => {
    const view = panel({ transactions: [tx({ amountCents: 2000 })], receipts: [receipt({ amountCents: 2500 })], hideValues: true });
    expect(view.text()).toContain('Crédito excedente: ••••');
    expect(view.button('Registrar recebimento').props.disabled).toBe(true);
    view.click('Histórico');
    const aria = view.nodes().map((node) => node.props['aria-label'] ?? '').join(' ');
    expect(aria).toContain('••••');
    expect(view.text() + aria).not.toContain('MONEY:');
    expect(preferences.money).not.toHaveBeenCalled();
    view.render({ transactions: [tx()], receipts: [] });
    view.click('Registrar recebimento');
    expect(view.input('-amount').props.value).toBe('');
    expect(view.input('-amount').props.type).toBe('password');
    expect(preferences.money).not.toHaveBeenCalled();
  });

  it('uses English local copy/preferences and resets draft/history on person change', () => {
    preferences.locale = 'en';
    const view = panel({ receipts: [receipt()] });
    expect(view.text()).toContain('Reimbursements');
    expect(view.text()).toContain('MONEY:70.00');
    view.click('History');
    view.click('Record receipt');
    view.change('-amount', '1');
    view.render({ personName: 'Outra Pessoa', transactions: [tx({ thirdPartyName: 'Outra Pessoa' })] });
    expect(view.nodes().some((node) => node.type === 'form' || node.type === 'li')).toBe(false);
    view.click('Record receipt');
    expect(view.input('-amount').props.value).toBe('');
    expect(view.props().onAdd).not.toHaveBeenCalled();
    expect(view.props().onRemove).not.toHaveBeenCalled();
  });
});
