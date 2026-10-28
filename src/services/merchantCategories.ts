import type { BillCategory, CategoryId, CreditCardTransaction } from '../types';
import { normalizeChargeName } from './recurringCharges';

/**
 * O extrato devolve o nome do estabelecimento com o CNPJ e um sufixo de domínio; ainda assim
 * a palavra-chave sobrevive. Regra fixa, sem IA: ou o nome bate, ou não sugerimos nada.
 * A ordem importa — "MERCADOLIVRE" tem que cair em compras antes do "MERCADO" de supermercado,
 * "PASSAGEM PORTO SEGURO" é ônibus antes de ser seguro, e termo curto usa borda de palavra para
 * não casar com "BARATINHO". "Água" sozinho fica de fora: no cartão é mais provável a garrafa da
 * mesa do que a conta de água.
 */
const MERCHANT_RULES: Array<{ pattern: RegExp; category: BillCategory }> = [
  { pattern: /amazon|magal|magazine ?luciza|mercado ?livre|shopee|aliexpress|shein|renner|riachuelo|casas ?bahia|americanas/, category: 'compras' },
  { pattern: /ifood|iqe|rappi|uber ?eats|restaurante|lanchonete|pizzaria|hamburgueria|burger|padaria|mercearia|supermerc|(^| )mercado( |$)|hortifruti|acougue|delivery/, category: 'alimentacao' },
  { pattern: /uber|99 ?app|99 ?pop|cabify|passagem|posto|combust[ií]vel|gasolina|etanol|estacionamento|ped[aá]gio|metro|onibus|bilhete unico/, category: 'transporte' },
  { pattern: /netflix|spotify|prime video|disney|hbo|globoplay|youtube|icloud|chatgpt|openai|assinatura/, category: 'assinatura' },
  { pattern: /farmacia|droga|panvel|pague menos|unimed|amil|hapvida|hospital|clinica|laboratorio|consulta/, category: 'saude' },
  { pattern: /escola|faculdade|curso|udemy|alura|cursinho|idiomas|livraria|livro/, category: 'educacao' },
  { pattern: /petshop|pet shop|veterinar|petz|cobasi|tutano/, category: 'pet' },
  { pattern: /cinema|steam|playstation|xbox|nintendo|ingresso|(^| )bar( |$)|(^| )show( |$)/, category: 'lazer' },
  { pattern: /enel|(^| )light( |$)|cpfl|cemig|energia|companhia eletr/, category: 'luz' },
  { pattern: /vivo|claro|(^| )tim( |$)|internet|modem|fibra/, category: 'internet' },
  { pattern: /sabesp|copasa|embasa|caesb|sanepar|cagece|agua ?encanada|companhia de agua/, category: 'agua' },
  { pattern: /seguro|seguradora|previdencia/, category: 'seguro' },
];

/** Voto mínimo para o histórico do usuário virar regra. */
const MIN_LEARNED_VOTES = 2;

/**
 * O que ele já classificou manda mais que a regra fixa: "Mercado" pode ser feira para uma
 * pessoa e mercado para outra, e só o histórico dele diz qual.
 */
export function learnCategories(transactions: CreditCardTransaction[]): Map<string, CategoryId> {
  const votes = new Map<string, Map<CategoryId, number>>();
  transactions.forEach((transaction) => {
    if (!transaction.category) return;
    const key = normalizeChargeName(transaction.merchant);
    if (key.length < 3) return;
    const byCategory = votes.get(key) ?? new Map<CategoryId, number>();
    byCategory.set(transaction.category, (byCategory.get(transaction.category) ?? 0) + 1);
    votes.set(key, byCategory);
  });

  const learned = new Map<string, CategoryId>();
  votes.forEach((byCategory, key) => {
    let best: CategoryId | null = null;
    let bestCount = 0;
    let tie = false;
    byCategory.forEach((count, category) => {
      if (count > bestCount) { best = category; bestCount = count; tie = false; }
      else if (count === bestCount) tie = true;
    });
    if (best && !tie && bestCount >= MIN_LEARNED_VOTES) learned.set(key, best);
  });
  return learned;
}

export function suggestCategory(merchant: string, learned: Map<string, CategoryId>): CategoryId | null {
  const key = normalizeChargeName(merchant);
  const fromHistory = learned.get(key);
  if (fromHistory) return fromHistory;
  const rule = MERCHANT_RULES.find(({ pattern }) => pattern.test(key));
  return rule ? rule.category : null;
}

/** Só faz sentido sugerir categoria no que é despesa: pagamento de fatura e taxa não têm categoria. */
function isClassifiable(transaction: CreditCardTransaction): boolean {
  return !transaction.category
    && transaction.type !== 'PAYMENT'
    && transaction.type !== 'FEE'
    && transaction.type !== 'REFUND';
}

/**
 * `history` são os meses anteriores: dois votos do mesmo estabelecimento viram regra daquela
 * conta, e ela vale mais que a nossa lista fixa.
 */
export function planCategorySuggestions(
  transactions: CreditCardTransaction[],
  history: CreditCardTransaction[] = transactions,
): Array<{ transactionId: string; merchant: string; category: CategoryId }> {
  const learned = learnCategories(history);
  return transactions.filter(isClassifiable).flatMap((transaction) => {
    const category = suggestCategory(transaction.merchant, learned);
    return category ? [{ transactionId: transaction.id, merchant: transaction.merchant, category }] : [];
  });
}
