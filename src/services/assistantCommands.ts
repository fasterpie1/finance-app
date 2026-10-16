import {
  type Bill,
  type BudgetMonth,
  type CategoryId,
  type CreditCardInvoice,
  type CreditCardTransaction,
  type ExpenseOwner,
} from '../types';
import { centsToAmount, getCardCharges, getChargeImpactCents } from './cardTransactions';
import { cardInvoiceId, getPaymentCardLabel, resolveInvoiceCardId, type PaymentCard } from './paymentCards';
import { type AssistantUniverse, monthLabel, resolveMonthRef } from './assistantContext';
import { type CardMoveTarget, type CreditCardPurchase } from '../store/useDashboard';

/**
 * O que a assistente pede ao aplicativo. O escopo é sempre declarativo (categoria, cartão, dono,
 * estabelecimento, dia): quem escolhe as linhas é o código, com os mesmos números das telas. Assim
 * o modelo nunca precisa inventar id de lançamento nem somar a fatura para mexer no app.
 */
export interface AssistantScope {
  category?: string;
  card?: string;
  owner?: string;
  merchant?: string;
  day?: number;
  withoutCard?: boolean;
  unclassifiedCategory?: boolean;
}

export interface AssistantCommand {
  action?: string;
  response?: string;
  month?: string;
  card?: string;
  scope?: AssistantScope;
  category?: string;
  owner?: string;
  thirdPartyName?: string;
  personalAmount?: number;
  name?: string;
  amount?: number;
  day?: number;
  installmentCurrent?: number;
  installmentTotal?: number;
  paymentMethod?: string;
  billName?: string;
  bank?: string;
  last4?: string;
  label?: string;
  dueDay?: number;
}

export type TransactionPatch = Partial<Pick<CreditCardTransaction, 'category' | 'owner' | 'thirdPartyName' | 'personalAmountCents'>>;

export interface AssistantCommandHost {
  universe: AssistantUniverse;
  patchTransactions: (transactionIds: string[], patch: TransactionPatch) => void;
  moveTransactions: (transactionIds: string[], target: CardMoveTarget) => void;
  addPurchase: (purchase: CreditCardPurchase) => void;
  payCard: (invoiceIds: string[], billIds: string[]) => void;
  unpayCard: (invoiceIds: string[], billIds: string[]) => void;
  /** Só chamado na hora de aplicar: o plano não pode cadastrar nada antes do Aplicar. */
  createCard: (bank: string, last4: string) => PaymentCard | undefined;
  findCategory: (label: string) => CategoryId | undefined;
  createCategory: (label: string) => CategoryId | undefined;
}

/** `apply` devolve a frase que o chat mostra depois de aplicar. */
export type AssistantOutcome =
  | { kind: 'answer'; text: string }
  | { kind: 'plan'; summary: string[]; apply: () => string };

const answer = (text: string): AssistantOutcome => ({ kind: 'answer', text });

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}
const NO_CARD_WORDS = ['sem cartao', 'sem cartão', 'nenhum', 'none', 'no card'];

/** Igual ao critério do seletor de categorias: "Mercado" e "mercado " são a mesma categoria. */
export function findCategoryId(label: string, options: Array<{ value: string; label: string }>): CategoryId | undefined {
  const wanted = normalize(label);
  if (!wanted) return undefined;
  return options.find((option) => normalize(option.label) === wanted)?.value as CategoryId | undefined;
}

function isNoCard(value: string): boolean {
  return NO_CARD_WORDS.includes(normalize(value));
}

/** "C6 8649", "banco c6 final 8649", "6852" → o banco dito antes dos 4 últimos dígitos. */
function parseCardRef(ref: string): { bank: string; last4: string; name: string } | undefined {
  // Normalizar antes de separar o banco: "cartão" sem acento é a palavra que o filtro remove, e sem
  // isso "cartão 8649" viraria um banco novo em vez de achar o cartão já cadastrado.
  const clean = normalize(ref);
  const digits = clean.replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  const last4 = digits.slice(-4);
  const head = clean.slice(0, clean.lastIndexOf(last4));
  const bank = normalize(head.replace(/final|cartao|card|#|\d/g, ' '));
  // O nome que entra no cartão preserve o acento dito: "Itaú" cadastrado como "Itau" não seria o
  // mesmo banco que ele digita na tela depois.
  const rawHead = ref.slice(0, ref.lastIndexOf(last4));
  const name = rawHead.replace(/final|cart[ãa]o|card|#|\d/gi, ' ').replace(/\s+/g, ' ').trim();
  return { bank, last4, name: name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Cartão' };
}

function findCard(cards: PaymentCard[], ref: string): PaymentCard | undefined {
  const parsed = parseCardRef(ref);
  if (!parsed) return undefined;
  return cards.find((card) => (
    card.last4 === parsed.last4
    && (!parsed.bank || normalize(card.bank).includes(parsed.bank) || parsed.bank.includes(normalize(card.bank)))
  ));
}

interface MonthData {
  month: BudgetMonth;
  invoices: CreditCardInvoice[];
  transactions: CreditCardTransaction[];
  invoiceById: Map<string, CreditCardInvoice>;
}

function monthDataOf(month: BudgetMonth): MonthData {
  const invoices = month.creditCardInvoices ?? [];
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const transactions = invoices
    .flatMap((invoice) => invoice.transactions)
    .filter((transaction) => transaction.type !== 'PAYMENT');
  return { month, invoices, transactions, invoiceById };
}

/** O cartão que cobra o lançamento, decidido com a mesma regra da tela (fatura antiga herda o
 *  único cartão cadastrado). */
function cardIdOf(data: MonthData, cards: PaymentCard[], transaction: CreditCardTransaction): string | undefined {
  const invoice = data.invoiceById.get(transaction.invoiceId);
  return invoice ? resolveInvoiceCardId(invoice.cardId, cards) : undefined;
}

const OWNERS: Record<string, ExpenseOwner> = {
  eu: 'ME',
  meu: 'ME',
  'minha': 'ME',
  terceiro: 'THIRD_PARTY',
  compartilhado: 'SHARED',
  dividido: 'SHARED',
  'sem dono': 'UNCLASSIFIED',
};

function matchesScope(data: MonthData, cards: PaymentCard[], scope: AssistantScope, universe: AssistantUniverse): (transaction: CreditCardTransaction) => boolean {
  const category = scope.category ? normalize(scope.category) : undefined;
  const merchant = scope.merchant ? normalize(scope.merchant) : undefined;
  const owner = scope.owner ? OWNERS[normalize(scope.owner)] : undefined;
  const cardRef = scope.card && !isNoCard(scope.card) ? scope.card : undefined;
  const wantsNoCard = scope.withoutCard === true || (scope.card ? isNoCard(scope.card) : false);
  return (transaction) => {
    if (category) {
      const label = transaction.category ? normalize(universe.categoryLabel(transaction.category)) : '';
      if (scope.unclassifiedCategory ? label !== '' : label !== category) return false;
    } else if (scope.unclassifiedCategory && transaction.category) {
      return false;
    }
    // O "sem cartão" vale também quando ele só diz `withoutCard`, sem citar cartão nenhum: é o
    // pedido "joga tudo que ainda não tem cartão no 8649".
    if (scope.card || wantsNoCard) {
      const cardId = cardIdOf(data, cards, transaction);
      if (wantsNoCard && cardId) return false;
      if (cardRef) {
        const card = findCard(cards, cardRef);
        if (!card || card.id !== cardId) return false;
      }
    }
    if (owner && transaction.owner !== owner) return false;
    if (merchant && !normalize(transaction.merchant).includes(merchant)) return false;
    if (scope.day) {
      const day = transaction.date ? Number(transaction.date.slice(-2)) : undefined;
      if (day !== scope.day) return false;
    }
    return true;
  };
}

function totalMoney(host: AssistantCommandHost, transactions: CreditCardTransaction[]): string {
  const cents = transactions.reduce((sum, transaction) => sum + getChargeImpactCents(transaction), 0);
  return host.universe.money(centsToAmount(cents));
}

function plural(count: number): string {
  return count > 1 ? 'lançamentos' : 'lançamento';
}

/** Todo pedido de alteração vale para o mês aberto na tela: os demais só entram em leitura, porque
 *  as ações da store foram escritas sobre o mês selecionado. */
function editableMonth(command: AssistantCommand, host: AssistantCommandHost): { data?: MonthData; error?: string } {
  const { universe } = host;
  const month = resolveMonthRef(universe, command.month);
  if (!month) return { error: `Não há mês "${(command.month ?? '').trim()}" cadastrado. Os meses são ${universe.months.map((item) => monthLabel(item)).join(', ')}.` };
  if (month.id !== universe.selectedMonth.id) return { error: `Abra ${monthLabel(month)} na barra de meses para eu alterar esses lançamentos.` };
  return { data: monthDataOf(month) };
}

function describeScope(scope: AssistantScope | undefined): string {
  if (!scope) return 'todos os lançamentos do cartão';
  const parts: string[] = [];
  if (scope.category) parts.push(`em ${scope.category}`);
  if (scope.unclassifiedCategory) parts.push('sem categoria');
  if (scope.card) parts.push(isNoCard(scope.card) || scope.withoutCard ? 'sem cartão' : scope.card);
  else if (scope.withoutCard) parts.push('sem cartão');
  if (scope.owner) parts.push(scope.owner);
  if (scope.merchant) parts.push(`"${scope.merchant}"`);
  if (scope.day) parts.push(`dia ${scope.day}`);
  return parts.length > 0 ? parts.join(', ') : 'todos os lançamentos do cartão';
}

function cardTarget(ref: string | undefined, host: AssistantCommandHost): { card?: PaymentCard; needsCreate?: { bank: string; last4: string }; error?: string } {
  // Sem cartão dito, o único cartão da conta é o destino óbvio; com dois ou mais é preciso escolher.
  if (!ref && host.universe.cards.length === 1) return { card: host.universe.cards[0] };
  if (!ref || isNoCard(ref)) return { error: 'Diga em qual cartão isso vai entrar (banco e os 4 últimos dígitos).' };
  const found = findCard(host.universe.cards, ref);
  if (found) return { card: found };
  const parsed = parseCardRef(ref);
  if (!parsed) return { error: `Não entendi qual cartão é "${ref}".` };
  return { needsCreate: { bank: parsed.name, last4: parsed.last4 } };
}

/** Só cria categoria na hora de aplicar: o plano precisa mostrar a intenção sem tocar em nada. */
function categoryTarget(label: string | undefined, host: AssistantCommandHost): { id?: CategoryId; needsCreate?: string; error?: string } {
  const clean = (label ?? '').trim();
  if (!clean) return { error: 'Diga qual categoria usar.' };
  const existing = host.findCategory(clean);
  if (existing) return { id: existing };
  return { needsCreate: clean.replace(/\s+/g, ' ').slice(0, 24) };
}

function invoicesOfCard(data: MonthData, cards: PaymentCard[], card: PaymentCard): CreditCardInvoice[] {
  return data.invoices.filter((invoice) => resolveInvoiceCardId(invoice.cardId, cards) === card.id);
}

function moveTarget(month: BudgetMonth, card: PaymentCard): CardMoveTarget {
  return {
    invoiceId: cardInvoiceId('imported-invoice', month.year, month.name, card.id),
    cardId: card.id,
    cardLabel: getPaymentCardLabel(card),
  };
}

function planAddPurchase(command: AssistantCommand, host: AssistantCommandHost, data: MonthData): AssistantOutcome {
  const name = (command.name ?? '').trim();
  if (!name) return answer('Diga o nome da compra (o estabelecimento).');
  const amount = Number(command.amount);
  if (!Number.isFinite(amount) || amount <= 0) return answer('Diga o valor da compra, por exemplo 129,90.');
  const category = categoryTarget(command.category, host);
  if (category.error) return answer(category.error);
  const target = cardTarget(command.card, host);
  if (target.error) return answer(target.error);
  const installmentTotal = Math.max(1, Number(command.installmentTotal) || 1);
  const installmentCurrent = Math.min(Math.max(1, Number(command.installmentCurrent) || 1), installmentTotal);
  const dueDay = Number(command.day ?? command.dueDay) || undefined;
  const owner = (command.owner ? OWNERS[normalize(command.owner)] : undefined) ?? 'ME';
  const thirdPartyName = (command.thirdPartyName ?? '').trim() || undefined;
  const personalAmountCents = owner === 'SHARED'
    ? Math.round(Math.max(0, Math.min(amount, Number(command.personalAmount) || 0)) * 100)
    : undefined;
  if (owner === 'SHARED' && !personalAmountCents) return answer('Na compra compartilhada, diga qual parte é sua.');
  const card = target.card;
  const newCard = target.needsCreate;
  const summary = [
    `Lançar ${name} — ${host.universe.money(amount)} em ${monthLabel(data.month)}${installmentTotal > 1 ? ` (${installmentCurrent}/${installmentTotal} de ${installmentTotal}x)` : ''}`,
    `Categoria: ${category.id ? host.universe.categoryLabel(category.id) : `nova categoria "${category.needsCreate}"`}`,
    `Cartão: ${card ? getPaymentCardLabel(card) : `${newCard?.bank} ${newCard?.last4}`}`,
    `Dono: ${owner === 'THIRD_PARTY' ? `de terceiro${thirdPartyName ? ` (${thirdPartyName})` : ''}` : owner === 'SHARED' ? `compartilhado${thirdPartyName ? ` com ${thirdPartyName}` : ''}` : 'meu'}`,
  ];
  // Cartão e categoria novos só nascem no Aplicar: antes disso o plano não cadastra nada.
  return {
    kind: 'plan',
    summary,
    apply: () => {
      const categoryId = category.id ?? (category.needsCreate ? host.createCategory(category.needsCreate) : undefined);
      if (!categoryId) return 'Não consegui cadastrar essa categoria.';
      const finalCard = card ?? (newCard ? host.createCard(newCard.bank, newCard.last4) : undefined);
      if (!finalCard) return 'Não consegui cadastrar esse cartão. Tente pela tela Cartão.';
      host.addPurchase({
        name,
        amount,
        category: categoryId,
        dueDay,
        installmentCurrent,
        installmentTotal,
        paymentMethod: command.paymentMethod === 'debito_pix' ? 'debito_pix' : 'credito',
        owner,
        personalAmountCents,
        thirdPartyName,
        cardId: finalCard.id,
        cardLabel: getPaymentCardLabel(finalCard),
      });
      return `Lançado: ${name} — ${host.universe.money(amount)} no ${getPaymentCardLabel(finalCard)}.`;
    },
  };
}

export function planAssistantCommand(command: AssistantCommand, host: AssistantCommandHost): AssistantOutcome {
  const { universe } = host;
  const action = (command.action ?? 'none').trim();
  if (action === 'none') return answer(command.response ?? '');

  if (action === 'create_card') {
    const parsed = parseCardRef(`${command.bank ?? ''} ${command.last4 ?? ''}`);
    if (!parsed) return answer('Preciso do nome do banco e dos 4 últimos dígitos do cartão.');
    const existing = findCard(universe.cards, `${parsed.bank} ${parsed.last4}`);
    if (existing) return answer(`O cartão ${getPaymentCardLabel(existing)} já está cadastrado.`);
    return {
      kind: 'plan',
      summary: [`Cadastrar o cartão ${parsed.name} ${parsed.last4}`],
      apply: () => {
        const card = host.createCard(parsed.name, parsed.last4);
        return card ? `Cartão ${getPaymentCardLabel(card)} cadastrado.` : 'Não consegui cadastrar esse cartão.';
      },
    };
  }

  if (action === 'create_category') {
    const target = categoryTarget(command.label ?? command.category, host);
    if (target.error) return answer(target.error);
    if (target.id) return answer(`A categoria ${universe.categoryLabel(target.id)} já existe.`);
    const label = target.needsCreate ?? '';
    return {
      kind: 'plan',
      summary: [`Cadastrar a categoria "${label}"`],
      apply: () => {
        const id = host.createCategory(label);
        return id ? `Categoria ${universe.categoryLabel(id)} cadastrada.` : 'Não consegui cadastrar essa categoria.';
      },
    };
  }

  const editable = editableMonth(command, host);
  if (!editable.data) return answer(editable.error ?? 'Não encontrei o mês.');
  const data = editable.data;

  if (action === 'add_purchase') return planAddPurchase(command, host, data);

  if (action === 'assign_card' || action === 'set_category' || action === 'set_owner') {
    const scope = command.scope ?? {};
    const matched = data.transactions.filter(matchesScope(data, universe.cards, scope, universe));
    if (matched.length === 0) return answer(`Nenhum lançamento de ${monthLabel(data.month)} corresponde a ${describeScope(scope)}.`);
    const ids = matched.map((transaction) => transaction.id);
    const scopeLine = `Alcance: ${matched.length} ${plural(matched.length)} de ${describeScope(scope)} — ${totalMoney(host, matched)}`;

    if (action === 'assign_card') {
      const target = cardTarget(command.card, host);
      if (target.error) return answer(target.error);
      const card = target.card;
      const label = card ? getPaymentCardLabel(card) : `${target.needsCreate?.bank} ${target.needsCreate?.last4}`;
      return {
        kind: 'plan',
        summary: [`Mover ${matched.length} ${plural(matched.length)} para o cartão ${label}`, scopeLine, 'A fatura de origem passa a somar só o que restou nela.'],
        apply: () => {
          const created = !card && target.needsCreate ? host.createCard(target.needsCreate.bank, target.needsCreate.last4) : undefined;
          const finalCard = card ?? created;
          if (!finalCard) return 'Não consegui cadastrar esse cartão.';
          host.moveTransactions(ids, moveTarget(data.month, finalCard));
          return `Movidos ${matched.length} ${plural(matched.length)} para ${getPaymentCardLabel(finalCard)} (${totalMoney(host, matched)}).`;
        },
      };
    }

    if (action === 'set_category') {
      const target = categoryTarget(command.category, host);
      if (target.error) return answer(target.error);
      const label = target.id ? universe.categoryLabel(target.id) : `nova categoria "${target.needsCreate}"`;
      return {
        kind: 'plan',
        summary: [`Classificar como ${label}`, scopeLine],
        apply: () => {
          const created = !target.id ? host.createCategory(target.needsCreate ?? '') : undefined;
          if (!target.id && !created) return 'Não consegui cadastrar essa categoria.';
          host.patchTransactions(ids, { category: (target.id ?? created)! });
          return `Classificados ${matched.length} ${plural(matched.length)} como ${universe.categoryLabel((target.id ?? created)!)} (${totalMoney(host, matched)}).`;
        },
      };
    }

    const owner = OWNERS[normalize(command.owner ?? '')];
    if (!owner) return answer('Diga de quem é o gasto: meu, de terceiro ou compartilhado.');
    const thirdPartyName = (command.thirdPartyName ?? '').trim() || undefined;
    const personalAmountCents = owner === 'SHARED' ? Math.round(Math.max(0, Number(command.personalAmount) || 0) * 100) : undefined;
    if (owner === 'SHARED' && !personalAmountCents) return answer('No gasto compartilhado, diga qual parte é sua em reais.');
    const patch: TransactionPatch = {
      owner,
      thirdPartyName,
      // A parte própria só existe no compartilhado: nos outros donos o campo volta a ficar vazio
      // para não deixar metade antiga contando quando o lançamento muda de dono.
      personalAmountCents: owner === 'SHARED' ? personalAmountCents : undefined,
    };
    const ownerLine = owner === 'THIRD_PARTY' ? `de terceiro${thirdPartyName ? ` (${thirdPartyName})` : ''}` : owner === 'SHARED' ? `compartilhado${thirdPartyName ? ` com ${thirdPartyName}` : ''} — minha parte ${universe.money(centsToAmount(personalAmountCents ?? 0))}` : 'meu';
    return {
      kind: 'plan',
      summary: [`Marcar como ${ownerLine}`, scopeLine],
      apply: () => {
        host.patchTransactions(ids, patch);
        return `Marcados ${matched.length} ${plural(matched.length)} como ${ownerLine}.`;
      },
    };
  }

  if (action === 'mark_paid' || action === 'mark_unpaid') {
    const pay = action === 'mark_paid';
    const billName = (command.billName ?? '').trim();
    if (billName) {
      const wanted = normalize(billName);
      const bills = data.month.bills.filter((bill: Bill) => normalize(bill.name) === wanted || normalize(bill.name).includes(wanted));
      if (bills.length === 0) return answer(`Não achei a conta "${billName}" em ${monthLabel(data.month)}.`);
      // Conta é em reais como na tela; não passa por centsToAmount.
      const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
      return {
        kind: 'plan',
        summary: [`${pay ? 'Marcar como paga' : 'Marcar como pendente'}: ${bills.map((bill) => bill.name).join(', ')} (${universe.money(total)})`],
        apply: () => {
          if (pay) host.payCard([], bills.map((bill) => bill.id));
          else host.unpayCard([], bills.map((bill) => bill.id));
          return `${bills.length} conta(s) ${pay ? 'marcada(s) como paga(s)' : 'liberada(s) para pagar'} (${universe.money(total)}).`;
        },
      };
    }
    const target = cardTarget(command.card, host);
    if (target.error && !command.card) {
      const charges = getCardCharges(data.invoices, data.month.bills);
      const invoiceIds = data.invoices.map((invoice) => invoice.id);
      const billIds = charges.pendingBills.map((bill) => bill.id);
      if (invoiceIds.length + billIds.length === 0) return answer(`Não há fatura do cartão em ${monthLabel(data.month)} para ${pay ? 'marcar como paga' : 'liberar'}.`);
      return {
        kind: 'plan',
        summary: [`${pay ? 'Pagar' : 'Liberar para pagar'} todas as faturas de ${monthLabel(data.month)} — ${universe.money(centsToAmount(charges.totalCents))}`],
        apply: () => {
          if (pay) host.payCard(invoiceIds, billIds);
          else host.unpayCard(invoiceIds, billIds);
          return `Faturas do mês ${pay ? 'pagas' : 'liberadas'} (${universe.money(centsToAmount(charges.totalCents))}).`;
        },
      };
    }
    if (target.error) return answer(target.error);
    const card = target.card;
    if (!card) return answer('Não achei esse cartão cadastrado.');
    const invoices = invoicesOfCard(data, universe.cards, card);
    if (invoices.length === 0) return answer(`O cartão ${getPaymentCardLabel(card)} não tem fatura em ${monthLabel(data.month)}.`);
    const cents = invoices.reduce((sum, invoice) => sum + getCardCharges([invoice], []).totalCents, 0);
    return {
      kind: 'plan',
      summary: [`${pay ? 'Marcar como paga' : 'Liberar para pagar'} a fatura do ${getPaymentCardLabel(card)} — ${universe.money(centsToAmount(cents))}`],
      apply: () => {
        const ids = invoices.map((invoice) => invoice.id);
        if (pay) host.payCard(ids, []);
        else host.unpayCard(ids, []);
        return `Fatura do ${getPaymentCardLabel(card)} ${pay ? 'marcada como paga' : 'liberada para pagar'} (${universe.money(centsToAmount(cents))}).`;
      },
    };
  }

  return answer(command.response ?? 'Não entendi esse pedido.');
}

