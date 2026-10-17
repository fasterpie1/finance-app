import { MONTH_NAMES, MONTH_NAMES_EN, type Bill, type BudgetMonth, type CategoryId, type CreditCardInvoice, type CreditCardTransaction } from '../types';
import {
  centsToAmount,
  getCardCharges,
  getCardTotalWithPendingBillsCents,
  getChargeImpactCents,
  getPersonalImpactCents,
  isOnCreditCardBill,
  sortInvoiceTransactions,
} from './cardTransactions';
import { getInvoiceCardLabel, groupInvoicesByCard, resolveBillCardId, resolveInvoiceCardId, type PaymentCard } from './paymentCards';
import { getCardCategoryAmountCents, getCardChartCategories, getCardChartMonths, getCategoryChartData } from './financeCharts';

/**
 * Tudo que a assistente precisa para enxergar o aplicativo inteiro. As somas vêm das mesmas
 * funções das telas: se o número for calculado aqui de novo, ele briga com o que está na tela.
 */
export interface AssistantUniverse {
  months: BudgetMonth[];
  cards: PaymentCard[];
  selectedMonth: BudgetMonth;
  money: (amount: number) => string;
  categoryLabel: (category: CategoryId) => string;
  categoryNames: string[];
  /** Os três números do painel do mês aberto, calculados na store. A IA não pode recalculá-los. */
  dashboard: { totalPlanned: number; totalPaid: number; remaining: number };
}

export type AssistantIntent = 'comparison' | 'category' | 'chart' | 'diagnosis' | 'savings' | 'goal' | 'bills' | 'cashflow' | 'invoice' | 'action' | 'calendar' | 'app_help' | 'general';

export function classifyAssistantIntents(question: string, universe: AssistantUniverse, hasImage = false): AssistantIntent[] {
  const value = normalize(question);
  const intents = new Set<AssistantIntent>();
  if (hasImage) intents.add('invoice');
  if (/\b(compar\w*|versus|vs|diferenc\w*|melhor\w*|pior\w*|mes passado|mes anterior|last month|previous month)\b/.test(value)) intents.add('comparison');
  if (/\b(grafico\w*|chart\w*|evolu\w*|tendenc\w*)\b/.test(value)) intents.add('chart');
  if (universe.categoryNames.some((category) => containsPhrase(value, category))) intents.add('category');
  if (/\b(onde econom\w*|economiz\w*|desperdic\w*|gastar menos|save money)\b/.test(value)) intents.add('savings');
  if (/\b(meta|limite|objetivo|poup\w*|guard\w*|goal|budget)\b/.test(value)) intents.add('goal');
  if (/\b(conta\w*|venc\w*|fatura\w*|pendente\w*|bill\w*|invoice|due)\b/.test(value)) intents.add('bills');
  if (/\b(saldo|fluxo de caixa|dispon\w*|previs\w*|projec\w*|cash flow|balance)\b/.test(value)) intents.add('cashflow');
  if (/\b(diagnostico|financeiramente|receita|renda|income|financial health)\b/.test(value)) intents.add('diagnosis');
  if (/\b(agenda|lembrete|evento|calendar|reminder|event)\b/.test(value)) intents.add('calendar');
  if (/\b(crie|criar|adicion\w*|lanc\w*|registr\w*|alter\w*|mud\w*|marqu\w*|pagu\w*|remov\w*|exclu\w*|mov\w*|atribu\w*|categorize|create|add|update|delete)\b/.test(value)) intents.add('action');
  if (/\b(o que voce consegue fazer|o que posso fazer|como funciona|what can you do)\b/.test(value)) intents.add('app_help');
  if (intents.size === 0) intents.add('general');
  return [...intents];
}

/** Escrito como no scope que a IA devolve ("eu", "terceiro", "compartilhado"). */
function ownerText(transaction: CreditCardTransaction): string {
  if (transaction.owner === 'THIRD_PARTY') return `de terceiro${transaction.thirdPartyName ? ` (${transaction.thirdPartyName})` : ''}`;
  if (transaction.owner === 'SHARED') return `compartilhado${transaction.thirdPartyName ? ` com ${transaction.thirdPartyName}` : ''}`;
  if (transaction.owner === 'UNCLASSIFIED') return 'sem dono';
  return 'eu';
}

export function monthLabel(month: BudgetMonth): string {
  return `${month.name} ${month.year}`;
}

export function getCardMonthTotalsCents(
  invoices: CreditCardInvoice[],
  bills: Bill[],
  cards: PaymentCard[],
): Array<{ cardId: string | undefined; cents: number }> {
  const pendingBills = getCardCharges(invoices, bills).pendingBills;
  const groups = groupInvoicesByCard(invoices, cards);
  const cardIds: Array<string | undefined> = [...cards.map((card) => card.id), undefined];
  return cardIds.filter((cardId) => groups.some((group) => group.cardId === cardId)
    || pendingBills.some((bill) => resolveBillCardId(bill, cards) === cardId))
    .map((cardId) => ({
      cardId,
      cents: getCardTotalWithPendingBillsCents(
        groups.find((group) => group.cardId === cardId)?.invoices ?? [],
        pendingBills.filter((bill) => resolveBillCardId(bill, cards) === cardId),
      ),
    }));
}

/** Os cartões da conta, com o final do plástico que o usuário usa para nomeá-los. */
export function buildCardsSection(universe: AssistantUniverse): string {
  if (universe.cards.length === 0) {
    return 'Cartões cadastrados: nenhum. Todas as faturas deste mês estão agrupadas como "sem cartão". Para mover lançamentos para um cartão, primeiro é preciso criar o cartão.';
  }
  const lines = universe.cards.map((card) => {
    const dueDay = card.dueDay ? ` — vence dia ${card.dueDay}` : '';
    return `- ${card.bank} ${card.last4}${dueDay}`;
  });
  return `Cartões cadastrados nesta conta (cite o cartão sempre assim, "banco final"):\n${lines.join('\n')}`;
}

/** Uma linha por mês, do mais antigo ao mais recente: é o mapa que permite responder sobre
 *  qualquer mês sem mandar o extrato inteiro no prompt. */
export function buildOverviewSection(universe: AssistantUniverse): string {
  const { months, cards, money } = universe;
  const lines = months.map((month) => {
    const invoices = month.creditCardInvoices ?? [];
    const charges = getCardCharges(invoices, month.bills);
    const plainBills = month.bills.filter((bill) => !isOnCreditCardBill(bill));
    const plainTotal = plainBills.reduce((sum, bill) => sum + bill.amount, 0);
    const plainPaid = plainBills.filter((bill) => bill.isPaid).reduce((sum, bill) => sum + bill.amount, 0);
    const perCard = getCardMonthTotalsCents(invoices, month.bills, cards)
      .filter((entry) => entry.cents !== 0)
      .map((entry) => `${entry.cardId ? getInvoiceCardLabel({ cardId: entry.cardId }, cards) || 'cartão removido' : 'sem cartão'} ${money(centsToAmount(entry.cents))}`)
      .join(', ');
    const mark = month.id === universe.selectedMonth.id ? ' ← mês aberto na tela' : '';
    return `- ${monthLabel(month)}${mark}: entrada ${money(month.income)} | contas fora do cartão ${money(plainTotal)} (pagas ${money(plainPaid)}) | fatura ${money(centsToAmount(charges.totalCents))} (minha parte ${money(centsToAmount(charges.personalCents))})${perCard ? ` | por cartão: ${perCard}` : ''} | ${invoices.reduce((sum, invoice) => sum + invoice.transactions.length, 0)} lançamentos no cartão`;
  });
  return `MESES CADASTRADOS (visão geral — o detalhe linha a linha só vem quando você pedir):\n${lines.join('\n')}`;
}

export function buildChartDataSection(universe: AssistantUniverse): string {
  const { selectedMonth, months, money, categoryLabel } = universe;
  const categoryChart = getCategoryChartData(selectedMonth.bills, selectedMonth.creditCardInvoices ?? []);
  const chartMonths = getCardChartMonths(months, selectedMonth.name, selectedMonth.year);
  const cardCategories = getCardChartCategories(months);
  const categoryLines = categoryChart.items.map((item) => (
    `- Fatia ${categoryLabel(item.category)}: ${money(centsToAmount(item.cents))} | ${item.percentage.toFixed(1)}%`
  ));
  const cardLines = cardCategories.map((category) => (
    `- Série ${categoryLabel(category)}: ${chartMonths.map((month) => `${monthLabel(month)} ${money(centsToAmount(getCardCategoryAmountCents(month, category)))}`).join(' | ')}`
  ));

  return [
    `GRÁFICO DE DESPESAS POR CATEGORIA (${monthLabel(selectedMonth)}): total ${money(centsToAmount(categoryChart.totalCents))}. Valores de cartão são minha parte; contas fora do cartão e Débito/Pix entram integralmente; lançamentos sem categoria não aparecem.`,
    ...categoryLines.length ? categoryLines : ['- nenhuma categoria com despesa'],
    `GRÁFICO DE EVOLUÇÃO NO CARTÃO (últimos até 4 meses até ${monthLabel(selectedMonth)}; valores são minha parte, iguais aos pontos do gráfico):`,
    `Meses: ${chartMonths.map((month) => monthLabel(month)).join(', ') || 'nenhum'}`,
    ...cardLines.length ? cardLines : ['- nenhuma categoria disponível'],
  ].join('\n');
}

/** Categorias do mês com os dois números: o bruto da fatura e a minha parte. Sem isso a IA
 *  chamava de "não há registros" um mês em que o gasto era de terceiro. */
export function getAssistantCategoryTotals(month: BudgetMonth, universe: AssistantUniverse): Array<{ label: string; personalCents: number; chargeCents: number; count: number }> {
  const totals = new Map<string, { personalCents: number; chargeCents: number; count: number }>();
  const push = (label: string, personalCents: number, chargeCents: number) => {
    const entry = totals.get(label) ?? { personalCents: 0, chargeCents: 0, count: 0 };
    entry.personalCents += personalCents;
    entry.chargeCents += chargeCents;
    entry.count += 1;
    totals.set(label, entry);
  };
  const invoices = month.creditCardInvoices ?? [];
  const transactions = invoices.flatMap((invoice) => invoice.transactions).filter((transaction) => transaction.type !== 'PAYMENT');
  transactions.forEach((transaction) => {
    const label = transaction.category ? universe.categoryLabel(transaction.category) : 'Sem categoria';
    push(label, getPersonalImpactCents(transaction), getChargeImpactCents(transaction));
  });
  // Só as contas do cartão que ainda não vieram numa fatura importada, senão somam em dobro.
  getCardCharges(invoices, month.bills).pendingBills.forEach((bill) => {
    const cents = Math.round(bill.amount * 100);
    push(universe.categoryLabel(bill.category), cents, cents);
  });
  month.bills.filter((bill) => !isOnCreditCardBill(bill)).forEach((bill) => {
    const cents = Math.round(bill.amount * 100);
    push(universe.categoryLabel(bill.category), cents, cents);
  });
  return [...totals.entries()]
    .sort((a, b) => b[1].chargeCents - a[1].chargeCents)
    .map(([label, entry]) => ({ label, ...entry }));
}

function buildCategorySection(month: BudgetMonth, universe: AssistantUniverse): string {
  const lines = getAssistantCategoryTotals(month, universe)
    .map((entry) => `- ${entry.label}: bruto ${universe.money(centsToAmount(entry.chargeCents))} | minha parte ${universe.money(centsToAmount(entry.personalCents))} | ${entry.count} lançamento(s)`);
  return `Categorias de ${monthLabel(month)} (total dos lançamentos, incluindo contas fora do cartão; "minha parte" tira o de terceiro e o resto da compartilhada):\n${lines.join('\n') || '- nenhuma categoria com lançamentos neste mês'}`;
}

export function answerAssistantQuestion(question: string, universe: AssistantUniverse, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  const value = normalize(question).replace(/,/g, '').replace(/[?!.]+$/g, '').trim();
  if (/^(?:oi|ola|oi tudo bem|ola tudo bem|bom dia|boa tarde|boa noite|hello|hi|hello how are you)$/.test(value)) return t('assistantGreeting');
  if (classifyAssistantIntents(question, universe).includes('chart')) return answerAssistantChartQuestion(question, universe, t);
  const month = universe.selectedMonth;
  const money = universe.money;
  if (value === 'como estou indo financeiramente este mes' || value === 'how am i doing financially this month') {
    return t('assistantMonthSummary', {
      month: monthLabel(month), income: money(month.income), planned: money(universe.dashboard.totalPlanned),
      paid: money(universe.dashboard.totalPaid), pending: money(universe.dashboard.totalPlanned - universe.dashboard.totalPaid), remaining: money(universe.dashboard.remaining),
    });
  }
  const categoryLabel = universe.categoryNames.find((category) => containsPhrase(value, category));
  const mentionsSpending = /\b(gastei|gasto|despesa|total|spend|spent|purchases|shopping)\b/.test(value);
  const comparesPeriods = /\b(compar|diferenc|versus|vs|melhor|pior|mes passado|mes anterior|last month|previous month)\b/.test(value);
  const mentionedMonths = universe.months.filter((candidate) => (
    containsPhrase(value, monthLabel(candidate)) || containsPhrase(value, candidate.name)
  ));
  if (categoryLabel && comparesPeriods && (mentionsSpending || universe.categoryNames.some((category) => containsPhrase(value, category)))) {
    let previousMonth: BudgetMonth | undefined;
    let currentMonth = month;
    if (mentionedMonths.length >= 2) {
      previousMonth = mentionedMonths.at(-2);
      currentMonth = mentionedMonths.at(-1) ?? month;
    } else if (mentionedMonths.length === 1 && mentionedMonths[0].id !== month.id) {
      previousMonth = mentionedMonths[0];
    } else {
      previousMonth = resolveMonthRef(universe, 'mês passado');
    }
    if (previousMonth && currentMonth.id !== previousMonth.id) {
      const totalsFor = (target: BudgetMonth) => getAssistantCategoryTotals(target, universe)
        .find((entry) => normalize(entry.label) === normalize(categoryLabel))
        ?? { label: categoryLabel, personalCents: 0, chargeCents: 0, count: 0 };
      const previous = totalsFor(previousMonth);
      const current = totalsFor(currentMonth);
      const today = new Date();
      const portugueseMonth = MONTH_NAMES.findIndex((name) => normalize(name) === normalize(currentMonth.name));
      const englishMonth = MONTH_NAMES_EN.findIndex((name) => normalize(name) === normalize(currentMonth.name));
      const currentIsOpen = currentMonth.id === month.id && currentMonth.year === today.getFullYear()
        && (portugueseMonth >= 0 ? portugueseMonth : englishMonth) === today.getMonth();
      const percentage = currentIsOpen
        ? t('assistantPartialMonthComparison')
        : previous.chargeCents === 0
          ? t('assistantNoPercentageBase')
          : `${((current.chargeCents - previous.chargeCents) / previous.chargeCents * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
      return t('assistantCategoryComparison', {
        category: categoryLabel,
        previousMonth: monthLabel(previousMonth), currentMonth: monthLabel(currentMonth),
        previousTotal: money(centsToAmount(previous.chargeCents)), currentTotal: money(centsToAmount(current.chargeCents)),
        previousPersonal: money(centsToAmount(previous.personalCents)), currentPersonal: money(centsToAmount(current.personalCents)),
        previousCount: previous.count, currentCount: current.count,
        difference: money(centsToAmount(current.chargeCents - previous.chargeCents)), percentage,
        periodNote: currentIsOpen ? t('assistantPartialMonthNote') : '',
      });
    }
  }
  const historicalCategoryMonth = mentionedMonths.at(-1)
    ?? (/\b(mes passado|mes anterior|last month)\b/.test(value) ? resolveMonthRef(universe, 'mês passado') : undefined);
  if (categoryLabel && mentionsSpending && historicalCategoryMonth && historicalCategoryMonth.id !== month.id) {
    const entry = getAssistantCategoryTotals(historicalCategoryMonth, universe)
      .find((item) => normalize(item.label) === normalize(categoryLabel));
    return t('assistantCategorySummary', {
      month: monthLabel(historicalCategoryMonth), category: categoryLabel,
      total: money(centsToAmount(entry?.chargeCents ?? 0)), personal: money(centsToAmount(entry?.personalCents ?? 0)),
      count: entry?.count ?? 0,
    });
  }
  if (categoryLabel && mentionsSpending && categoryLabel !== universe.categoryLabel('compras')) {
    const entry = getAssistantCategoryTotals(month, universe).find((item) => normalize(item.label) === normalize(categoryLabel));
    return t('assistantCategorySummary', {
      month: monthLabel(month), category: categoryLabel,
      total: money(centsToAmount(entry?.chargeCents ?? 0)), personal: money(centsToAmount(entry?.personalCents ?? 0)),
      count: entry?.count ?? 0,
    });
  }
  const purchases = /^(?:(?:o que|que|quanto)(?: eu)? gastei(?: (?:n?esse|este) mes)? (?:com|em|na categoria) compras|qual (?:e )?o total (?:de )?compras(?: (?:n?esse|este) mes)?|how much (?:did i spend|have i spent)(?: this month)? on (?:purchases|shopping))$/.test(value);
  const card = /^(?:qual (?:e )?o total da fatura(?: (?:deste|desse) mes)?|quanto (?:eu )?gastei no cartao(?: (?:n?esse|este) mes)?|what is my card invoice total)$/.test(value);
  if (!purchases && !card) return null;
  const charges = getCardCharges(month.creditCardInvoices ?? [], month.bills);
  const cardSummary = t('assistantCardSummary', { month: monthLabel(month), personal: money(centsToAmount(charges.personalCents)), invoice: money(centsToAmount(charges.totalCents)) });
  if (card) return cardSummary;
  const category = getAssistantCategoryTotals(month, universe).find((entry) => entry.label === universe.categoryLabel('compras'));
  const unclassified = (month.creditCardInvoices ?? []).flatMap((invoice) => invoice.transactions).filter((transaction) => transaction.type !== 'PAYMENT' && !transaction.category).length;
  return [
    cardSummary,
    t('assistantPurchasesCategory', { personal: money(centsToAmount(category?.personalCents ?? 0)), total: money(centsToAmount(category?.chargeCents ?? 0)) }),
    unclassified ? t('assistantUncategorized', { count: unclassified }) : '',
  ].filter(Boolean).join('\n');
}

function answerAssistantChartQuestion(question: string, universe: AssistantUniverse, t: (key: string, params?: Record<string, string | number>) => string): string {
  const { selectedMonth, months, money, categoryLabel } = universe;
  const chartMonths = getCardChartMonths(months, selectedMonth.name, selectedMonth.year);
  const requestedCategory = universe.categoryNames.find((category) => containsPhrase(question, category));
  const knownCategories = [...new Set(months.flatMap((month) => [
    ...month.bills.map((bill) => bill.category),
    ...(month.creditCardInvoices ?? []).flatMap((invoice) => invoice.transactions.map((transaction) => transaction.category).filter((category): category is CategoryId => Boolean(category))),
  ]))];
  const requestedCategoryId = requestedCategory && knownCategories.find((category) => normalize(categoryLabel(category)) === normalize(requestedCategory));
  const categoryChart = getCategoryChartData(selectedMonth.bills, selectedMonth.creditCardInvoices ?? []);
  const cardCategories = getCardChartCategories(months);
  if (requestedCategory && requestedCategoryId) {
    const values = chartMonths.map((chartMonth) => getCardCategoryAmountCents(chartMonth, requestedCategoryId));
    const first = values[0] ?? 0;
    const last = values.at(-1) ?? 0;
    const today = new Date();
    const portugueseMonth = MONTH_NAMES.findIndex((name) => normalize(name) === normalize(selectedMonth.name));
    const englishMonth = MONTH_NAMES_EN.findIndex((name) => normalize(name) === normalize(selectedMonth.name));
    const currentIsOpen = selectedMonth.year === today.getFullYear()
      && (portugueseMonth >= 0 ? portugueseMonth : englishMonth) === today.getMonth();
    const percentage = currentIsOpen
      ? t('assistantPartialMonthComparison')
      : first === 0
        ? t('assistantNoPercentageBase')
        : `${((last - first) / first * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    const categoryItem = categoryChart.items.find((item) => item.category === requestedCategoryId);
    const series = chartMonths.map((chartMonth, index) => (
      `${chartMonth.name.slice(0, 3)} ${String(chartMonth.year).slice(-2)} ${money(centsToAmount(values[index] ?? 0))}`
    )).join(' → ');
    return t('assistantChartDetail', {
      category: requestedCategory,
      series: series || 'sem meses disponíveis',
      difference: money(centsToAmount(last - first)),
      percentage,
      month: monthLabel(selectedMonth),
      categoryTotal: money(centsToAmount(categoryItem?.cents ?? 0)),
      categoryPercentage: `${(categoryItem?.percentage ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`,
      periodNote: currentIsOpen ? t('assistantPartialMonthNote') : '',
    });
  }

  const categoryHighlights = categoryChart.items.slice(0, 3).map((item) => (
    `${categoryLabel(item.category)} ${money(centsToAmount(item.cents))} (${item.percentage.toLocaleString(undefined, { maximumFractionDigits: 1 })}%)`
  )).join('; ') || 'sem gastos categorizados';
  const cardTrends = cardCategories.map((category) => {
    const values = chartMonths.map((chartMonth) => getCardCategoryAmountCents(chartMonth, category));
    return { category, values, difference: (values.at(-1) ?? 0) - (values[0] ?? 0) };
  }).filter((series) => series.values.some((value) => value !== 0))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
    .slice(0, 3)
    .map(({ category, values }) => `${categoryLabel(category)}: ${chartMonths.map((chartMonth, index) => `${chartMonth.name.slice(0, 3)} ${String(chartMonth.year).slice(-2)} ${money(centsToAmount(values[index] ?? 0))}`).join(' → ')}`)
    .join('; ') || 'sem séries com valores';
  return t('assistantChartOverview', { month: monthLabel(selectedMonth), categoryHighlights, cardTrends });
}

function buildBillLines(month: BudgetMonth, universe: AssistantUniverse): string {
  const bills = [...month.bills].sort((a, b) => a.dueDay - b.dueDay);
  if (bills.length === 0) return `Contas lançadas em ${monthLabel(month)}: nenhuma.`;
  return `Contas lançadas em ${monthLabel(month)}:\n${bills.map((bill) => {
    const payment = isOnCreditCardBill(bill)
      ? `no cartão ${getInvoiceCardLabel({ cardId: resolveBillCardId(bill, universe.cards) }, universe.cards) || '(sem cartão identificado)'}`
      : 'fora do cartão';
    return `- ${bill.name} (${universe.categoryLabel(bill.category)}) ${universe.money(bill.amount)} — dia ${bill.dueDay}${bill.installmentCurrent && bill.installmentTotal && bill.installmentTotal > 1 ? ` — parcela ${bill.installmentCurrent}/${bill.installmentTotal}` : ''} — ${payment} — ${bill.isPaid ? 'paga' : 'pendente'}`;
  }).join('\n')}`;
}

function buildIncomeSourcesSection(month: BudgetMonth, universe: AssistantUniverse): string {
  const sources = month.incomeSources ?? [];
  if (sources.length === 0) return `Fontes de renda de ${monthLabel(month)}: não detalhadas; o app só informa entrada total ${universe.money(month.income)}.`;
  return `Fontes de renda de ${monthLabel(month)}: ${sources.map((source) => `${source.label} ${universe.money(source.amount)}`).join(', ')}.`;
}

function buildSavingsGoalSection(month: BudgetMonth, universe: AssistantUniverse): string {
  const saved = month.savedAmount;
  if (month.savingsGoalMode !== 'manual' || month.savingsGoal === undefined) {
    return `Meta manual de poupança de ${monthLabel(month)}: não cadastrada${saved === undefined ? '.' : `; valor guardado informado ${universe.money(saved)}.`} Não há limites de gastos por categoria neste módulo.`;
  }
  const remaining = month.savingsGoal - (saved ?? 0);
  const percentage = saved === undefined || month.savingsGoal <= 0 ? 'percentual indisponível' : `${((saved / month.savingsGoal) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}% atingido`;
  return `Meta manual de poupança de ${monthLabel(month)}: ${universe.money(month.savingsGoal)} | guardado ${saved === undefined ? 'não informado' : universe.money(saved)} | restante ${saved === undefined ? 'não calculável' : universe.money(remaining)} | ${percentage}.`;
}

/** O mês inteiro linha a linha estoura os tokens por minuto da Groq gratuita: entram os maiores e
 *  o resto fica apenas contado. Os totais por categoria continuam com todos os lançamentos. */
const MAX_DETAIL_LINES = 60;

function buildTransactionLines(month: BudgetMonth, universe: AssistantUniverse): string {
  const invoices = month.creditCardInvoices ?? [];
  const transactions = sortInvoiceTransactions(invoices.flatMap((invoice) => invoice.transactions).filter((transaction) => transaction.type !== 'PAYMENT'));
  if (transactions.length === 0) return `Lançamentos da fatura de ${monthLabel(month)}: nenhum.`;
  const shown = transactions.length > MAX_DETAIL_LINES
    ? [...transactions].sort((a, b) => Math.abs(getChargeImpactCents(b)) - Math.abs(getChargeImpactCents(a))).slice(0, MAX_DETAIL_LINES)
    : transactions;
  const rest = transactions.length - shown.length;
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  return `Lançamentos da fatura de ${monthLabel(month)} (dia | estabelecimento | bruto | minha parte | categoria | dono | cartão):\n${shown.map((transaction) => {
    const invoice = invoiceById.get(transaction.invoiceId);
    const cardId = invoice ? resolveInvoiceCardId(invoice.cardId, universe.cards) : undefined;
    const card = cardId ? universe.cards.find((item) => item.id === cardId) : undefined;
    const cardText = card ? `${card.bank} ${card.last4}` : (invoice?.cardLabel || 'sem cartão');
    const installment = transaction.installmentTotal && transaction.installmentTotal > 1
      ? ` parc ${transaction.installmentCurrent ?? 1}/${transaction.installmentTotal}`
      : '';
    return `- ${transaction.date ?? 'sem dia'} | ${transaction.merchant} | ${universe.money(centsToAmount(getChargeImpactCents(transaction)))} | ${universe.money(centsToAmount(getPersonalImpactCents(transaction)))} | ${transaction.category ? universe.categoryLabel(transaction.category) : 'Sem categoria'} | ${ownerText(transaction)}${installment} | ${cardText}`;
  }).join('\n')}${rest > 0 ? `\n- (+${rest} lançamentos menores nesta fatura, já contados nos totais por categoria)` : ''}`;
}

/** O extrato completo de um mês: é o que a IA puxa quando a pergunta é de outro mês. */
export function buildMonthDetail(month: BudgetMonth, universe: AssistantUniverse): string {
  const invoices = month.creditCardInvoices ?? [];
  const charges = getCardCharges(invoices, month.bills);
  const perCard = getCardMonthTotalsCents(invoices, month.bills, universe.cards)
    .map((entry) => {
      const label = entry.cardId
        ? getInvoiceCardLabel({ cardId: entry.cardId }, universe.cards) || 'cartão removido'
        : 'sem cartão';
      return `${label} ${universe.money(centsToAmount(entry.cents))}`;
    })
    .join(', ');
  return [
    `MÊS: ${monthLabel(month)}`,
    `Entrada ${universe.money(month.income)} | fatura do cartão ${universe.money(centsToAmount(charges.totalCents))} (minha parte ${universe.money(centsToAmount(charges.personalCents))})${perCard ? ` | ${perCard}` : ''}`,
    buildCategorySection(month, universe),
    buildBillLines(month, universe),
    buildTransactionLines(month, universe),
  ].join('\n');
}

/**
 * O prompt de dados inteiro. `detailMonth` é o único mês enviado linha a linha: dos outros vem
 * uma linha de resumo cada, e a assistente pede o extrato quando a pergunta é de outro mês.
 * Assim o prompt cabe no limite de tokens por minuto da Groq gratuita com todos os meses visíveis.
 */
export function buildAssistantDataSection(universe: AssistantUniverse, detailMonth: BudgetMonth, includeDetails = true, intents?: AssistantIntent[]): string {
  const { selectedMonth, money, dashboard } = universe;
  const allData = intents === undefined;
  const includes = (...wanted: AssistantIntent[]) => allData || wanted.some((intent) => intents.includes(intent));
  const charges = getCardCharges(selectedMonth.creditCardInvoices ?? [], selectedMonth.bills);
  const today = new Date();
  const dateLabel = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return [
    'CONTEXTO FINANCEIRO: dados calculados pelo app; sem integração bancária externa.',
    `Mês aberto na tela: ${monthLabel(selectedMonth)}`,
    ...(includes('comparison', 'bills', 'cashflow') ? [`Data local de hoje: ${dateLabel}`] : []),
    ...(includes('diagnosis', 'savings', 'goal', 'cashflow', 'general')
      ? [`Entrada ${money(selectedMonth.income)} | previsto em contas ${money(dashboard.totalPlanned)} | já pago ${money(dashboard.totalPaid)} | pendente ${money(dashboard.totalPlanned - dashboard.totalPaid)} | sobra prevista ${money(dashboard.remaining)}`]
      : []),
    ...(includes('diagnosis')
      ? [buildIncomeSourcesSection(selectedMonth, universe), ...(detailMonth.id !== selectedMonth.id ? [buildIncomeSourcesSection(detailMonth, universe)] : [])]
      : []),
    ...(includes('goal')
      ? [buildSavingsGoalSection(detailMonth, universe), ...(detailMonth.id !== selectedMonth.id ? [buildSavingsGoalSection(selectedMonth, universe)] : [])]
      : []),
    ...(includes('category', 'comparison', 'chart', 'diagnosis', 'savings', 'invoice', 'bills', 'cashflow', 'action', 'general')
      ? [`Fatura ${monthLabel(selectedMonth)}: bruto ${money(centsToAmount(charges.totalCents))} | minha parte ${money(centsToAmount(charges.personalCents))} | terceiros ${money(centsToAmount(charges.thirdPartyCents))}`]
      : []),
    ...(includes('comparison', 'chart', 'diagnosis', 'savings', 'general') ? [buildOverviewSection(universe)] : []),
    ...(includes('chart', 'comparison', 'diagnosis', 'savings') ? [buildChartDataSection(universe)] : []),
    ...(includes('category', 'comparison', 'chart', 'diagnosis', 'savings', 'invoice', 'action', 'general') && detailMonth.id !== selectedMonth.id
      ? [`Categorias do mês aberto ${monthLabel(selectedMonth)} para comparação:`, buildCategorySection(selectedMonth, universe), '']
      : []),
    ...(includes('action', 'calendar') ? [buildCardsSection(universe)] : []),
    ...(includes('action', 'invoice') ? [buildCategoryNamesSection(universe.categoryNames)] : []),
    ...(includeDetails
      ? [buildMonthDetail(detailMonth, universe)]
      : [
        `MÊS: ${monthLabel(detailMonth)}`,
        ...(includes('category', 'comparison', 'chart', 'diagnosis', 'savings', 'goal', 'invoice', 'action', 'general') ? [buildCategorySection(detailMonth, universe)] : []),
        ...(intents !== undefined && includes('bills', 'cashflow', 'diagnosis', 'goal') ? [buildBillLines(detailMonth, universe)] : []),
      ]),
    'Use somente os dados apresentados; se um mês, valor ou detalhe não estiver disponível, informe a limitação. Se faltarem detalhes, peça get_month_detail do mês solicitado.',
    ...(includeDetails ? ['Transações sem data não permitem inferir o dia.'] : []),
  ].join('\n');
}

const CURRENT_REFS = ['atual', 'este mes', 'esse mes', 'this month', 'hoje', 'today', 'aberto'];
const PREVIOUS_REFS = ['mes passado', 'passado', 'last month'];

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function containsPhrase(value: string, phrase: string): boolean {
  const clean = (text: string) => normalize(text).replace(/[^a-z0-9]+/g, ' ').trim();
  return (` ${clean(value)} `).includes(` ${clean(phrase)} `);
}

/** "Setembro 2026", "setembro", "mês passado", "este mês" → o mês cadastrado. Nunca inventa:
 *  se não há mês com aquele nome, devolve undefined e a assistente diz que não tem os dados. */
export function resolveMonthRef(universe: AssistantUniverse, reference?: string): BudgetMonth | undefined {
  const raw = (reference ?? '').trim();
  const value = normalize(raw);
  if (!value) return universe.selectedMonth;
  if (CURRENT_REFS.includes(value)) return universe.selectedMonth;
  const selectedIndex = universe.months.findIndex((month) => month.id === universe.selectedMonth.id);
  if (PREVIOUS_REFS.includes(value)) {
    return universe.months[selectedIndex - 1] ?? universe.months.find((month) => month.id !== universe.selectedMonth.id);
  }
  const parts = value.split(' ');
  const named = universe.months.filter((month) => normalize(month.name) === parts[0] || normalize(monthLabel(month)) === value);
  if (named.length === 0) return undefined;
  const withYear = parts[1] ? named.find((month) => String(month.year) === parts[1] || normalize(month.name) === parts[0] && String(month.year).endsWith(parts[1])) : undefined;
  if (withYear) return withYear;
  // "setembro" sem ano é o mais recente até o mês aberto, senão o mais próximo depois dele.
  const upToSelected = named.filter((month) => universe.months.indexOf(month) <= selectedIndex);
  return upToSelected[upToSelected.length - 1] ?? named[0];
}

/** As categorias desta conta, para a IA usar um nome que existe em vez de inventar. */
export function buildCategoryNamesSection(labels: string[]): string {
  return `Categorias desta conta (use exatamente um destes nomes; "Sem categoria" significa que o lançamento ainda não foi classificado):\n${labels.join(', ')}`;
}

/** As instruções que ensinam o protocolo. Vão depois do contexto, porque é o que muda o formato da resposta. */
export function buildProtocolSection(universe: AssistantUniverse, intents: AssistantIntent[] = ['general']): string {
  const active = new Set(intents);
  const lines = [
    'Você é a IA financeira pessoal do Finança App. Use somente os dados fornecidos pelo app; não invente valores, transações, saldos ou causas.',
    'Responda no idioma configurado, primeiro ao que foi perguntado e de forma concisa. Separe fatos de estimativas e informe limitações quando faltarem dados.',
    'Use o histórico apenas para resolver referências; valores dinâmicos devem vir do contexto atual, não de respostas antigas.',
    'Retorne exatamente um JSON válido, sem markdown: {"action":"none","response":"resposta"} para consultas. Nunca diga que uma alteração foi concluída antes da confirmação do app.',
    'Se precisar de dados de outro mês que não estejam no contexto, use {"action":"get_month_detail","month":"Setembro 2026"}; nunca solicite consultas livres ao banco.',
  ];
  if (active.has('comparison')) lines.push('Comparações: use a mesma categoria e métrica nos períodos, informe diferença absoluta e percentual apenas se houver base. Se o mês aberto estiver incompleto, diga que o acumulado é parcial; redução não prova melhora nem revela causa.');
  if (active.has('chart')) lines.push('Gráficos: use os valores numéricos e critérios explícitos no contexto, não estime pela aparência; percentuais usam o total exibido no gráfico.');
  if (active.has('category')) lines.push('Categorias: diferencie bruto, minha parte, terceiros e fatura; lançamentos sem categoria não pertencem a uma categoria nomeada.');
  if (active.has('diagnosis')) lines.push('Diagnóstico: renda, despesas e sobra prevista não são saldo bancário; não calcule taxa de poupança se a renda estiver ausente ou incompleta.');
  if (active.has('savings')) lines.push('Economia: proponha até três oportunidades específicas sustentadas pelos dados; economia potencial é estimativa, não resultado realizado.');
  if (active.has('goal')) lines.push('Metas: use somente meta e valor guardado existentes no mês. Não invente limites por categoria se eles não estiverem cadastrados.');
  if (active.has('bills')) lines.push('Contas: diferencie pagas, pendentes e previstas; vencimento mensal não equivale a pagamento.');
  if (active.has('cashflow')) lines.push('Fluxo de caixa: o app não fornece saldo inicial bancário; liste entradas/contas conhecidas e não afirme saldo projetado sem base.');
  if (active.has('invoice')) lines.push('Faturas/imagens: extraia só campos legíveis, não duplique itens e não execute alterações a partir da imagem sem pedido explícito.');
  if (active.has('action')) {
    lines.push('Ações aceitas: add_purchase, assign_card, set_category, set_owner, mark_paid, mark_unpaid, create_card e create_category. Use os campos e escopo declarativos; o app seleciona as transações e pede confirmação.');
    lines.push('Para ações, explique em response o plano. Em scope, use categoria, cartão, dono, estabelecimento, dia, withoutCard ou unclassifiedCategory; não invente IDs.');
    lines.push(buildCardsSection(universe));
    lines.push(buildCategoryNamesSection(universe.categoryNames));
  }
  if (active.has('calendar')) lines.push('Agenda: use somente ações create_bill_reminder, create_invoice_reminder, create_event, list_events, update_event ou delete_event; se faltar título, data ou horário do evento, pergunte em response.');
  if (active.has('app_help')) lines.push('Descreva somente módulos visíveis no app: dashboard, cartão/faturas, categorias, assistente e, quando configurado, Google Agenda. Não alegue conexão bancária automática.');
  return lines.join('\n');
}
