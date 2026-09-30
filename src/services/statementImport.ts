import { extractWithGroq, type ExtractionResult } from './groq';
import { parsePdfTransactionFallback, parseExtractedPurchases, VALID_CATEGORIES, type ExtractedPurchase } from './statementParser';
export { extractStatementTotalCents } from './statementTotals';
export { parseExtractedPurchases } from './statementParser';
export type { ExtractedPurchase } from './statementParser';

const SYSTEM_PROMPT = `Você extrai compras de faturas de cartão de crédito brasileiras.
Retorne APENAS JSON válido no formato: { "p": [ ...linhas... ] }
Cada linha é um VETOR posicional, nesta ordem exata e sem chaves:
[ nome, valor, parcelaAtual, totalParcelas, categoria, tipo, data, cartaoFinal ]
- nome: string — descrição/estabelecimento da compra
- valor: number em reais (ex: 252.09). Se parcelado, use o valor DA PARCELA (não o total)
- parcelaAtual e totalParcelas: inteiros (1 e 1 se a compra é à vista)
- categoria: string — uma de: ${VALID_CATEGORIES.join(', ')}
- tipo: uma letra — c=compra, p=parcelamento, e=estorno/crédito, g=pagamento/inclusão de pagamento, t=tarifa/anuidade/encargo, o=outro
- data: string "DD/MM" (ex: "25/01") ou "" — sempre que a fatura mostrar a data preencha; se aparecer só o dia, complete com o mês da fatura
- cartaoFinal: string dos últimos quatro dígitos ou ""
Exemplo: {"p":[["GRUPO CASAS BAHIA S.A.",252.09,10,10,"outros","p","03/01","3397"]]}

Regras:
- Ignore totais da fatura, juros, IOF, multas, saldo anterior e encargos
- Extraia todos os lançamentos individuais, inclusive pagamentos, estornos, créditos, tarifas e anuidades
- Não trate pagamentos como compras ou despesa: use tipo g e preserve apenas como lançamento informativo da fatura
- Não descarte anuidade, tarifa ou estorno: use tipo t ou e; eles fazem parte do histórico da fatura, mas não devem ser confundidos com compras pessoais
- Existem quatro formatos possíveis: tabela Itaú em preto e branco; lista C6 em PDF; lista do app com status "Em processamento"; e lista do app com "Parcela X de Y".
- Em tabelas Itaú, "beautyglam 08/09 56,36" significa nome=beautyglam, parcela 8 de 9, valor=56.36. O mesmo vale para "AMAZON BR 07/12 31,59".
- Data e parcela não se confundem: o número que vem ANTES do estabelecimento ("25/01 SUBWAY 45,90") é a data, vai na sétima posição; o que vem DEPOIS do nome é a parcela, vai nas posições três e quatro.
- Em listas C6, "PONTO CERTO - Parcela 7/10 163,90" significa nome=PONTO CERTO, parcela 7 de 10, valor=163.90.
- Em prints do app, "O001 DI SANTINNI ROD6", "Parcela 2 de 2" e "R$ 249,99" pertencem à mesma compra.
- Se aparecer "3/12", "Parc 3 de 12" ou "Parcela 3 de 12", use parcelaAtual=3 e totalParcelas=12.
- Nunca use como nome: "Em processamento", "Cartão final 6852", "Cartão final 8649", cidades, "Subtotal", menus ou cabeçalhos.
- Compras à vista ou sem indicação de parcelas: 1 e 1 nas posições de parcela
- Valores brasileiros: R$ 1.234,56 → 1234.56
- Escreva o JSON cru, sem espaços de indentação, sem markdown, sem explicações antes ou depois.`;

const VISION_MODELS = ['qwen/qwen3.8-27b'] as const;
const TEXT_MODEL = 'openai/gpt-oss-20b';
/** O plano gratuito da Groq aceita no máximo 1000 tokens de saída por minuto e recusa a
 *  requisição inteira se o orçamento pedido passar disso ("Request too large ... OTPM"). */
const MAX_OUTPUT_TOKENS = 900;
const MAX_CONTINUATION_ROUNDS = 2;
const CONTINUATION_DELAY_MS = 2500;

type LoosePurchase = Omit<ExtractedPurchase, 'id' | 'selected'>;

function dedupeKey(purchase: LoosePurchase): string {
  return `${purchase.name.toLowerCase()}|${purchase.amount}|${purchase.installmentCurrent}|${purchase.installmentTotal}`;
}

function mergePurchases(existing: LoosePurchase[], incoming: LoosePurchase[]): LoosePurchase[] {
  const seen = new Set(existing.map(dedupeKey));
  incoming.forEach((purchase) => {
    const key = dedupeKey(purchase);
    if (seen.has(key)) return;
    seen.add(key);
    existing.push(purchase);
  });
  return existing;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function runRound(request: Record<string, unknown>, canDegrade: boolean): Promise<ExtractionResult | null> {
  try {
    return await extractWithGroq(request);
  } catch (error) {
    // Numa continuação, o limite por minuto da Groq pode barrar o pedido extra. Havendo
    // lançamentos já lidos, devolve null em vez de descartar a importação inteira.
    if (canDegrade) return null;
    throw error;
  }
}

/**
 * Roda a extração e, quando o modelo é cortado no meio da fatura (finish_reason "length"),
 * pede só os lançamentos que faltam.
 */
async function extractInRounds(
  buildRequest: (missingPrompt: string) => Record<string, unknown>,
  monthIndex: number,
): Promise<{ purchases: LoosePurchase[]; complete: boolean }> {
  let purchases: LoosePurchase[] = [];
  let complete = true;

  for (let round = 0; round <= MAX_CONTINUATION_ROUNDS; round += 1) {
    const missingPrompt = round === 0 ? '' : purchases
      .slice(-60)
      .map((purchase) => `${purchase.name} ${purchase.amount}`)
      .join('; ');
    const result = await runRound(buildRequest(missingPrompt), purchases.length > 0);
    if (!result) { complete = false; break; }
    const before = purchases.length;
    purchases = mergePurchases(purchases, parseExtractedPurchases(result.content, monthIndex));
    // finish_reason "length" é o único sinal de que a fatura parou no meio.
    if (!result.truncated) { complete = true; break; }
    complete = false;
    if (purchases.length === before || round === MAX_CONTINUATION_ROUNDS) break;
    await sleep(CONTINUATION_DELAY_MS);
  }

  return { purchases, complete };
}

function continuationText(missingPrompt: string): string {
  if (!missingPrompt) return '';
  return `\n\nSua resposta anterior foi cortada. Estes já foram retornados e NÃO devem se repetir: ${missingPrompt}. Devolva {"p":[...]} SOMENTE com os lançamentos que ainda faltam, na mesma ordem em que aparecem na fatura.`;
}

export interface ExtractionOutcome {
  purchases: LoosePurchase[];
  /** false quando a fatura é maior que o orçamento de saída e a leitura parou antes do fim. */
  complete: boolean;
}

export async function extractPurchasesFromImage(
  imageBase64: string,
  mimeType: string,
  monthIndex = -1,
): Promise<ExtractionOutcome> {
  let lastError = 'Não foi possível interpretar a imagem da fatura.';

  for (const model of VISION_MODELS) {
    try {
      const outcome = await extractInRounds((missing) => ({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [{ type: 'text', text: `Leia a imagem e retorne somente JSON válido no formato {"p":[]}. Extraia as compras individuais.${continuationText(missing)}` }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }] },
        ],
        response_format: { type: 'json_object' },
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.1,
      }), monthIndex);
      if (outcome.purchases.length > 0) return outcome;
      lastError = 'O modelo não retornou compras em JSON válido.';
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  throw new Error(lastError);
}

export async function extractPurchasesFromText(
  statementText: string,
  monthIndex = -1,
): Promise<ExtractionOutcome> {
  const fallback = parsePdfTransactionFallback(statementText, monthIndex);
  let extracted: LoosePurchase[] = [];
  let complete = true;
  try {
    const outcome = await extractInRounds((missing) => ({
      model: TEXT_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `Extraia todos os lançamentos individuais das seções de transações desta fatura, no formato de vetores posicionais descrito no sistema. Percorra todas as páginas e não pare antes de incluir todos os lançamentos. Aceite datas numéricas como 25/01 e linhas quebradas, sempre levando a data para a sétima posição em DD/MM. Não transforme valores de resumo como "Compras nacionais", "Total a pagar", "Valor da fatura", subtotais de cartão, limite, opções de parcelamento ou saldo de obrigações em lançamentos. Pagamentos, estornos, tarifas e anuidades devem ser preservados como lançamentos tipados, nunca como compras. O total oficial da fatura é informado separadamente e não deve ser somado novamente.${continuationText(missing)}\n\n${statementText.slice(0, 120000)}` }],
      max_completion_tokens: MAX_OUTPUT_TOKENS,
    }), monthIndex);
    extracted = outcome.purchases;
    complete = outcome.complete;
  } catch (error) {
    // Se a IA falhou e o parser local também não encontrou nada, propaga o erro real
    // em vez de um "nenhuma compra encontrada" enganoso. Havendo fallback, degrada.
    if (fallback.length === 0) {
      throw error instanceof Error ? error : new Error('Falha ao interpretar a fatura com a IA.');
    }
    console.warn('Extração via IA falhou; usando parser local.', error);
    extracted = [];
  }

  return { purchases: mergePurchases([...extracted], fallback), complete };
}
