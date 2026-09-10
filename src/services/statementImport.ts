import { type BillCategory, BILL_CATEGORY_LABELS } from '../types';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface ExtractedPurchase {
  id: string;
  name: string;
  amount: number;
  installmentCurrent: number;
  installmentTotal: number;
  category: BillCategory;
  selected: boolean;
}

const VALID_CATEGORIES = Object.keys(BILL_CATEGORY_LABELS) as BillCategory[];

const SYSTEM_PROMPT = `Você extrai compras de faturas de cartão de crédito brasileiras.
Retorne APENAS JSON válido no formato: { "purchases": [ ... ] }
Cada item do array:
- name: string — descrição/estabelecimento da compra
- amount: number — valor em reais (ex: 89.90). Se parcelado, use o valor DA PARCELA (não o total)
- installmentCurrent: number — parcela atual (1 se à vista)
- installmentTotal: number — total de parcelas (1 se compra à vista, sem parcelamento)
- category: string — uma de: ${VALID_CATEGORIES.join(', ')}

Regras:
- Ignore totais da fatura, juros, IOF, multas, pagamentos, saldo anterior, encargos
- Extraia apenas lançamentos/compras individuais
- Se aparecer "3/12" ou "Parc 3 de 12", use installmentCurrent=3 e installmentTotal=12
- No formato Itaú, o número entre o estabelecimento e o valor, como "beautyglam 08/09 56,36" ou "AMAZON BR 07/12 31,59", é a parcela: use 8/9 e 7/12. Não trate esse número como parte do nome.
- Compras à vista ou sem indicação de parcelas: installmentCurrent=1, installmentTotal=1
- Valores brasileiros: R$ 1.234,56 → amount=1234.56
- Responda SOMENTE com o objeto JSON. Não use markdown, explicações ou texto antes/depois do JSON.`;

const VISION_MODELS = ['qwen/qwen3.6-27b', 'qwen/qwen3.8-27b'] as const;
const TEXT_MODEL = 'groq/compound-mini';
const MAX_OUTPUT_TOKENS = 950;
const GROQ_TIMEOUT_MS = 45_000;
const PDF_TIMEOUT_MS = 30_000;

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

async function fetchGroq(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('A Groq demorou mais de 45 segundos para responder. Tente novamente com uma imagem menor.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function createImageCrops(imageBase64: string, mimeType: string): Promise<Array<{ base64: string; mimeType: string }>> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.width / image.height < 1.2) {
        resolve([{ base64: imageBase64, mimeType }]);
        return;
      }

      const halfWidth = Math.ceil(image.width / 2);
      const bandHeight = Math.ceil(image.height / 4);
      const overlap = Math.floor(image.height * 0.12);
      const cropBounds = Array.from({ length: 4 }, (_, band) => {
        const y = Math.max(0, band * bandHeight - overlap);
        const bottom = Math.min(image.height, (band + 1) * bandHeight + overlap);
        return [
          { x: 0, y, width: halfWidth, height: bottom - y },
          { x: halfWidth, y, width: image.width - halfWidth, height: bottom - y },
        ];
      }).flat();

      const crops = cropBounds.map(({ x, y, width, height }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Não foi possível preparar a imagem para leitura.');
        context.drawImage(image, x, y, width, height, 0, 0, width, height);
        const dataUrl = canvas.toDataURL(mimeType);
        return { base64: dataUrl.split(',')[1] ?? '', mimeType };
      });
      resolve(crops);
    };
    image.onerror = () => reject(new Error('Não foi possível abrir a imagem da fatura.'));
    image.src = `data:${mimeType};base64,${imageBase64}`;
  });
}

function normalizeCategory(raw: unknown): BillCategory {
  if (typeof raw !== 'string') return 'compras';
  const lower = raw.toLowerCase().trim();
  const found = VALID_CATEGORIES.find((c) => c === lower);
  if (found) return found;
  return 'compras';
}

function normalizePurchase(raw: Record<string, unknown>): Omit<ExtractedPurchase, 'id' | 'selected'> | null {
  let name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const amount = typeof raw.amount === 'number' ? raw.amount : parseFloat(String(raw.amount ?? ''));
  const aggregateName = /compras?\s+(nacionais?|internacionais?)|total\s+(a\s+pagar|da\s+fatura)|valor\s+da\s+fatura|saldo\s+(obriga|rotativo)|pagamento\s+(total|mínimo)|gastos\s+desta\s+fatura/i;
  if (!name || aggregateName.test(name) || !amount || amount <= 0 || isNaN(amount)) return null;

  const installmentInName = name.match(/(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?=\s|$)/);
  let cur = installmentInName ? Number(installmentInName[1]) : (typeof raw.installmentCurrent === 'number' ? raw.installmentCurrent : parseInt(String(raw.installmentCurrent ?? '1'), 10));
  let total = installmentInName ? Number(installmentInName[2]) : (typeof raw.installmentTotal === 'number' ? raw.installmentTotal : parseInt(String(raw.installmentTotal ?? '1'), 10));
  if (installmentInName) name = name.replace(installmentInName[0], ' ').replace(/\s{2,}/g, ' ').trim();
  if (isNaN(cur) || cur < 1) cur = 1;
  if (isNaN(total) || total < 1) total = 1;
  cur = Math.min(cur, total);

  return {
    name,
    amount: Math.round(amount * 100) / 100,
    installmentCurrent: cur,
    installmentTotal: total,
    category: normalizeCategory(raw.category),
  };
}

export function parseExtractedPurchases(content: string): Omit<ExtractedPurchase, 'id' | 'selected'>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try { parsed = JSON.parse(match[0]); } catch { return []; }
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { purchases?: unknown[] })?.purchases)
      ? (parsed as { purchases: unknown[] }).purchases
      : [];

  return arr
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(normalizePurchase)
    .filter((p): p is Omit<ExtractedPurchase, 'id' | 'selected'> => p !== null);
}

export function parseStatementTransactions(statementText: string): Omit<ExtractedPurchase, 'id' | 'selected'>[] {
  const purchases: Omit<ExtractedPurchase, 'id' | 'selected'>[] = [];
  const c6Pattern = /^\s*\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/i;
  const itauPattern = /^\s*\d{1,2}\/\d{2}\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/i;
  const dateOnlyPattern = /^\s*(\d{1,2}\/\d{2}|\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez))\b\s*(.*)$/i;
  const amountPattern = /(?:R\$\s*)?(\d{1,3}(?:(?:\.\d{3})|(?:,\d{3}))*(?:[,.]\d{2}))\s*$/;
  const ignoredTerms = /pagamento|estorno|tarifa|juros|iof|multa|anuidade|saldo|encargos|crédito|compras?\s+(?:nacionais?|internacionais?)|valores?\s+creditados|total|subtotal|limite|obrigaç|saque/i;

  const lines = statementText.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const candidates: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (c6Pattern.test(line) || itauPattern.test(line)) {
      candidates.push(line);
      continue;
    }
    const dateMatch = line.match(dateOnlyPattern);
    if (!dateMatch || ignoredTerms.test(dateMatch[2])) continue;
    let combined = dateMatch[0];
    for (let nextIndex = index + 1; nextIndex < Math.min(index + 9, lines.length); nextIndex += 1) {
      if (dateOnlyPattern.test(lines[nextIndex])) break;
      combined += ` ${lines[nextIndex]}`;
      if (amountPattern.test(combined)) {
        candidates.push(combined);
        index = nextIndex;
        break;
      }
    }
  }

  const c6GlobalPattern = /(?:^|\n)\s*\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?=\n|$)/gim;
  for (const match of statementText.matchAll(c6GlobalPattern)) {
    const candidate = `${match[1]} ${match[2]}`.trim();
    if (!candidates.some((line) => line === candidate)) candidates.push(candidate);
  }

  candidates.forEach((line) => {
    const match = line.match(c6Pattern) || line.match(itauPattern) || line.match(dateOnlyPattern)?.[2].match(/(.+?)\s+(\d{1,3}(?:(?:\.\d{3})|(?:,\d{3}))*(?:[,.]\d{2}))\s*$/);
    if (!match || ignoredTerms.test(match[1])) return;
    const amountText = match[2];
    const amount = amountText.includes(',')
      ? parseFloat(amountText.replace(/\./g, '').replace(',', '.'))
      : parseFloat(amountText.replace(/,(?=\d{3})/g, ''));
    if (!amount || amount <= 0) return;
    const installment = match[1].match(/(?:parcela\s*|\b)(\d+)\s*\/\s*(\d+)/i);
    const name = installment ? match[1].replace(installment[0], ' ').replace(/\s{2,}/g, ' ').trim() : match[1].trim();
    purchases.push({
      name,
      amount: Math.round(amount * 100) / 100,
      installmentCurrent: installment ? Number(installment[1]) : 1,
      installmentTotal: installment ? Number(installment[2]) : 1,
      category: 'compras',
    });
  });
  return purchases;
}

export async function extractPurchasesFromImage(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
): Promise<Omit<ExtractedPurchase, 'id' | 'selected'>[]> {
  if (!apiKey) throw new Error('Configure sua chave Groq na aba Assistente para importar imagens.');

  let lastError = 'Não foi possível interpretar a imagem da fatura.';
  const imageCrops = await createImageCrops(imageBase64, mimeType);
  const allPurchases: Omit<ExtractedPurchase, 'id' | 'selected'>[] = [];

  for (const imageCrop of imageCrops) {
    for (const [modelIndex, model] of VISION_MODELS.entries()) {
      const res = await fetchGroq('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Leia TODAS as linhas de compras visíveis nesta parte da fatura e retorne somente JSON válido no formato {"purchases":[]}. Ignore pagamentos, totais e cabeçalhos.' },
                { type: 'image_url', image_url: { url: `data:${imageCrop.mimeType};base64,${imageCrop.base64}` } },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.1,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        lastError = (err as { error?: { message?: string } }).error?.message ?? `Erro ${res.status}`;
        continue;
      }

      const data = await res.json();
      const cropPurchases = parseExtractedPurchases(data.choices?.[0]?.message?.content ?? '');
      if (cropPurchases.length > 0) allPurchases.push(...cropPurchases);
      else lastError = 'O modelo não retornou compras em JSON válido.';
      if (cropPurchases.length > 0 || modelIndex === VISION_MODELS.length - 1) break;
    }
  }

  if (allPurchases.length === 0) throw new Error(lastError);
  return allPurchases.filter((purchase, index, purchases) => purchases.findIndex((candidate) => (
    candidate.name === purchase.name
    && candidate.amount === purchase.amount
    && candidate.installmentCurrent === purchase.installmentCurrent
    && candidate.installmentTotal === purchase.installmentTotal
  )) === index);
}

export async function extractPurchasesFromText(
  apiKey: string,
  statementText: string,
): Promise<Omit<ExtractedPurchase, 'id' | 'selected'>[]> {
  const localPurchases = parseStatementTransactions(statementText);
  if (localPurchases.length > 0) return localPurchases;
  if (!apiKey) return [];

  const res = await fetchGroq('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Extraia somente as compras e parcelas individuais das seções de transações desta fatura. NUNCA transforme em compra valores de resumo como "Compras nacionais", "Total a pagar", "Valor da fatura", subtotais de cartão ou saldo de obrigações. Ignore pagamentos, estornos, tarifas, anuidade, juros, IOF, saldos e totais. Os lançamentos aparecem em linhas com data, descrição e valor.\n\n${statementText.slice(0, 120000)}` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `Erro ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '{"purchases":[]}';
  const extracted = parseExtractedPurchases(content);
  return extracted.length > 0 ? extracted : parseStatementTransactions(statementText);
}

export async function pdfToText(file: File): Promise<string> {
  const pdfTask = getDocument({ data: await file.arrayBuffer() });
  const pdf = await Promise.race([
    pdfTask.promise,
    new Promise<never>((_, reject) => window.setTimeout(() => {
      void pdfTask.destroy();
      reject(new Error('O PDF demorou mais de 30 segundos para ser lido. Tente abrir o arquivo e exportá-lo novamente como PDF com texto selecionável.'));
    }, PDF_TIMEOUT_MS)),
  ]);
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];
    content.items.forEach((item) => {
      if (!('str' in item) || !item.str.trim()) return;
      const y = item.transform[5];
      const x = item.transform[4];
      const line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2);
      if (line) {
        line.items.push({ x, text: item.str.trim() });
      } else {
        lines.push({ y, items: [{ x, text: item.str.trim() }] });
      }
    });
    pages.push(lines
      .sort((first, second) => second.y - first.y)
      .map((line) => line.items.sort((first, second) => first.x - second.x).map((item) => item.text).join(' '))
      .join('\n'));
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
