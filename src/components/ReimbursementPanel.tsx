import { useId, useState, type CSSProperties } from 'react';
import type { CreditCardTransaction, ReimbursementReceipt } from '../types';
import { usePreferences } from '../i18n';
import { centsToAmount } from '../services/cardTransactions';
import { getReimbursementBalances, isValidReimbursementDate } from '../services/reimbursements';

export interface ReimbursementPanelProps {
  personName: string;
  /** All transactions of the selected month, not just the visible card/filter. */
  transactions: CreditCardTransaction[];
  receipts: ReimbursementReceipt[];
  hideValues?: boolean;
  onAdd: (receipt: Omit<ReimbursementReceipt, 'id'>) => void;
  onRemove: (receiptId: string) => void;
}

const copy = {
  'pt-BR': {
    title: 'Devoluções', owed: 'A receber', received: 'Recebido', remaining: 'Falta',
    credit: 'Crédito excedente', creditHint: 'Os recebimentos superam a despesa atual. O histórico foi preservado.',
    register: 'Registrar recebimento', history: 'Histórico', undo: 'Desfazer', receipt: 'Recebimento',
    date: 'Data do recebimento', empty: 'Nenhum recebimento registrado.',
    hint: 'Controle deste mês, separado da renda, dos gastos e da sobra.',
    amountRequired: 'Informe o valor recebido.', amountInvalid: 'Informe um valor positivo, com no máximo duas casas decimais.',
    overpayment: 'O valor não pode superar o saldo em aberto.', dateInvalid: 'Informe uma data válida no formato AAAA-MM-DD.',
    nameInvalid: 'O nome da pessoa deve ter entre 1 e 120 caracteres.',
  },
  en: {
    title: 'Reimbursements', owed: 'To receive', received: 'Received', remaining: 'Remaining',
    credit: 'Excess credit', creditHint: 'Receipts exceed the current expense. History has been preserved.',
    register: 'Record receipt', history: 'History', undo: 'Undo', receipt: 'Receipt',
    date: 'Receipt date', empty: 'No receipts recorded.',
    hint: 'This month only, separate from income, spending and remaining budget.',
    amountRequired: 'Enter the amount received.', amountInvalid: 'Enter a positive amount with at most two decimal places.',
    overpayment: 'The amount cannot exceed the outstanding balance.', dateInvalid: 'Enter a real date in YYYY-MM-DD format.',
    nameInvalid: 'The person’s name must contain 1 to 120 characters.',
  },
};

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' };
const buttonStyle: CSSProperties = {
  minHeight: 44, minWidth: 44, padding: '10px 14px', borderRadius: 8,
  border: '1px solid var(--spending-border)', background: 'var(--spending-surface)',
  color: 'var(--spending-accent)', cursor: 'pointer', font: 'inherit', outlineOffset: 3,
};
const fieldStyle: CSSProperties = {
  minHeight: 44, width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '10px 12px',
  borderRadius: 8, border: '1px solid var(--spending-border)',
  background: 'var(--spending-surface)', color: 'var(--spending-text)', font: 'inherit', outlineOffset: 3,
};

function todayLocal(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

/** The parent mounts this only for a person: filter.slice('person:'.length). */
export function ReimbursementPanel(props: ReimbursementPanelProps) {
  const name = props.personName.trim();
  if (!name) return null;
  // A different person must not inherit an open history or another person's draft.
  return <PersonReimbursementPanel key={name.toLowerCase()} {...props} personName={name} />;
}

function PersonReimbursementPanel({ personName, transactions, receipts, hideValues, onAdd, onRemove }: ReimbursementPanelProps) {
  const { locale, t, formatMoney, parseAmount } = usePreferences();
  const text = copy[locale];
  const id = useId();
  const [formOpen, setFormOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [amountDraft, setAmountDraft] = useState('');
  const [dateDraft, setDateDraft] = useState(todayLocal);
  const key = personName.toLowerCase();
  const balance = getReimbursementBalances(transactions, receipts).find((group) => group.name.toLowerCase() === key);
  const owedCents = balance?.owedCents ?? 0;
  const receivedCents = balance?.receivedCents ?? 0;
  const remainingCents = balance?.remainingCents ?? 0;
  const creditCents = balance?.creditCents ?? 0;
  const personReceipts = receipts.filter((receipt) => receipt.personName.trim().toLowerCase() === key)
    .toReversed().sort((a, b) => b.date.localeCompare(a.date));
  const money = (cents: number) => hideValues ? '••••' : formatMoney(centsToAmount(cents));
  const displayDate = (value: string) => isValidReimbursementDate(value)
    ? new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, { dateStyle: 'short' }).format(new Date(`${value}T12:00:00`))
    : value;

  // parseAmount accepts both locales; reject junk and sub-cent drafts before parsing.
  const numericDraft = /^(?:\d+(?:[.,]\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)$/;
  const amount = parseAmount(amountDraft.trim());
  const amountCents = Math.round(amount * 100);
  const amountError = !amountDraft.trim() ? text.amountRequired
    : !numericDraft.test(amountDraft.trim()) || !Number.isFinite(amount)
      || !Number.isSafeInteger(amountCents) || amountCents <= 0 ? text.amountInvalid
      : amountCents > remainingCents ? text.overpayment : '';
  const dateError = isValidReimbursementDate(dateDraft) ? '' : text.dateInvalid;
  const nameError = personName.length > 120 ? text.nameInvalid : '';
  const canSave = !amountError && !dateError && !nameError;

  const closeForm = () => {
    setAmountDraft('');
    setDateDraft(todayLocal());
    setFormOpen(false);
  };
  const openForm = () => {
    // Never prefill the outstanding amount, including in private mode.
    setAmountDraft('');
    setDateDraft(todayLocal());
    setFormOpen(true);
  };

  return (
    <section className="spending-insights spending-card spending-reimbursements" aria-labelledby={`${id}-title`}
      style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, borderRadius: 12,
        border: '1px solid var(--spending-border)', background: 'var(--spending-surface)', color: 'var(--spending-text)' }}>
      <h3 id={`${id}-title`} style={{ margin: 0, overflowWrap: 'anywhere' }}>{text.title} — {personName}</h3>
      <p className="spending-muted" style={{ margin: 0, color: 'var(--spending-muted)', fontSize: 12 }}>{text.hint}</p>
      <dl className="spending-stats" style={{ ...rowStyle, margin: 0 }}>
        {[[text.owed, owedCents], [text.received, receivedCents], [text.remaining, remainingCents]].map(([label, cents]) => (
          <div className="spending-stat" key={String(label)} style={{ flex: '1 1 120px', minWidth: 0 }}>
            <dt style={{ color: 'var(--spending-muted)', fontSize: 12 }}>{label}</dt>
            <dd style={{ margin: '4px 0 0', fontWeight: 600, overflowWrap: 'anywhere' }}>{money(Number(cents))}</dd>
          </div>
        ))}
      </dl>
      {creditCents > 0 && (
        <div className="spending-credit" style={{ color: 'var(--spending-positive)' }}>
          <strong>{text.credit}: {money(creditCents)}</strong>
          <p className="spending-muted" style={{ margin: '4px 0 0', color: 'var(--spending-muted)', fontSize: 12 }}>{text.creditHint}</p>
        </div>
      )}
      <div className="spending-actions" style={rowStyle}>
        {!formOpen && <button type="button" className="spending-button" style={buttonStyle}
          disabled={remainingCents <= 0 || !!nameError} aria-expanded={false} aria-controls={`${id}-form`} onClick={openForm}>
          {text.register}
        </button>}
        <button type="button" className="spending-button spending-button-secondary" style={buttonStyle}
          aria-expanded={historyOpen} aria-controls={`${id}-history`} onClick={() => setHistoryOpen((open) => !open)}>
          {text.history}
        </button>
      </div>
      <div id={`${id}-form`} hidden={!formOpen}>
      {formOpen && (
        <form className="spending-form" noValidate aria-label={text.register}
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            onAdd({ personName, amountCents, date: dateDraft });
            closeForm();
          }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...rowStyle, alignItems: 'flex-start' }}>
            <div className="spending-field" style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label htmlFor={`${id}-amount`}>{t('amount')}</label>
              <input id={`${id}-amount`} className="spending-input" type={hideValues ? 'password' : 'text'} inputMode="decimal"
                autoComplete="off" required value={amountDraft} onChange={(event) => setAmountDraft(event.target.value)}
                aria-invalid={!!amountError} aria-describedby={amountError ? `${id}-amount-error` : undefined} style={fieldStyle} />
              {amountError && <p id={`${id}-amount-error`} className="spending-error" role="alert"
                style={{ margin: '4px 0 0', color: 'var(--spending-negative)', fontSize: 12 }}>{amountError}</p>}
            </div>
            <div className="spending-field" style={{ flex: '1 1 160px', minWidth: 0 }}>
              <label htmlFor={`${id}-date`}>{text.date}</label>
              <input id={`${id}-date`} className="spending-input" type="date" required value={dateDraft}
                onChange={(event) => setDateDraft(event.target.value)} aria-invalid={!!dateError}
                aria-describedby={dateError ? `${id}-date-error` : undefined} style={fieldStyle} />
              {dateError && <p id={`${id}-date-error`} className="spending-error" role="alert"
                style={{ margin: '4px 0 0', color: 'var(--spending-negative)', fontSize: 12 }}>{dateError}</p>}
            </div>
          </div>
          {nameError && <p className="spending-error" role="alert" style={{ color: 'var(--spending-negative)' }}>{nameError}</p>}
          <div className="spending-actions" style={rowStyle}>
            <button type="submit" className="spending-button" style={buttonStyle} disabled={!canSave}>{t('save')}</button>
            <button type="button" className="spending-button spending-button-secondary" style={buttonStyle} onClick={closeForm}>{t('cancel')}</button>
          </div>
        </form>
      )}
      </div>
      <div id={`${id}-history`} hidden={!historyOpen}>
        {historyOpen && (personReceipts.length === 0
          ? <p className="spending-muted" style={{ color: 'var(--spending-muted)' }}>{text.empty}</p>
          : <ul className="spending-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {personReceipts.map((receipt, index) => (
              <li className="spending-list-row" key={receipt.id} style={{ ...rowStyle, justifyContent: 'space-between' }}>
                <div style={{ ...rowStyle, minWidth: 0 }}>
                  <time dateTime={receipt.date} style={{ color: 'var(--spending-muted)' }}>{displayDate(receipt.date)}</time>
                  <strong>{money(receipt.amountCents)}</strong>
                </div>
                <button type="button" className="spending-button spending-button-secondary" style={buttonStyle}
                  aria-label={`${text.undo} — ${text.receipt} ${index + 1} — ${displayDate(receipt.date)} — ${money(receipt.amountCents)}`}
                  onClick={() => onRemove(receipt.id)}>{text.undo}</button>
              </li>
            ))}
          </ul>)}
      </div>
    </section>
  );
}
