import { useId, useRef, useState } from 'react';
import { usePreferences, type AppLocale } from '../i18n';
import { getMonthIndex, type BudgetMonth, type CategoryId } from '../types';
import { centsToAmount } from '../services/cardTransactions';
import {
  getCategoryChanges,
  getPreviousCalendarMonth,
  getSmallPurchases,
  getSpendingEntries,
  isMonthInProgress,
} from '../services/spendingInsights';
import { SpendingDetails } from './SpendingDetails';

interface Props {
  month: BudgetMonth;
  months: BudgetMonth[];
  hideValues?: boolean;
}

const copy: Record<AppLocale, Record<string, string>> = {
  'pt-BR': {
    title: 'Mudanças por categoria',
    subtitle: 'Até 3 maiores diferenças em relação a {month}.',
    partial: 'Mês em andamento: comparação parcial com o mês anterior inteiro. Uma redução até agora não significa economia.',
    future: 'Mês não iniciado: diferenças ainda não são exibidas. Os lançamentos são registros futuros.',
    noPrevious: 'Sem o mês anterior do calendário para comparar.',
    unchanged: 'Nenhuma diferença de categoria nos registros disponíveis.',
    before: 'Antes',
    now: 'Agora',
    delta: 'Variação',
    open: 'Ver lançamentos',
    currentEntries: 'Lançamentos do mês atual',
    smallTitle: 'Pequenos gastos se acumulam',
    smallSummary: '{count} compras de até {threshold} da minha parte somam {total}.',
    smallHint: 'Somente compras positivas à vista; parcelas e estornos não entram nesta observação.',
    hidden: 'Valor oculto',
  },
  en: {
    title: 'Category changes',
    subtitle: 'Up to 3 largest differences compared with {month}.',
    partial: 'Month in progress: partial comparison with the entire previous month. A decrease so far does not mean savings.',
    future: 'This month has not started: differences are not shown yet. Transactions are future records.',
    noPrevious: 'No previous calendar month available to compare.',
    unchanged: 'No category differences in the available records.',
    before: 'Before',
    now: 'Now',
    delta: 'Change',
    open: 'View transactions',
    currentEntries: 'Current month transactions',
    smallTitle: 'Small purchases add up',
    smallSummary: '{count} purchases of up to {threshold} for my share total {total}.',
    smallHint: 'Positive, non-installment purchases only; installments and refunds are not included in this observation.',
    hidden: 'Amount hidden',
  },
};

type Selection = { scope: string; kind: 'category'; category: CategoryId } | { scope: string; kind: 'small' };

export function MonthlySpendingInsights({ month, months, hideValues = false }: Props) {
  const { t, formatMoney, categoryLabel, formatMonthFull, locale } = usePreferences();
  const text = copy[locale];
  const id = useId();
  const [selection, setSelection] = useState<Selection | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const scope = `${month.id}:${month.year}:${month.name}`;
  const today = new Date();
  const monthIndex = getMonthIndex(month.name);
  const future = monthIndex >= 0 && (month.year > today.getFullYear() || (month.year === today.getFullYear() && monthIndex > today.getMonth()));
  const partial = isMonthInProgress(month, today);
  const previous = getPreviousCalendarMonth(month, months);
  const changes = previous && !future ? getCategoryChanges(month, previous).slice(0, 3) : [];
  const small = getSmallPurchases(month);
  const currentEntries = getSpendingEntries(month);
  const selected = selection?.scope === scope ? selection : null;
  const selectedCategory = selected?.kind === 'category' && !future && changes.some((change) => change.category === selected.category) ? selected.category : undefined;
  const showSmallDetails = selected?.kind === 'small' && small.visible;
  const money = (cents: number) => hideValues ? '••••' : formatMoney(centsToAmount(cents));
  const deltaMoney = (cents: number) => hideValues ? '••••' : `${cents > 0 ? '+' : ''}${money(cents)}`;
  const closeDetails = () => {
    setSelection(null);
    if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
  };

  if (monthIndex < 0) return null;

  return (
    <section className="spending-insights spending-monthly" aria-labelledby={`${id}-title`}>
      <div className="spending-comparison">
        <h3 id={`${id}-title`} className="spending-title">{text.title}</h3>
        {future ? (
          <p className="spending-note">{text.future}</p>
        ) : (
          <>
            {partial && <p className="spending-notice" role="note">{text.partial}</p>}
            {!previous ? (
              <p className="spending-note">{text.noPrevious}</p>
            ) : (
              <>
                <p className="spending-note">{t('myShare')}: {text.subtitle.replace('{month}', formatMonthFull(previous.name, previous.year))}</p>
                {changes.length === 0 ? <p className="spending-note">{text.unchanged}</p> : (
                  <ul className="spending-change-list">
                    {changes.map((change) => {
                      const expanded = selectedCategory === change.category;
                      return (
                        <li key={change.category} className="spending-change">
                          <div className="spending-change-info">
                            <h4 className="spending-entry-name">{categoryLabel(change.category)}</h4>
                            <dl className="spending-change-values">
                              <div><dt>{text.before}</dt><dd className="spending-money" aria-label={hideValues ? text.hidden : undefined}>{money(change.previousCents)}</dd></div>
                              <div><dt>{text.now}</dt><dd className="spending-money" aria-label={hideValues ? text.hidden : undefined}>{money(change.currentCents)}</dd></div>
                              <div><dt>{text.delta}</dt><dd className={`spending-money${!hideValues ? change.deltaCents > 0 ? ' spending-negative' : ' spending-positive' : ''}`} aria-label={hideValues ? text.hidden : undefined}>{deltaMoney(change.deltaCents)}</dd></div>
                            </dl>
                          </div>
                          <button
                            type="button"
                            className="spending-button spending-action"
                            aria-label={`${text.open}: ${categoryLabel(change.category)} · ${text.currentEntries}`}
                            aria-expanded={expanded}
                            aria-controls={expanded ? `${id}-category-details` : undefined}
                            onClick={(event) => {
                              openerRef.current = event.currentTarget;
                              if (expanded) closeDetails();
                              else setSelection({ scope, kind: 'category', category: change.category });
                            }}
                          >{text.open}</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </>
        )}
        {selectedCategory !== undefined && (
          <div id={`${id}-category-details`}>
            <SpendingDetails
              key={`${scope}:${selectedCategory}`}
              title={`${categoryLabel(selectedCategory)} · ${formatMonthFull(month.name, month.year)} · ${text.currentEntries}`}
              entries={currentEntries.filter((entry) => entry.category === selectedCategory)}
              hideValues={hideValues}
              onClose={closeDetails}
            />
          </div>
        )}
      </div>
      {small.visible && (
        <div className="spending-small-purchases">
          <div className="spending-heading">
            <h4 className="spending-title">{text.smallTitle}</h4>
            <button
              type="button"
              className="spending-button spending-action"
              aria-label={`${text.open}: ${text.smallTitle}`}
              aria-expanded={showSmallDetails}
              aria-controls={showSmallDetails ? `${id}-small-details` : undefined}
              onClick={(event) => {
                openerRef.current = event.currentTarget;
                if (showSmallDetails) closeDetails();
                else setSelection({ scope, kind: 'small' });
              }}
            >{text.open}</button>
          </div>
          <p className="spending-small-summary">{text.smallSummary.replace('{count}', String(small.entries.length)).replace('{threshold}', hideValues ? text.hidden : money(small.thresholdCents)).replace('{total}', hideValues ? text.hidden : money(small.totalCents))}</p>
          <p className="spending-note">{text.smallHint}</p>
          {showSmallDetails && (
            <div id={`${id}-small-details`}>
              <SpendingDetails key={`${scope}:small`} title={`${text.smallTitle} · ${formatMonthFull(month.name, month.year)}`} entries={small.entries} hideValues={hideValues} onClose={closeDetails} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
