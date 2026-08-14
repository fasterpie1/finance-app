import { type BillCategory, BILL_CATEGORY_LABELS } from '../types';

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
- Compras à vista ou sem indicação de parcelas: installmentCurrent=1, installmentTotal=1
- Valores brasileiros: R$ 1.234,56 → amount=1234.56`;

const VISION_MODEL = 'qwen/qwen3.6-27b';

function normalizeCategory(raw: unknown): BillCategory {
  if (typeof raw !== 'string') return 'compras';
  const lower = raw.toLowerCase().trim();
  const found = VALID_CATEGORIES.find((c) => c === lower);
  if (found) return found;
  return 'compras';
}

function normalizePurchase(raw: Record<string, unknown>): Omit<ExtractedPurchase, 'id' | 'selected'> | null {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const amount = typeof raw.amount === 'number' ? raw.amount : parseFloat(String(raw.amount ?? ''));
  if (!name || !amount || amount <= 0 || isNaN(amount)) return null;

  let cur = typeof raw.installmentCurrent === 'number' ? raw.installmentCurrent : parseInt(String(raw.installmentCurrent ?? '1'), 10);
  let total = typeof raw.installmentTotal === 'number' ? raw.installmentTotal : parseInt(String(raw.installmentTotal ?? '1'), 10);
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

export async function extractPurchasesFromImage(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
): Promise<Omit<ExtractedPurchase, 'id' | 'selected'>[]> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extraia todas as compras desta fatura de cartão de crédito brasileira.' },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `Erro ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '{"purchases":[]}';
  return parseExtractedPurchases(content);
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
