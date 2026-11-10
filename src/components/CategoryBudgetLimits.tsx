import { useId, useState } from 'react';
import { usePreferences, type AppLocale } from '../i18n';
import type { BudgetMonth, CategoryId } from '../types';
import { centsToAmount } from '../services/cardTransactions';
import { getCategoryChartData } from '../services/financeCharts';
import { getCategoryLimitState } from '../services/spendingInsights';
import { CategorySelect } from './CategorySelect';
import './SpendingInsights.css';

interface Props {
  month: BudgetMonth;
  hideValues?: boolean;
  onSetLimit: (category: CategoryId, limitCents: number | undefined) => void;
}

const copy: Record<AppLocale, Record<string, string>> = {
  'pt-BR': {
    title: 'Limites do mês',
    define: 'Definir limite',
    basis: 'Minha parte, cartão + conta. Apenas neste mês.',
    category: 'Categoria',
    choose: 'Selecione uma categoria',
    value: 'Valor do limite',
    invalid: 'Selecione uma categoria e informe um valor positivo, com até duas casas decimais, dentro do limite seguro.',
    empty: 'Nenhum limite definido.',
    edit: 'Editar limite',
    remove: 'Remover limite',
    spent: 'Gasto',
    limit: 'Limite',
    remaining: 'Restante',
    normal: 'Dentro do limite',
    near: 'Perto do limite',
    over: 'Ultrapassou o limite',
    progress: 'Uso do limite',
    hidden: 'Valor oculto',
  },
  en: {
    title: 'Monthly limits',
    define: 'Set a limit',
    basis: 'My share, card + account. This month only.',
    category: 'Category',
    choose: 'Select a category',
    value: 'Limit amount',
    invalid: 'Select a category and enter a positive amount with up to two decimal places, within the safe limit.',
    empty: 'No limits set.',
    edit: 'Edit limit',
    remove: 'Remove limit',
    spent: 'Spent',
    limit: 'Limit',
    remaining: 'Remaining',
    normal: 'Within the limit',
    near: 'Near the limit',
    over: 'Over the limit',
    progress: 'Limit usage',
    hidden: 'Amount hidden',
  },
};

// Parse decimal digits directly: no floating-point rounding or silent deletion.
function parseLimitCents(value: string): number | undefined {
  const match = value.trim().match(/^(\d+)(?:[.,](\d{1,2}))?$/);
  if (!match) return undefined;
  const cents = Number(`${match[1]}${(match[2] ?? '').padEnd(2, '0')}`);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : undefined;
}

export function CategoryBudgetLimits({ month, hideValues = false, onSetLimit }: Props) {
  const { locale, t, formatMoney, categoryLabel, categoryColor } = usePreferences();
  const text = copy[locale];
  const id = useId();
  const scope = `${month.id}:${month.year}:${month.name}`;
  const [draft, setDraft] = useState<{ scope: string; category: CategoryId; value: string; error: boolean } | null>(null);
  const editor = draft?.scope === scope ? draft : null;
  const limits = Object.entries(month.categoryLimitsCents ?? {}).filter(
    (entry): entry is [CategoryId, number] => Number.isSafeInteger(entry[1]) && (entry[1] ?? 0) > 0,
  );
  const spentByCategory = new Map(getCategoryChartData(month.bills, month.creditCardInvoices, 'all').items.map((item) => [item.category, item.cents]));
  const money = (cents: number) => hideValues ? '••••' : formatMoney(centsToAmount(cents));
  const begin = (category: CategoryId = '', limitCents?: number) => {
    const separator = locale === 'en' ? '.' : ',';
    const value = limitCents === undefined || hideValues ? '' : `${Math.floor(limitCents / 100)}${separator}${String(limitCents % 100).padStart(2, '0')}`;
    setDraft({ scope, category, value, error: false });
  };

  return (
    <section className="spending-insights" aria-labelledby={`${id}-title`} style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--spending-border)' }}>
      <div className="spending-heading">
        <h3 id={`${id}-title`} className="spending-title">{text.title}</h3>
        <button type="button" className="spending-button spending-action" onClick={() => begin()} aria-expanded={editor !== null} aria-controls={editor ? `${id}-form` : undefined}>{text.define}</button>
      </div>
      <p className="spending-note">{text.basis}</p>
      {editor && (
        <form
          key={scope}
          id={`${id}-form`}
          noValidate
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          onSubmit={(event) => {
            event.preventDefault();
            const cents = parseLimitCents(editor.value);
            if (!editor.category || cents === undefined) {
              setDraft({ ...editor, error: true });
              return;
            }
            onSetLimit(editor.category, cents);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); }
          }}
        >
          <div className="spending-field">
            <span>{text.category}</span>
            <CategorySelect value={editor.category} onChange={(category) => setDraft({ ...editor, category, error: false })} ariaLabel={text.category} unsetLabel={text.choose} autoFocus />
          </div>
          <label className="spending-field" htmlFor={`${id}-value`}>
            <span>{text.value}</span>
            <input
              id={`${id}-value`}
              type={hideValues ? 'password' : 'text'}
              inputMode="decimal"
              autoComplete="off"
              required
              value={editor.value}
              placeholder={locale === 'en' ? '0.00' : '0,00'}
              aria-invalid={editor.error || undefined}
              aria-describedby={editor.error ? `${id}-error` : undefined}
              onChange={(event) => setDraft({ ...editor, value: event.target.value, error: false })}
            />
          </label>
          {editor.error && <p id={`${id}-error`} className="spending-note spending-negative" role="alert" style={{ color: 'var(--spending-negative)' }}>{text.invalid}</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="submit" className="spending-button spending-action">{t('save')}</button>
            <button type="button" className="spending-button" onClick={() => setDraft(null)}>{t('cancel')}</button>
          </div>
        </form>
      )}
      {limits.length === 0 ? <p className="spending-note">{text.empty}</p> : (
        <ul className="spending-change-list">
          {limits.map(([category, limitCents]) => {
            const spentCents = spentByCategory.get(category) ?? 0;
            const state = getCategoryLimitState(spentCents, limitCents);
            const percentage = Math.min(100, Math.max(0, state.ratio * 100));
            const color = state.status === 'over' ? 'var(--spending-negative)' : state.status === 'near' ? 'var(--spending-accent)' : categoryColor(category);
            const label = categoryLabel(category);
            return (
              <li key={category} className="spending-change" style={{ display: 'block' }}>
                <div className="spending-heading">
                  <strong className="spending-entry-name">{label}</strong>
                  <span className="spending-note" style={{ color }}>{text[state.status]}</span>
                </div>
                <dl className="spending-change-values">
                  <div><dt>{text.spent}</dt><dd className="spending-money" aria-label={hideValues ? text.hidden : undefined}>{money(spentCents)}</dd></div>
                  <div><dt>{text.limit}</dt><dd className="spending-money" aria-label={hideValues ? text.hidden : undefined}>{money(limitCents)}</dd></div>
                  <div><dt>{text.remaining}</dt><dd className="spending-money" aria-label={hideValues ? text.hidden : undefined}>{money(state.remainingCents)}</dd></div>
                </dl>
                {!hideValues && (
                  <div role="progressbar" aria-label={`${text.progress} · ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${money(spentCents)} / ${money(limitCents)}`} style={{ height: 5, marginTop: 8, borderRadius: 4, background: 'var(--spending-border)', overflow: 'hidden' }}>
                    <div style={{ width: `${percentage}%`, height: '100%', background: color }} />
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  <button type="button" className="spending-button" aria-label={`${text.edit} · ${label}`} onClick={() => begin(category, limitCents)}>{text.edit}</button>
                  <button type="button" className="spending-button" aria-label={`${text.remove} · ${label}`} onClick={() => {
                    onSetLimit(category, undefined);
                    if (editor?.category === category) setDraft(null);
                  }}>{text.remove}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
