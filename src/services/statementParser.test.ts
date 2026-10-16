import { describe, expect, it } from 'vitest';
import { normalizePurchase, normalizeStatementDate, parseCsvStatement, parseExtractedPurchases, parsePdfTransactionFallback } from './statementParser';
import { getTransactionDay, setTransactionDay } from './cardTransactions';

const SETEMBRO = 8;

describe('data dos lançamentos importados', () => {
  it('aceita os formatos de data das faturas', () => {
    expect(normalizeStatementDate('25/01', SETEMBRO)).toBe('25/01');
    expect(normalizeStatementDate('25.01.2026', SETEMBRO)).toBe('25/01');
    expect(normalizeStatementDate('2026-01-25', SETEMBRO)).toBe('25/01');
    expect(normalizeStatementDate('25 set', SETEMBRO)).toBe('25/09');
    expect(normalizeStatementDate('9', SETEMBRO)).toBe('09/09');
    expect(normalizeStatementDate('PARC 08/09', SETEMBRO)).toBeUndefined();
    expect(normalizeStatementDate(undefined, SETEMBRO)).toBeUndefined();
  });

  it('usa a data do campo e não confunde parcela com data', () => {
    const purchase = normalizePurchase({ name: 'SUBWAY', amount: 45.9, date: '18/09', installmentCurrent: 8, installmentTotal: 9 }, SETEMBRO);
    expect(purchase?.date).toBe('18/09');
    expect(purchase?.installmentCurrent).toBe(8);
    expect(purchase?.installmentTotal).toBe(9);
  });

  it('tira a data que vem antes do nome no lugar do campo date', () => {
    const purchase = normalizePurchase({ name: '25/01 SUBWAY PARC 2/12', amount: 31.59 }, SETEMBRO);
    expect(purchase?.name).toBe('SUBWAY');
    expect(purchase?.date).toBe('25/01');
    expect(purchase?.installmentCurrent).toBe(2);
    expect(purchase?.installmentTotal).toBe(12);
  });

  it('preserva a data no parser local de PDF', () => {
    const text = 'LANÇAMENTOS: COMPRAS E SAQUES\n18/09 SUBWAY SP 45,90\ncompras parceladas - próximas faturas';
    expect(parsePdfTransactionFallback(text, SETEMBRO)[0]?.date).toBe('18/09');
  });

  it('mantém o mês já registrado ao editar só o dia', () => {
    expect(setTransactionDay('18/09', 3, 8)).toBe('03/09');
    expect(setTransactionDay(undefined, 3, 8)).toBe('03/09');
    expect(setTransactionDay('18/09', undefined, 8)).toBeUndefined();
    expect(getTransactionDay('18/09')).toBe(18);
    expect(getTransactionDay(undefined)).toBeUndefined();
  });

  it('normaliza as datas vindas do JSON do modelo', () => {
    const items = parseExtractedPurchases('{"purchases":[{"name":"O001 DI SANTINNI","amount":249.99,"date":"12/03/2026"}]}', SETEMBRO);
    expect(items[0]?.date).toBe('12/03');
  });
});

describe('formato compacto de vetores posicionais', () => {
  it('lê nome, valor, parcela, categoria, tipo, data e cartão por posição', () => {
    const items = parseExtractedPurchases('{"p":[["GRUPO CASAS BAHIA S.A.",252.09,10,10,"outros","p","03/01","3397"],["MLP*NETSHOES",199.99,2,3,"compras","p","07/09","8649"]]}', SETEMBRO);
    expect(items[0]).toMatchObject({
      name: 'GRUPO CASAS BAHIA S.A.', amount: 252.09, installmentCurrent: 10, installmentTotal: 10,
      category: 'outros', type: 'INSTALLMENT', date: '03/01', cardLast4: '3397',
    });
    expect(items[1]?.date).toBe('07/09');
  });

  it('converte os códigos de tipo e mantém o valor absoluto do estorno', () => {
    const items = parseExtractedPurchases('{"p":[["ESTORNO SHOPIX",-59.9,1,1,"compras","e","11/09",""],["Inclusão de Pagamento",800,1,1,"outros","g","",""]]}', SETEMBRO);
    expect(items[0]).toMatchObject({ type: 'REFUND', amount: 59.9, cardLast4: undefined });
    expect(items[1]?.type).toBe('PAYMENT');
    expect(items[1]?.date).toBeUndefined();
  });

  it('continua aceitando o formato rotulado e tipo por extenso', () => {
    const compact = parseExtractedPurchases('{"p":[["SUBWAY",45.9,1,1,"alimentacao","PURCHASE","",""]]}', SETEMBRO);
    expect(compact[0]).toMatchObject({ type: 'PURCHASE', category: 'alimentacao' });
    const labeled = parseExtractedPurchases('{"purchases":[{"name":"SUBWAY","amount":45.9,"installmentCurrent":1,"installmentTotal":1,"category":"alimentacao","type":"PURCHASE","date":"18/09"}]}', SETEMBRO);
    expect(labeled[0]).toMatchObject({ type: 'PURCHASE', date: '18/09' });
  });
});

describe('CSV de extrato', () => {
  it('lê a planilha exportada pelo banco, coluna por coluna', () => {
    const csv = ['data;estabelecimento;valor', '18/09;SUBWAY;45,90', '20/09;AMERICANAS;254,00'].join('\n');
    const purchases = parseCsvStatement(csv, SETEMBRO);
    expect(purchases).toHaveLength(2);
    expect(purchases[0]).toMatchObject({ name: 'SUBWAY', amount: 45.9, date: '18/09' });
    expect(purchases[1]).toMatchObject({ name: 'AMERICANAS', amount: 254, date: '20/09' });
  });

  it('não parte o nome entre aspas que tem vírgula dentro', () => {
    const csv = ['estabelecimento,data,valor', '"PARCERIA, AMERICANAS",18/09,"254,00"', 'SUBWAY,20/09,45.90'].join('\n');
    const purchases = parseCsvStatement(csv, SETEMBRO);
    expect(purchases[0]).toMatchObject({ name: 'PARCERIA, AMERICANAS', amount: 254 });
    expect(purchases).toHaveLength(2);
  });

  it('detecta a vírgula, o ponto e vírgula e a tabulação pelo cabeçalho', () => {
    const tabbed = ['estabelecimento\tdata\tvalor', 'SUBWAY\t18/09\t45,90', 'AMAZON\t20/09\t31,59'].join('\n');
    expect(parseCsvStatement(tabbed, SETEMBRO).map((purchase) => purchase.name)).toEqual(['SUBWAY', 'AMAZON']);
    const commas = ['estabelecimento;data;valor', 'SUBWAY;18/09;45,90', 'AMAZON;20/09;31,59'].join('\n');
    expect(parseCsvStatement(commas, SETEMBRO).map((purchase) => purchase.amount)).toEqual([45.9, 31.59]);
  });

  it('separa parcela de compra quando a planilha traz a coluna', () => {
    const csv = ['estabelecimento;valor;parcela', 'SUBWAY;45,90;2/12', 'AMAZON;31,59;8/9'].join('\n');
    const purchases = parseCsvStatement(csv, SETEMBRO);
    expect(purchases[0]).toMatchObject({ name: 'SUBWAY', installmentCurrent: 2, installmentTotal: 12 });
    expect(purchases[1]).toMatchObject({ installmentCurrent: 8, installmentTotal: 9 });
  });

  it('lê o final do cartão quando a planilha tem mais de um', () => {
    const csv = ['estabelecimento;valor;cartão', 'SUBWAY;45,90;8649', 'AMAZON;31,59;3397'].join('\n');
    expect(parseCsvStatement(csv, SETEMBRO).map((purchase) => purchase.cardLast4)).toEqual(['8649', '3397']);
  });

  it('descarta resumo da fatura, não lançamento', () => {
    const csv = ['descrição;valor', 'Total a pagar;5.000,00', 'SUBWAY;45,90', 'AMAZON;31,59'].join('\n');
    expect(parseCsvStatement(csv, SETEMBRO).map((purchase) => purchase.name)).toEqual(['SUBWAY', 'AMAZON']);
  });

  it('recusa texto que não é tabela', () => {
    // Texto de PDF: sem cabeçalho de colunas, nada aqui é planilha.
    expect(parseCsvStatement('FATURA DE EXEMPLO\nSUBWAY 45,90\nAMAZON 31,59', SETEMBRO)).toEqual([]);
    // Cabeçalho sem coluna de valor não dá para somar.
    expect(parseCsvStatement(['data;estabelecimento', '18/09;SUBWAY', '20/09;AMAZON'].join('\n'), SETEMBRO)).toEqual([]);
    // Uma linha só no corpo é o texto de um PDF qualquer, não um extrato.
    expect(parseCsvStatement(['estabelecimento;valor', 'SUBWAY;45,90'].join('\n'), SETEMBRO)).toEqual([]);
  });
});
