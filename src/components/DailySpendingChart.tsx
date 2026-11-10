import { useId, useRef, useState } from 'react';
import { usePreferences, type AppLocale } from '../i18n';
import { getMonthIndex, type BudgetMonth } from '../types';
import { centsToAmount } from '../services/cardTransactions';
import type { ChartSource } from '../services/financeCharts';
import { getDailySpending, getSpendingEntries, isMonthInProgress } from '../services/spendingInsights';
import { SpendingDetails } from './SpendingDetails';

interface Props {
  month: BudgetMonth;
  hideValues?: boolean;
}

const copy: Record<AppLocale, Record<string, string>> = {
  'pt-BR': {
    title: 'Gastos por dia',
    total: 'Total pessoal no calendário',
    basis: 'Somente datas informadas deste mês, sem parcelas. Não são vencimentos.',
    coverage: '{included} de {total} lançamentos pessoais no calendário.',
    excluded: 'Fora do calendário (grupos sem sobreposição)',
    undated: 'Sem data',
    installments: 'Parcelas',
    outside: 'Data fora deste mês',
    records: 'lançamento(s)',
    empty: 'Nenhum lançamento com data deste mês e sem parcelas.',
    noRecords: 'Sem lançamentos registrados',
    upcoming: 'Não transcorrido',
    recorded: 'Registro futuro',
    today: 'Hoje',
    hidden: 'Valor oculto',
    open: 'Ver lançamentos',
    hint: 'Toque em um dia com registros para ver os lançamentos abaixo.',
    future: 'Mês não iniciado. Os valores são registros, não gastos já realizados.',
  },
  en: {
    title: 'Daily spending',
    total: 'Personal total in the calendar',
    basis: 'Only provided dates in this month, excluding installments. These are not due dates.',
    coverage: '{included} of {total} personal transactions in the calendar.',
    excluded: 'Outside the calendar (non-overlapping groups)',
    undated: 'No date',
    installments: 'Installments',
    outside: 'Date outside this month',
    records: 'transaction(s)',
    empty: 'No dated, non-installment transactions in this month.',
    noRecords: 'No transactions recorded',
    upcoming: 'Not elapsed',
    recorded: 'Future record',
    today: 'Today',
    hidden: 'Amount hidden',
    open: 'View transactions',
    hint: 'Tap a day with records to see its transactions below.',
    future: 'This month has not started. Amounts are records, not spending already incurred.',
  },
};

const sources: ChartSource[] = ['all', 'card', 'account'];

export function DailySpendingChart({ month, hideValues = false }: Props) {
  const { t, formatMoney, formatMonthFull, locale } = usePreferences();
  const text = copy[locale];
  const id = useId();
  const [source, setSource] = useState<ChartSource>('all');
  const [selection, setSelection] = useState<{ scope: string; date: string } | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const scope = `${month.id}:${month.year}:${month.name}:${source}`;
  const daily = getDailySpending(month, source);
  const entries = getSpendingEntries(month, source);
  const includedCount = daily.days.reduce((count, day) => count + day.entries.length, 0);
  const includedIds = new Set(daily.days.flatMap((day) => day.entries.map((entry) => entry.id)));
  const excluded = entries.filter((entry) => !includedIds.has(entry.id));
  const exclusions = [
    { label: text.undated, count: excluded.filter((entry) => !entry.isInstallment && !entry.date).length, cents: daily.undatedCents },
    { label: text.installments, count: excluded.filter((entry) => entry.isInstallment).length, cents: daily.installmentCents },
    { label: text.outside, count: excluded.filter((entry) => !entry.isInstallment && entry.date).length, cents: daily.outsidePeriodCents },
  ];
  const today = new Date();
  const monthIndex = getMonthIndex(month.name);
  const inProgress = isMonthInProgress(month, today);
  const futureMonth = monthIndex >= 0 && (month.year > today.getFullYear() || (month.year === today.getFullYear() && monthIndex > today.getMonth()));
  const selectedDay = selection?.scope === scope ? daily.days.find((day) => day.date === selection.date && day.entries.length > 0) : undefined;
  const dateFormatter = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, { dateStyle: 'long', timeZone: 'UTC' });
  const weekdayFormatter = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, { weekday: 'short', timeZone: 'UTC' });
  const firstWeekday = daily.days.length ? new Date(`${daily.days[0].date}T12:00:00Z`).getUTCDay() : 0;
  const money = (cents: number) => hideValues ? '••••' : formatMoney(centsToAmount(cents));
  const closeDetails = () => {
    setSelection(null);
    if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
  };

  return (
    <section className="spending-insights spending-daily" aria-labelledby={`${id}-title`}>
      <div className="spending-heading">
        <h3 id={`${id}-title`} className="spending-title">{text.title}</h3>
        <span className="spending-note">{formatMonthFull(month.name, month.year)}</span>
      </div>
      <div className="spending-source-toggle" role="group" aria-label={t('chartSourceToggleLabel')}>
        {sources.map((option) => (
          <button key={option} type="button" className="spending-button" aria-pressed={source === option} onClick={() => { setSource(option); setSelection(null); }}>
            {option === 'all' ? t('chartSourceAll') : option === 'card' ? t('chartSourceCardShort') : t('debitPix')}
          </button>
        ))}
      </div>
      <div className="spending-daily-summary">
        <span className="spending-note">{text.total}</span>
        <strong className="spending-money spending-headline" aria-label={hideValues ? text.hidden : undefined}>{money(daily.totalCents)}</strong>
      </div>
      <p className="spending-note">{text.basis}</p>
      {futureMonth && <p className="spending-notice" role="note">{text.future}</p>}
      <p className="spending-note" aria-live="polite">{text.coverage.replace('{included}', String(includedCount)).replace('{total}', String(entries.length))}</p>
      {includedCount === 0 && <p className="spending-empty">{text.empty}</p>}
      {daily.days.length > 0 && (
        <div className="spending-calendar" aria-label={text.title}>
          <div className="spending-weekdays" aria-hidden="true">
            {Array.from({ length: 7 }, (_, index) => <span key={index}>{weekdayFormatter.format(new Date(Date.UTC(2024, 0, 7 + index)))}</span>)}
          </div>
          <div className="spending-days">
            {daily.days.map((day, index) => {
              const upcoming = futureMonth || (inProgress && day.day > today.getDate());
              const hasEntries = day.entries.length > 0;
              const selected = selectedDay?.date === day.date;
              const dateLabel = dateFormatter.format(new Date(`${day.date}T12:00:00Z`));
              const status = upcoming ? text.upcoming : inProgress && day.day === today.getDate() ? text.today : '';
              const description = hasEntries ? `${day.entries.length} ${text.records}, ${hideValues ? text.hidden : money(day.cents)}. ${text.open}` : text.noRecords;
              return (
                <button
                  key={day.date}
                  type="button"
                  className={`spending-day${upcoming ? ' spending-day-upcoming' : ''}${hasEntries ? ' spending-day-recorded' : ''}${!hideValues && day.cents < 0 ? ' spending-day-refund' : ''}`}
                  style={index === 0 ? { gridColumnStart: firstWeekday + 1 } : undefined}
                  aria-label={`${dateLabel}. ${status ? `${status}. ` : ''}${description}`}
                  aria-current={inProgress && day.day === today.getDate() ? 'date' : undefined}
                  aria-expanded={hasEntries ? selected : undefined}
                  aria-controls={selected ? `${id}-details` : undefined}
                  aria-disabled={!hasEntries}
                  onClick={(event) => {
                    if (!hasEntries) return;
                    openerRef.current = event.currentTarget;
                    if (selected) closeDetails();
                    else setSelection({ scope, date: day.date });
                  }}
                >
                  <span className="spending-day-number">{day.day}</span>
                  <span className="spending-day-value">{hasEntries ? money(day.cents) : '—'}</span>
                  {upcoming && <span className="spending-day-status">{hasEntries ? text.recorded : text.upcoming}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {includedCount > 0 && <p className="spending-note">{text.hint}</p>}
      <div className="spending-exclusions">
        <h4 className="spending-note">{text.excluded}</h4>
        <dl className="spending-exclusion-list">
          {exclusions.map((item) => (
            <div key={item.label}>
              <dt>{item.label} <span className="spending-note">· {item.count} {text.records}</span></dt>
              <dd className="spending-money" aria-label={hideValues ? text.hidden : undefined}>{money(item.cents)}</dd>
            </div>
          ))}
        </dl>
      </div>
      {selectedDay && (
        <div id={`${id}-details`}>
          <SpendingDetails key={`${scope}:${selectedDay.date}`} title={`${text.title} · ${dateFormatter.format(new Date(`${selectedDay.date}T12:00:00Z`))}`} entries={selectedDay.entries} hideValues={hideValues} onClose={closeDetails} />
        </div>
      )}
    </section>
  );
}
