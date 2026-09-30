import { beforeEach, describe, expect, it, vi } from 'vitest';

const { groqCall } = vi.hoisted(() => ({ groqCall: vi.fn() }));
vi.mock('./groq', () => ({ extractWithGroq: groqCall }));

import { extractPurchasesFromImage } from './statementImport';
const SETEMBRO = 8;

function rows(...lines: unknown[][]) {
  return { content: JSON.stringify({ p: lines }), truncated: false };
}

describe('orçamento de tokens de saída na importação', () => {
  beforeEach(() => {
    groqCall.mockReset();
  });

  it('pede menos que o teto de 1000 tokens por minuto do plano gratuito', async () => {
    groqCall.mockResolvedValue(rows(['SUBWAY', 45.9, 1, 1, 'alimentacao', 'c', '18/09', '']));
    await extractPurchasesFromImage('base64', 'image/jpeg', SETEMBRO);
    expect(groqCall.mock.calls[0][0].max_tokens).toBeLessThanOrEqual(900);
  });

  it('emenda a fatura quando o modelo é cortado no meio', async () => {
    groqCall
      .mockResolvedValueOnce({ content: JSON.stringify({ p: [['CASAS BAHIA', 252.09, 10, 10, 'outros', 'p', '03/01', '3397']] }), truncated: true })
      .mockResolvedValueOnce(rows(['NETSHOES', 199.99, 2, 3, 'compras', 'p', '07/09', '8649']));
    const outcome = await extractPurchasesFromImage('base64', 'image/jpeg', SETEMBRO);
    expect(outcome.complete).toBe(true);
    expect(outcome.purchases.map((p) => p.name)).toEqual(['CASAS BAHIA', 'NETSHOES']);
    expect(groqCall.mock.calls[1][0].messages[1].content[0].text).toContain('CASAS BAHIA 252.09');
  });

  it('não descarta a primeira leitura quando a continuação é barrada pelo limite', async () => {
    groqCall
      .mockResolvedValueOnce({ content: JSON.stringify({ p: [['CASAS BAHIA', 252.09, 10, 10, 'outros', 'p', '03/01', '3397']] }), truncated: true })
      .mockRejectedValueOnce(new Error('Request too large for model qwen/qwen3.8-27b on output tokens per minute (OTPM): Limit 1000, Requested 900'));
    const outcome = await extractPurchasesFromImage('base64', 'image/jpeg', SETEMBRO);
    expect(outcome.purchases).toHaveLength(1);
    expect(outcome.complete).toBe(false);
  });

  it('para de repetir pedidos quando o modelo devolve os mesmos lançamentos', async () => {
    groqCall.mockResolvedValue({ content: JSON.stringify({ p: [['CASAS BAHIA', 252.09, 10, 10, 'outros', 'p', '03/01', '3397']] }), truncated: true });
    const outcome = await extractPurchasesFromImage('base64', 'image/jpeg', SETEMBRO);
    expect(groqCall).toHaveBeenCalledTimes(2);
    expect(outcome.purchases).toHaveLength(1);
    expect(outcome.complete).toBe(false);
  });
});
