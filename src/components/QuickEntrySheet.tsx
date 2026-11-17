import { type ReactNode, useCallback, useRef, useState } from 'react';
import { useModalA11y } from '../hooks/useModalA11y';
import { usePreferences } from '../i18n';

export type QuickEntryMode = 'home' | 'assistant' | 'invoice';

interface Props {
  open: boolean;
  mode: QuickEntryMode;
  successMessage?: string | null;
  assistantContent?: ReactNode;
  invoiceContent?: ReactNode;
  onClose: () => void;
  onModeChange: (mode: QuickEntryMode) => void;
  onAskAssistant: (prompt: string) => void;
  onImportInvoice: () => void;
}

const copy = {
  'pt-BR': {
    title: 'Novo lançamento',
    description: 'Conte à IA o que você comprou. Ela prepara o lançamento para você conferir antes de salvar.',
    placeholder: 'Ex.: R$ 48,90 no almoço, débito Pix, alimentação',
    ask: 'Preparar com IA',
    examples: ['R$ 35,90 de almoço no débito', 'R$ 120 no mercado no C6'],
    invoice: 'Importar fatura',
    invoiceAction: 'Lançar print da fatura',
    invoiceDescription: 'Envie um print, imagem, PDF ou CSV. Confira as compras encontradas antes de lançar.',
    closeAssistant: 'Fechar IA',
    closeInvoice: 'Fechar importação',
    close: 'Fechar lançamento rápido',
    safety: 'Nada será salvo sem sua confirmação.',
    imported: 'Lançamentos adicionados. Você pode continuar ou fechar.',
  },
  en: {
    title: 'New transaction',
    description: 'Tell the assistant what you bought. It will prepare the transaction for you to review before saving.',
    placeholder: 'E.g. R$ 48.90 for lunch, debit, food',
    ask: 'Prepare with AI',
    examples: ['R$ 35.90 lunch by debit', 'R$ 120 groceries on C6'],
    invoice: 'Import statement',
    invoiceAction: 'Add statement screenshot',
    invoiceDescription: 'Upload a screenshot, image, PDF, or CSV. Review the purchases found before adding them.',
    closeAssistant: 'Close AI',
    closeInvoice: 'Close import',
    close: 'Close quick entry',
    safety: 'Nothing is saved without your confirmation.',
    imported: 'Transactions added. You can continue or close.',
  },
} as const;

export function QuickEntrySheet({
  open,
  mode,
  successMessage,
  assistantContent,
  invoiceContent,
  onClose,
  onModeChange,
  onAskAssistant,
  onImportInvoice,
}: Props) {
  const { locale } = usePreferences();
  const text = copy[locale];
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeAndReset = useCallback(() => {
    setDescription('');
    onClose();
  }, [onClose]);
  const dialogRef = useModalA11y<HTMLDivElement>(open, closeAndReset);

  if (!open) return null;

  const submit = () => {
    const prompt = description.trim();
    if (!prompt) {
      inputRef.current?.focus();
      return;
    }
    onAskAssistant(prompt);
  };

  return (
    <div className="quick-entry-backdrop" role="presentation" onClick={closeAndReset}>
      <section
        ref={dialogRef}
        className="quick-entry-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-entry-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="quick-entry-handle" aria-hidden="true" />
        <div className="quick-entry-heading">
          <div>
            <span className="quick-entry-eyebrow">finança pessoal</span>
            <h2 id="quick-entry-title">{text.title}</h2>
          </div>
          <div className="quick-entry-heading-actions">
            <button type="button" className="settings-icon-button" onClick={closeAndReset} aria-label={text.close}>×</button>
          </div>
        </div>
        <p className="quick-entry-description">{text.description}</p>
        {successMessage && <p className="quick-entry-success" role="status">{successMessage}</p>}
        <label className="quick-entry-label" htmlFor="quick-entry-description">{locale === 'en' ? 'Describe your purchase' : 'Descreva a compra'}</label>
        <textarea
          ref={inputRef}
          id="quick-entry-description"
          className="quick-entry-input"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={text.placeholder}
          rows={2}
          maxLength={240}
        />
        <div className="quick-entry-examples">
          {text.examples.map((example) => (
            <button type="button" key={example} onClick={() => { setDescription(example); onModeChange('home'); }}>{example}</button>
          ))}
        </div>
        <div className="quick-entry-actions">
          <button type="button" className={mode === 'assistant' ? 'quick-entry-primary is-open' : 'quick-entry-primary'} onClick={() => {
            if (mode === 'assistant') onModeChange('home');
            else submit();
          }} disabled={mode !== 'assistant' && !description.trim()}>
            <span aria-hidden="true">✦</span> {mode === 'assistant' ? text.closeAssistant : text.ask}
          </button>
          <button type="button" className={mode === 'invoice' ? 'quick-entry-primary quick-entry-import-action is-open' : 'quick-entry-primary quick-entry-import-action'} onClick={() => {
            if (mode === 'invoice') onModeChange('home');
            else onImportInvoice();
          }}>
            <span aria-hidden="true">▧</span> {mode === 'invoice' ? text.closeInvoice : text.invoiceAction}
          </button>
        </div>
        <p className="quick-entry-safety">{text.safety}</p>
        {mode === 'invoice' && <p className="quick-entry-description">{text.invoiceDescription}</p>}
        {mode === 'assistant' && <div className="quick-entry-embedded-content">{assistantContent}</div>}
        {mode === 'invoice' && <div className="quick-entry-embedded-content">{invoiceContent}</div>}
      </section>
    </div>
  );
}
