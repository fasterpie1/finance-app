import { useMemo, useState } from 'react';
import type { BudgetMonth } from '../types';
import { centsToAmount } from '../services/cardTransactions';
import { getSpendingEntries, type SpendingEntry } from '../services/spendingInsights';
import { usePreferences } from '../i18n';

type SourceFilter = 'all' | 'card' | 'account';
type OwnerFilter = 'all' | 'mine' | 'third-party' | 'shared' | 'unclassified' | 'refunds';

interface Props {
  month: BudgetMonth;
  onAdd: () => void;
}

const copy = {
  'pt-BR': {
    title: 'Transações',
    search: 'Buscar por compra ou categoria',
    all: 'Todos',
    card: 'Cartão',
    account: 'Conta',
    source: 'Origem',
    owner: 'Responsável',
    mine: 'Meus',
    thirdParty: 'Terceiros',
    shared: 'Compartilhados',
    unclassified: 'Sem classificação',
    refunds: 'Estornos',
    thirdPartyPart: 'Parte de terceiros',
    myPart: 'Minha parte',
    thirdPartyBy: (name?: string) => name ? `De terceiros · ${name}` : 'De terceiros',
    unclassifiedLabel: 'Sem classificação',
    refundLabel: 'Estorno',
    emptyTitle: 'Nenhum lançamento neste mês',
    emptyBody: 'Toque em + para adicionar uma compra com ajuda da IA.',
    noResults: 'Nenhum lançamento encontrado.',
    add: 'Adicionar compra',
    installment: 'Parcela',
    noDate: 'Data não informada',
    count: 'lançamento(s)',
    date: (value: string) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`)),
  },
  en: {
    title: 'Transactions',
    search: 'Search purchases or categories',
    all: 'All',
    card: 'Card',
    account: 'Account',
    source: 'Source',
    owner: 'Owner',
    mine: 'Mine',
    thirdParty: 'Third parties',
    shared: 'Shared',
    unclassified: 'Unclassified',
    refunds: 'Refunds',
    thirdPartyPart: 'Third-party portion',
    myPart: 'My portion',
    thirdPartyBy: (name?: string) => name ? `Third party · ${name}` : 'Third party',
    unclassifiedLabel: 'Unclassified',
    refundLabel: 'Refund',
    emptyTitle: 'No transactions this month',
    emptyBody: 'Tap + to add a purchase with help from AI.',
    noResults: 'No transactions found.',
    add: 'Add purchase',
    installment: 'Installment',
    noDate: 'Date not provided',
    count: 'transaction(s)',
    date: (value: string) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`)),
  },
} as const;

export function TransactionsView({ month, onAdd }: Props) {
  const { locale, formatMoney, categoryLabel } = usePreferences();
  const text = copy[locale];
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [owner, setOwner] = useState<OwnerFilter>('all');
  const entries = useMemo(() => getSpendingEntries(month, 'all', true), [month]);
  const normalizedQuery = query.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase(locale);
  const filtered = entries
    .filter((entry) => source === 'all' || entry.source === source)
    .filter((entry) => matchesOwnerFilter(entry, owner))
    .filter((entry) => !normalizedQuery || normalizeEntry(entry, categoryLabel).includes(normalizedQuery))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id.localeCompare(a.id));

  return (
    <section className="transactions-view" aria-labelledby="transactions-title">
      <header className="transactions-heading">
        <div>
          <span className="transactions-eyebrow">{month.name} {month.year}</span>
          <h1 id="transactions-title">{text.title}</h1>
        </div>
        <span className="transactions-count">{filtered.length}</span>
      </header>

      <label className="transactions-search">
        <span aria-hidden="true">⌕</span>
        <span className="sr-only">{text.search}</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} />
      </label>

      <div className="transactions-filter-groups">
        <div className="transactions-filter-group">
          <span>{text.source}</span>
          <div className="transactions-filters" role="group" aria-label={text.source}>
            {(['all', 'card', 'account'] as const).map((filter) => (
              <button type="button" key={filter} onClick={() => setSource(filter)} aria-pressed={source === filter} className={source === filter ? 'is-selected' : undefined}>
                {text[filter]}
              </button>
            ))}
          </div>
        </div>
        <div className="transactions-filter-group">
          <span>{text.owner}</span>
          <div className="transactions-filters transactions-owner-filters" role="group" aria-label={text.owner}>
            {([
              ['all', text.all],
              ['mine', text.mine],
              ['third-party', text.thirdParty],
              ['shared', text.shared],
              ['unclassified', text.unclassified],
              ['refunds', text.refunds],
            ] as const).map(([filter, label]) => (
              <button type="button" key={filter} onClick={() => setOwner(filter)} aria-pressed={owner === filter} className={owner === filter ? 'is-selected' : undefined}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="transactions-empty">
          <span className="transactions-empty-icon" aria-hidden="true">↗</span>
          <strong>{entries.length === 0 && !query && source === 'all' ? text.emptyTitle : text.noResults}</strong>
          {entries.length === 0 && !query && source === 'all' && <p>{text.emptyBody}</p>}
          {entries.length === 0 && !query && source === 'all' && <button type="button" onClick={onAdd}>{text.add}</button>}
        </div>
      ) : (
        <ul className="transactions-list">
          {filtered.map((entry) => (
            <li className="transactions-row" key={entry.id}>
              <span className="transactions-category-mark" aria-hidden="true">{categoryLabel(entry.category ?? 'outros').slice(0, 1)}</span>
              <span className="transactions-row-main">
                <strong>{entry.merchant}</strong>
                <small>
                  {categoryLabel(entry.category ?? 'outros')}
                  {' · '}{entry.source === 'card' ? text.card : text.account}
                  {' · '}{entry.date ? text.date(entry.date) : text.noDate}
                  {entry.isInstallment && ` · ${text.installment}`}
                  {entry.owner === 'THIRD_PARTY' && ` · ${text.thirdPartyBy(entry.thirdPartyName)}`}
                  {entry.owner === 'UNCLASSIFIED' && ` · ${text.unclassifiedLabel}`}
                  {entry.isRefund && ` · ${text.refundLabel}`}
                </small>
                {entry.owner === 'SHARED' && (
                  <small>
                    {text.myPart}: {formatSignedMoney(entry.cents, formatMoney)}
                    {' · '}{text.thirdPartyPart}: {formatSignedMoney(entry.thirdPartyCents ?? 0, formatMoney)}
                  </small>
                )}
              </span>
              <span className={`transactions-amount${displayCents(entry, owner) < 0 ? ' is-refund' : ''}`}>
                {formatSignedMoney(displayCents(entry, owner), formatMoney)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {filtered.length > 0 && <p className="transactions-summary">{filtered.length} {text.count}</p>}
    </section>
  );
}

function matchesOwnerFilter(entry: SpendingEntry, owner: OwnerFilter): boolean {
  switch (owner) {
    case 'mine':
      return (entry.owner === 'ME' || entry.owner === 'SHARED') && entry.cents !== 0;
    case 'third-party':
      return (entry.thirdPartyCents ?? 0) !== 0;
    case 'shared':
      return entry.owner === 'SHARED';
    case 'unclassified':
      return entry.owner === 'UNCLASSIFIED';
    case 'refunds':
      return entry.isRefund === true;
    default:
      return true;
  }
}

function displayCents(entry: SpendingEntry, owner: OwnerFilter): number {
  if (owner === 'third-party' && entry.owner === 'SHARED') return entry.thirdPartyCents ?? 0;
  if (entry.owner === 'THIRD_PARTY' || entry.owner === 'UNCLASSIFIED') return entry.grossCents ?? entry.cents;
  return entry.cents;
}

function formatSignedMoney(cents: number, formatMoney: (amount: number) => string): string {
  return `${cents < 0 ? '+' : ''}${formatMoney(centsToAmount(Math.abs(cents)))}`;
}

function normalizeEntry(entry: SpendingEntry, categoryLabel: (category: NonNullable<SpendingEntry['category']>) => string): string {
  return `${entry.merchant} ${entry.thirdPartyName ?? ''} ${entry.category ? categoryLabel(entry.category) : ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}
