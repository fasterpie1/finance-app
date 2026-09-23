import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractWithGroq } from './groq';
import { parsePdfTransactionFallback, parseExtractedPurchases, VALID_CATEGORIES, type ExtractedPurchase } from './statementParser';
export { extractStatementTotalCents } from './statementTotals';
export { parseExtractedPurchases } from './statementParser';
export type { ExtractedPurchase } from './statementParser';

const SYSTEM_PROMPT = `Você extrai compras de faturas de cartão de crédito brasileiras.
Retorne APENAS JSON válido no formato: { "purchases": [ ... ] }
Cada item do array:
- name: string — descrição/estabelecimento da compra
- amount: number — valor em reais (ex: 89.90). Se parcelado, use o valor DA PARCELA (não o total)
- installmentCurrent: number — parcela atual (1 se à vista)
- installmentTotal: number — total de parcelas (1 se compra à vista, sem parcelamento)
- category: string — uma de: ${VALID_CATEGORIES.join(', ')}
- type: string — PURCHASE, INSTALLMENT, REFUND, PAYMENT, FEE ou OTHER
- cardLast4: string opcional — últimos quatro dígitos do cartão
- date: string opcional — data original do lançamento

Regras:
- Ignore totais da fatura, juros, IOF, multas, saldo anterior e encargos
- Extraia todos os lançamentos individuais, inclusive pagamentos, estornos, créditos, tarifas e anuidades
- Não trate pagamentos como compras ou despesa: classifique como PAYMENT e preserve apenas como lançamento informativo da fatura
- Não descarte anuidade, tarifa ou estorno: classifique como FEE ou REFUND; eles fazem parte do histórico da fatura, mas não devem ser confundidos com compras pessoais
- Existem quatro formatos possíveis: tabela Itaú em preto e branco; lista C6 em PDF; lista do app com status "Em processamento"; e lista do app com "Parcela X de Y".
- Em tabelas Itaú, "beautyglam 08/09 56,36" significa nome=beautyglam, parcela=8/9, valor=56.36. O mesmo vale para "AMAZON BR 07/12 31,59".
- Em listas C6, "PONTO CERTO - Parcela 7/10 163,90" significa nome=PONTO CERTO, parcela=7/10, valor=163.90.
- Em prints do app, "O001 DI SANTINNI ROD6", "Parcela 2 de 2" e "R$ 249,99" pertencem à mesma compra.
- Se aparecer "3/12", "Parc 3 de 12" ou "Parcela 3 de 12", use installmentCurrent=3 e installmentTotal=12.
- Nunca use como nome: "Em processamento", "Cartão final 6852", "Cartão final 8649", cidades, "Subtotal", menus ou cabeçalhos.
- Classifique "Inclusão de Pagamento" como PAYMENT e estornos/créditos como REFUND.
- Compras à vista ou sem indicação de parcelas: installmentCurrent=1, installmentTotal=1
- Valores brasileiros: R$ 1.234,56 → amount=1234.56
- Responda SOMENTE com o objeto JSON. Não use markdown, explicações ou texto antes/depois do JSON.`;

const VISION_MODELS = ['qwen/qwen3.8-27b'] as const;
const TEXT_MODEL = 'openai/gpt-oss-20b';
const MAX_OUTPUT_TOKENS = 1800;

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;


export async function extractPurchasesFromImage(
  imageBase64: string,
  mimeType: string,
): Promise<Omit<ExtractedPurchase, 'id' | 'selected'>[]> {
  let lastError = 'Não foi possível interpretar a imagem da fatura.';

  for (const model of VISION_MODELS) {
    try {
      const content = await extractWithGroq({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [{ type: 'text', text: 'Leia a imagem e retorne somente JSON válido no formato {"purchases":[]}. Extraia as compras individuais.' }, { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }] },
        ],
        response_format: { type: 'json_object' },
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.1,
      });
    const extracted = parseExtractedPurchases(content);
    if (extracted.length > 0) return extracted;
    lastError = 'O modelo não retornou compras em JSON válido.';
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  throw new Error(lastError);
}

export async function extractPurchasesFromText(
  statementText: string,
): Promise<Omit<ExtractedPurchase, 'id' | 'selected'>[]> {
  const fallback = parsePdfTransactionFallback(statementText);
  let extracted: Omit<ExtractedPurchase, 'id' | 'selected'>[] = [];
  try {
    const content = await extractWithGroq({ model: TEXT_MODEL, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `Extraia todos os lançamentos individuais das seções de transações desta fatura e classifique cada um como PURCHASE, INSTALLMENT, REFUND, PAYMENT, FEE ou OTHER. Percorra todas as páginas e não pare antes de incluir todos os lançamentos. Aceite datas numéricas como 25/01 e linhas quebradas. Não transforme valores de resumo como "Compras nacionais", "Total a pagar", "Valor da fatura", subtotais de cartão, limite, opções de parcelamento ou saldo de obrigações em lançamentos. Pagamentos, estornos, tarifas e anuidades devem ser preservados como lançamentos tipados, nunca como compras. O total oficial da fatura é informado separadamente e não deve ser somado novamente.\n\n${statementText.slice(0, 120000)}` }], max_completion_tokens: MAX_OUTPUT_TOKENS });
    extracted = parseExtractedPurchases(content);
  } catch (error) {
    // Se a IA falhou e o parser local também não encontrou nada, propaga o erro real
    // em vez de um "nenhuma compra encontrada" enganoso. Havendo fallback, degrada.
    if (fallback.length === 0) {
      throw error instanceof Error ? error : new Error('Falha ao interpretar a fatura com a IA.');
    }
    console.warn('Extração via IA falhou; usando parser local.', error);
    extracted = [];
  }

  const merged = [...extracted];
  fallback.forEach((candidate) => {
    const duplicate = merged.some((item) => item.name.toLowerCase() === candidate.name.toLowerCase()
      && Math.abs(item.amount - candidate.amount) < 0.01
      && item.installmentCurrent === candidate.installmentCurrent
      && item.installmentTotal === candidate.installmentTotal);
    if (!duplicate) merged.push(candidate);
  });
  return merged;
}

export async function pdfToText(file: File): Promise<string> {
  const loadingTask = getDocument({ data: await file.arrayBuffer() });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = new Map<number, string[]>();
      content.items.forEach((item) => {
        if (!('str' in item) || !item.str.trim()) return;
        const y = Math.round(item.transform[5]);
        const line = lines.get(y) || [];
        line.push(item.str.trim());
        lines.set(y, line);
      });
      pages.push(Array.from(lines.entries()).sort(([a], [b]) => b - a).map(([, items]) => items.join(' ')).join('\n'));
    }
  } finally {
    // Release the worker/document so repeated imports do not leak memory.
    await loadingTask.destroy();
  }
  return pages.join('\n');
}

export function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve({ base64, mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = () => reject(new Error('Erro ao ler a imagem'));
    reader.readAsDataURL(file);
  });
}
