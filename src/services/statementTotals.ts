export function extractStatementTotalCents(statementText: string): number | undefined {
  const match = statementText.match(/total\s+a\s+pagar\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i)
    ?? statementText.match(/valor\s+da\s+fatura\s*:?\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/i);
  if (!match) return undefined;
  return Math.round(Number(match[1].replace(/\./g, '').replace(',', '.')) * 100);
}