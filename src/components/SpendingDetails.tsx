import { useId, useRef, useState, useEffect } from 'react';
import { usePreferences, type AppLocale } from '../i18n';
import { centsToAmount } from '../services/cardTransactions';
import type { SpendingEntry } from '../services/spendingInsights';

interface Props {
  title: string;
  entries: SpendingEntry[];
  hideValues?: boolean;
  onClose: () => void;
}

const copy: Record<AppLocale, Record<string, string>> = {
  'pt-BR': {
    search: 'Pesquisar estabelecimento ou categoria',
    sort: 'Ordenar lançamentos',
    amount: 'Maior valor',
    date: 'Data mais recente',
    original: 'Total original · minha parte',
    filtered: 'Total filtrado · minha parte',
    count: 'lançamento(s)',
    undated: 'Sem data informada',
    hidden: 'Valor oculto',
    empty: 'Nenhum lançamento nesta lista.',
    noResults: 'Nenhum lançamento corresponde à pesquisa.',
    signed: 'Valores da minha parte; estornos são negativos.',
    list: 'Lista de lançamentos',
  },
  en: {
    search: 'Search merchant or category',
    sort: 'Sort transactions',
    amount: 'Highest amount',
    date: 'Most recent date',
    original: 'Original total · my share',
    filtered: 'Filtered total · my share',
    count: 'transaction(s)',
    undated: 'No date provided',
    hidden: 'Amount hidden',
    empty: 'No transactions in this list.',
    noResults: 'No transactions match your search.',
    signed: 'Amounts are my share; refunds are negative.',
    list: 'Transaction list',
  },
};

export function SpendingDetails({ title, entries, hideValues = false, onClose }: Props) {
  const { t, formatMoney, categoryLabel, locale } = usePreferences();
  const text = copy[locale];
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'amount' | 'date'>('amount');
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(locale);
  const category = (entry: SpendingEntry) => entry.category ? categoryLabel(entry.category) : t('noCategory');
  const search = normalize(query.trim());
  const filtered = entries.filter((entry) => normalize(`${entry.merchant} ${category(entry)}`).includes(search));
  const originalCents = entries.reduce((total, entry) => total + entry.cents, 0);
  const filteredCents = filtered.reduce((total, entry) => total + entry.cents, 0);
  const compareDates = (a: SpendingEntry, b: SpendingEntry) => (b.date ?? '').localeCompare(a.date ?? '');
  const sorted = [...filtered].sort((a, b) => {
    const order = sort === 'amount' ? b.cents - a.cents || compareDates(a, b) : compareDates(a, b) || b.cents - a.cents;
    return order || a.merchant.localeCompare(b.merchant, locale) || a.id.localeCompare(b.id);
  });
  const money = (cents: number) => hideValues ? '••••' : formatMoney(centsToAmount(cents));
  const dateFormatter = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : locale, {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      className="spending-insights spending-details"
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="spending-heading">
        <h4 id={`${id}-title`} ref={headingRef} tabIndex={-1} className="spending-title">{title}</h4>
        <button type="button" className="spending-button" onClick={onClose}>{t('close')}</button>
      </div>
      <p className="spending-note">{text.signed}</p>
      <div className="spending-details-controls">
        <label className="spending-field" htmlFor={`${id}-search`}>
          <span>{text.search}</span>
          <input id={`${id}-search`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} autoComplete="off" />
        </label>
        <label className="spending-field" htmlFor={`${id}-sort`}>
          <span>{text.sort}</span>
          <select id={`${id}-sort`} value={sort} onChange={(event) => setSort(event.target.value === 'date' ? 'date' : 'amount')}>
            <option value="amount">{text.amount}</option>
            <option value="date">{text.date}</option>
          </select>
        </label>
      </div>
      <div className="spending-details-summary" aria-live="polite" aria-atomic="true">
        <dl className="spending-totals">
          <div><dt>{text.original}</dt><dd className="spending-money" aria-label={hideValues ? text.hidden : undefined}>{money(originalCents)}</dd></div>
          <div><dt>{text.filtered}</dt><dd className="spending-money" aria-label={hideValues ? text.hidden : undefined}>{money(filteredCents)}</dd></div>
        </dl>
        <p className="spending-note">{filtered.length} {t('of')} {entries.length} {text.count}</p>
      </div>
      <div className="spending-details-scroll" role="region" aria-label={text.list} tabIndex={0}>
        {sorted.length === 0 ? (
          <p className="spending-empty">{entries.length === 0 ? text.empty : text.noResults}</p>
        ) : (
          <ul className="spending-entry-list">
            {sorted.map((entry) => (
              <li key={entry.id} className="spending-entry">
                <div className="spending-entry-info">
                  <span className="spending-entry-name">{entry.merchant}</span>
                  <span className="spending-entry-meta">
                    {category(entry)} · {entry.source === 'card' ? t('chartSourceCardShort') : t('debitPix')}
                    {' · '}{entry.date ? <time dateTime={entry.date}>{dateFormatter.format(new Date(`${entry.date}T12:00:00Z`))}</time> : text.undated}
                    {entry.isInstallment && <> · {t('installments')}</>}
                  </span>
                </div>
                <span className={`spending-money${!hideValues && entry.cents < 0 ? ' spending-positive' : ''}`} aria-label={hideValues ? text.hidden : undefined}>
                  {money(entry.cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
