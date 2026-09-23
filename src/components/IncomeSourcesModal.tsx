import React, { useCallback, useMemo, useState } from 'react';
import { type IncomeSource } from '../types';
import { useModalA11y } from '../hooks/useModalA11y';

function newSourceId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function seedSources(sources: IncomeSource[] | undefined, income: number): IncomeSource[] {
  if (sources && sources.length > 0) return sources.map((source) => ({ ...source }));
  if (income > 0) return [{ id: newSourceId(), label: '', amount: income }];
  return [{ id: newSourceId(), label: '', amount: 0 }];
}

interface Props {
  open: boolean;
  monthLabel: string;
  income: number;
  sources: IncomeSource[] | undefined;
  onClose: () => void;
  onSave: (sources: IncomeSource[]) => void;
  formatCurrency: (value: number) => string;
  parseAmount: (raw: string) => number;
  labels: {
    title: string;
    eyebrow: string;
    description: string;
    source: string;
    amount: string;
    sourcePlaceholder: string;
    add: string;
    remove: string;
    total: string;
    close: string;
  };
  closeIcon: React.ReactNode;
}

export const IncomeSourcesModal: React.FC<Props> = ({
  open,
  monthLabel,
  income,
  sources,
  onClose,
  onSave,
  formatCurrency,
  parseAmount,
  labels,
  closeIcon,
}) => {
  const [rows, setRows] = useState<IncomeSource[]>(() => seedSources(sources, income));
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, row.amount > 0 ? String(row.amount) : ''])),
  );
  const commitAndClose = useCallback(() => {
    onSave(rows);
    onClose();
  }, [onSave, onClose, rows]);
  const dialogRef = useModalA11y<HTMLElement>(open, commitAndClose);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0),
    [rows],
  );

  if (!open) return null;

  const updateLabel = (id: string, label: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, label } : row)));
  };

  const updateAmountDraft = (id: string, raw: string) => {
    const sanitized = raw.replace(/[^0-9.,]/g, '');
    setDraftAmounts((prev) => ({ ...prev, [id]: sanitized }));
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, amount: parseAmount(sanitized) } : row)));
  };

  const addRow = () => {
    const id = newSourceId();
    setRows((prev) => [...prev, { id, label: '', amount: 0 }]);
    setDraftAmounts((prev) => ({ ...prev, [id]: '' }));
  };

  const removeRow = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== id)));
    setDraftAmounts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  return (
    <div
      className="income-sources-backdrop"
      role="presentation"
      onClick={commitAndClose}
    >
      <article
        ref={dialogRef}
        className="income-sources-sheet theme-income-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="income-sources-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="income-sources-sheet-handle" aria-hidden="true" />
        <header className="income-sources-sheet-header">
          <div className="income-sources-sheet-heading">
            <span className="settings-eyebrow">{labels.eyebrow}</span>
            <h2 id="income-sources-title">{labels.title}</h2>
            <p className="income-sources-modal-subtitle">{monthLabel}</p>
          </div>
          <button type="button" className="settings-icon-button" onClick={commitAndClose} title={labels.close} aria-label={labels.close}>
            {closeIcon}
          </button>
        </header>
        <p className="income-sources-modal-intro">{labels.description}</p>
        <div className="income-sources-table-wrap">
          <div className="income-sources-table-head" aria-hidden="true">
            <span>{labels.source}</span>
            <span>{labels.amount}</span>
            <span />
          </div>
          <ul className="income-sources-list">
            {rows.map((row) => (
              <li key={row.id} className="income-source-row">
                <input
                  type="text"
                  value={row.label}
                  placeholder={labels.sourcePlaceholder}
                  onChange={(event) => updateLabel(row.id, event.target.value)}
                  className="income-source-input"
                  aria-label={labels.source}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9.,]*"
                  value={draftAmounts[row.id] ?? ''}
                  onChange={(event) => updateAmountDraft(row.id, event.target.value)}
                  className="income-source-amount"
                  placeholder="0"
                  aria-label={`${labels.amount}${row.label ? ` — ${row.label}` : ''}`}
                />
                <button
                  type="button"
                  className="income-source-remove"
                  onClick={() => removeRow(row.id)}
                  disabled={rows.length <= 1}
                  title={labels.remove}
                  aria-label={labels.remove}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className="income-source-add" onClick={addRow}>
          + {labels.add}
        </button>
        <footer className="income-sources-sheet-footer">
          <div className="income-sources-total">
            <span>{labels.total}</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
          <button type="button" className="income-sources-save" onClick={commitAndClose}>{labels.close}</button>
        </footer>
      </article>
    </div>
  );
};
