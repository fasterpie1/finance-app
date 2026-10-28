import { describe, expect, it } from 'vitest';
import type { CreditCardTransaction } from '../types';
import { learnCategories, planCategorySuggestions, suggestCategory } from './merchantCategories';

function transaction(overrides: Partial<CreditCardTransaction>): CreditCardTransaction {
  return {
    id: 'tx', invoiceId: 'inv', merchant: 'Teste', amountCents: 5000,
    type: 'PURCHASE', owner: 'ME', ...overrides,
  };
}

describe('categoria sugerida pelo estabelecimento', () => {
  it('casa a regra certa quando o nome vem sujo do extrato', () => {
    expect(suggestCategory('NETFLIX.COM', new Map())).toBe('assinatura');
    expect(suggestCategory('AMERICANAS *SAOPAULO', new Map())).toBe('compras');
    expect(suggestCategory('UBER *TRIP', new Map())).toBe('transporte');
    expect(suggestCategory('DROGA SP 042', new Map())).toBe('saude');
  });

  it('resolve a armadilha do "MERCADO": marketplace vem antes de supermercado', () => {
    expect(suggestCategory('MERCADOLIVRE*', new Map())).toBe('compras');
    expect(suggestCategory('MERCADO SAO JOSE', new Map())).toBe('alimentacao');
  });

  it('não inventa categoria para termo curto dentro de outra palavra', () => {
    expect(suggestCategory('BARATINHO VARIEDADES', new Map())).toBeNull();
    expect(suggestCategory('CASA VERDE', new Map())).toBeNull();
    expect(suggestCategory('O BAR DA PRAÇA', new Map())).toBe('lazer');
  });

  it('lê a conta pelo contexto: passagem vem antes do seguro e água engarrafada não é conta de água', () => {
    expect(suggestCategory('PASSAGEM PORTO SEGURO', new Map())).toBe('transporte');
    expect(suggestCategory('SEGURO LOCAL', new Map())).toBe('seguro');
    expect(suggestCategory('AGUA', new Map())).toBeNull();
    expect(suggestCategory('SABESP CONTA', new Map())).toBe('agua');
  });

  it('aprende com o que ele já classificou e isso vale mais que a regra', () => {
    const learned = learnCategories([
      transaction({ id: 'a', merchant: 'MERCADO SÃO JOSÉ', category: 'compras' }),
      transaction({ id: 'b', merchant: 'Mercado Sao Jose', category: 'compras' }),
    ]);

    expect(learned.get('mercado sao jose')).toBe('compras');
    expect(suggestCategory('MERCADO SAO JOSE', learned)).toBe('compras');
  });

  it('usa os meses anteriores como histórico para o mês aberto', () => {
    const history = [
      transaction({ id: 'h1', merchant: 'PIZZARIA NS 2000', category: 'lazer' }),
      transaction({ id: 'h2', merchant: 'PIZZARIA NS 2000', category: 'lazer' }),
    ];

    const plan = planCategorySuggestions([transaction({ id: 'p1', merchant: 'PIZZARIA NS 2000 LTDA' })], history);

    expect(plan).toEqual([{ transactionId: 'p1', merchant: 'PIZZARIA NS 2000 LTDA', category: 'lazer' }]);
    // Sem o histórico, a regra fixa mandaria em alimentação.
    expect(planCategorySuggestions([transaction({ id: 'p1', merchant: 'PIZZARIA NS 2000 LTDA' })])).toEqual([
      { transactionId: 'p1', merchant: 'PIZZARIA NS 2000 LTDA', category: 'alimentacao' },
    ]);
  });

  it('exige votos suficientes e descarta o empate', () => {
    const single = learnCategories([transaction({ merchant: 'IFOOD', category: 'lazer' })]);
    const tied = learnCategories([
      transaction({ id: 'a', merchant: 'AMAZON', category: 'compras' }),
      transaction({ id: 'b', merchant: 'AMAZON', category: 'educacao' }),
    ]);

    expect(single.size).toBe(0);
    expect(tied.size).toBe(0);
  });

  it('monta o plano só com o que está sem categoria e descarta pagamento, taxa e estorno', () => {
    const plan = planCategorySuggestions([
      transaction({ id: 'p1', merchant: 'SPOTIFY' }),
      transaction({ id: 'p2', merchant: 'IFOOD', category: 'alimentacao' }),
      transaction({ id: 'p3', merchant: 'PAGAMENTO RECEBIDO', type: 'PAYMENT' }),
      transaction({ id: 'p4', merchant: 'TARIFA ANUIDADE', type: 'FEE' }),
      transaction({ id: 'p5', merchant: 'ESTORNO SHOPEE', type: 'REFUND' }),
      transaction({ id: 'p6', merchant: 'AUTO POSTO CENTRAL' }),
    ]);

    expect(plan.map((item) => [item.transactionId, item.category])).toEqual([['p1', 'assinatura'], ['p6', 'transporte']]);
  });

  it('sugere tudo que tem regra e nada além disso', () => {
    const plan = planCategorySuggestions([
      transaction({ id: 'a', merchant: 'JOSE DA SILVA' }),
      transaction({ id: 'b', merchant: 'PIX TRANSF ENTRADA' }),
    ]);

    expect(plan).toEqual([]);
  });
});
