import { describe, expect, it } from 'vitest';
import { normalizePurchase, normalizeStatementDate, parseExtractedPurchases, parsePdfTransactionFallback } from './statementParser';
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
