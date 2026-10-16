import { type Bill, type BudgetMonth, type CategoryId, type CreditCardInvoice, type CreditCardTransaction } from '../types';
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
  const month = universe.selectedMonth;
  const money = universe.money;
  if (value === 'como estou indo financeiramente este mes' || value === 'how am i doing financially this month') {
    return t('assistantMonthSummary', {
      month: monthLabel(month), income: money(month.income), planned: money(universe.dashboard.totalPlanned),
      paid: money(universe.dashboard.totalPaid), pending: money(universe.dashboard.totalPlanned - universe.dashboard.totalPaid), remaining: money(universe.dashboard.remaining),
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
export function buildAssistantDataSection(universe: AssistantUniverse, detailMonth: BudgetMonth, includeDetails = true): string {
  const { selectedMonth, money, dashboard } = universe;
  const charges = getCardCharges(selectedMonth.creditCardInvoices ?? [], selectedMonth.bills);
  return [
    'Você é um assistente financeiro pessoal inteligente e simpático. Responda sempre no idioma do aplicativo (use a língua da última mensagem do usuário), de forma objetiva e prática. Responda curto: até cinco linhas, citando apenas os itens que a pergunta pediu, sem tabela e sem repetir o extrato.',
    `Mês aberto na tela: ${monthLabel(selectedMonth)}`,
    `Entrada ${money(selectedMonth.income)} | previsto em contas ${money(dashboard.totalPlanned)} | já pago ${money(dashboard.totalPaid)} | pendente ${money(dashboard.totalPlanned - dashboard.totalPaid)} | sobra ${money(dashboard.remaining)}`,
    `Fatura do cartão deste mês ${money(centsToAmount(charges.totalCents))} (minha parte ${money(centsToAmount(charges.personalCents))}, de terceiros ${money(centsToAmount(charges.thirdPartyCents))})`,
    '',
    buildOverviewSection(universe),
    '',
    buildCardsSection(universe),
    '',
    buildCategoryNamesSection(universe.categoryNames),
    '',
    includeDetails ? buildMonthDetail(detailMonth, universe) : `MÊS: ${monthLabel(detailMonth)}\n${buildCategorySection(detailMonth, universe)}`,
    '',
    'Regras de leitura destes dados:',
    '- Se precisar de estabelecimentos, contas ou datas não listados aqui, peça get_month_detail para o mês desejado, inclusive o mês aberto. Não diga que não existem só porque o resumo não lista nomes.',
    `- Os totais já vêm calculados na linha de cada categoria ("bruto" e "minha parte"). Use esse número para responder quanto foi gasto; nunca some os lançamentos listados embaixo para chegar a um total.`,
    '- Categorias mostram o total dos lançamentos, inclusive contas fora do cartão; não são o total bancário da fatura. "minha parte" desconta terceiros e a outra metade do compartilhado. Nunca conclua que não há compras no cartão só porque a categoria Compras é zero.',
    '- Responda à última pergunta do usuário, não a uma pergunta antiga do histórico. "Compras" pode significar a categoria ou todos os gastos: diferencie os dois números e informe o mês aberto.',
    '- Lançamentos "Sem categoria" são compras de fatura importada que o usuário ainda não classificou; explique isso e oriente a escolher a categoria na linha do lançamento, na tela Cartão.',
    '- Muitos lançamentos importados não têm data. Quando a pergunta for "quando" e não houver data, responda com estabelecimentos e valores daquela categoria no mês pedido e diga que a data não foi registrada na importação — nunca invente dia.',
    '- Se o mês perguntado não estiver em MESES CADASTRADOS, diga que não há dados dele e oriente a criar o mês ou importar a fatura. Nunca invente valor, categoria, cartão nem nome.',
  ].join('\n');
}

const CURRENT_REFS = ['atual', 'este mes', 'esse mes', 'this month', 'hoje', 'today', 'aberto'];
const PREVIOUS_REFS = ['mes passado', 'passado', 'last month'];

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
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
export function buildProtocolSection(universe: AssistantUniverse): string {
  return [
    'Você pode ler e alterar o aplicativo. Responda SEMPRE um único JSON válido, sem markdown, sem texto fora do JSON.',
    '{"action":"none","response":"..."} para responder perguntas.',
    '{"action":"get_month_detail","month":"Setembro 2026"} quando a pergunta for de um mês cujo detalhe você não tem. O app devolve o extrato daquele mês e você responde em seguida.',
    '{"action":"add_purchase","name":"...","amount":19.90,"category":"compras","card":"C6 8649","day":14,"installmentCurrent":1,"installmentTotal":1,"paymentMethod":"credito","owner":"eu","thirdPartyName":"","personalAmount":0} para lançar uma compra no mês aberto na tela.',
    '{"action":"assign_card","month":"atual","card":"C6 8649","scope":{"withoutCard":true}} para mover lançamentos para outro cartão.',
    '{"action":"set_category","month":"atual","category":"lazer","scope":{...}} para dar categoria aos lançamentos do escopo.',
    '{"action":"set_owner","month":"atual","owner":"terceiro","thirdPartyName":"Marcos","scope":{...}} para dizer de quem é o gasto.',
    '{"action":"mark_paid","month":"atual","card":"C6 8649"} ou {"action":"mark_unpaid",...} para pagar a fatura daquele cartão; {"action":"mark_paid","month":"atual","billName":"Netflix"} para uma conta.',
    '{"action":"create_card","bank":"Nubank","last4":"1234"} e {"action":"create_category","label":"Petshop"} para cadastrar.',
    'Em todo pedido de alteração, escreva em "response" o que você vai fazer, em uma frase. O aplicativo mostra a lista do que mudou e só aplica depois que o usuário tocar em Aplicar — nunca afirme que já aplicou.',
    `"scope" filtra os lançamentos do mês: {"category":"compras","card":"C6 8649|sem cartão","owner":"eu|terceiro|compartilhado","merchant":"uber","day":14,"withoutCard":true,"unclassifiedCategory":true}. Vazio = todos os lançamentos do cartão do mês.`,
    universe.cards.length === 0
      ? 'Não há cartão cadastrado: para mover lançamentos, peça primeiro o banco e os 4 últimos dígitos e use create_card.'
      : `Cartões disponíveis: ${universe.cards.map((card) => `${card.bank} ${card.last4}`).join(', ')}.`,
    'Nunca invente mês, cartão, categoria, valor nem nome. Se faltar um dado obrigatório, use action "none" e pergunte o que falta.',
  ].join('\n');
}
