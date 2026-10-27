import { beforeEach, describe, expect, it, vi } from 'vitest';

const { groqCall } = vi.hoisted(() => ({ groqCall: vi.fn() }));
vi.mock('./groq', () => ({ extractWithGroq: groqCall }));

import { extractPurchasesFromImage, extractPurchasesFromText } from './statementImport';
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

  it('usa modelo e JSON estruturado também para texto extraído de PDF', async () => {
    groqCall.mockResolvedValue(rows(['SUBWAY', 45.9, 1, 1, 'alimentacao', 'c', '18/09', '']));
    await extractPurchasesFromText('Texto de fatura sem formato local reconhecível.');
    const request = groqCall.mock.calls[0][0];
    expect(request.model).toBe('qwen/qwen3.8-27b');
    expect(request.response_format).toEqual({ type: 'json_object' });
    expect(request.max_tokens).toBe(900);
    expect(request).not.toHaveProperty('max_completion_tokens');
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

  // Duas cervejas de R$ 12 no mesmo dia: a repetição é descartada, a compra nova fica.
  it('mantém a segunda compra igual quando a continuação repete a primeira', async () => {
    const beer = ['QUADRADO DE RIO', 12, 1, 1, 'alimentacao', 'p', '08/09', '8649'];
    groqCall
      .mockResolvedValueOnce({ content: JSON.stringify({ p: [beer] }), truncated: true })
      .mockResolvedValueOnce(rows(beer, beer));
    const outcome = await extractPurchasesFromImage('base64', 'image/jpeg', SETEMBRO);
    expect(outcome.purchases).toHaveLength(2);
    expect(outcome.complete).toBe(true);
  });

  it('trata print de fatura como fatura quando o modelo não marca extrato', async () => {
    groqCall.mockResolvedValue(rows(['SUBWAY', 45.9, 1, 1, 'alimentacao', 'c', '18/09', '']));
    const outcome = await extractPurchasesFromImage('base64', 'image/jpeg', SETEMBRO);
    expect(outcome.kind).toBe('fatura');
  });

  it('detecta extrato de conta e preserva o método de cada linha', async () => {
    groqCall.mockResolvedValue({
      content: JSON.stringify({ k: 'extrato', p: [
        ['UBER TRIP', 24.9, 1, 1, 'transporte', 'c', '08/09', '', 'pix'],
        ['FARMACIA RADAR', 40, 1, 1, 'saude', 'c', '10/09', '', 'DEBITO'],
        ['CONDOMINIO', 350, 1, 1, 'moradia', 'c', '05/09', '', 'boleto'],
      ] }),
      truncated: false,
    });
    const outcome = await extractPurchasesFromImage('base64', 'image/jpeg', SETEMBRO);
    expect(outcome.kind).toBe('extrato');
    expect(outcome.purchases.map((p) => p.method)).toEqual(['pix', 'debito', 'boleto']);
  });
});
