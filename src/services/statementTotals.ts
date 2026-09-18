export function extractStatementTotalCents(statementText: string): number | undefined {
  const amountPattern = '(?:R\\$\\s*)?(\\d{1,3}(?:\\.\\d{3})*,\\d{2})';
  const match = statementText.match(new RegExp(`total\\s+desta\\s+fatura\\s*${amountPattern}`, 'i'))
    ?? statementText.match(new RegExp(`o\\s+total\\s+(?:da|de)\\s+sua\\s+fatura\\s*(?:é|e)?:?\\s*${amountPattern}`, 'i'))
    ?? statementText.match(new RegExp(`lançamentos\\s+atuais\\s*${amountPattern}`, 'i'))
    ?? statementText.match(new RegExp(`valor\\s+da\\s+fatura\\s*:?\\s*${amountPattern}`, 'i'))
    ?? statementText.match(new RegExp(`total\\s+a\\s+pagar\\s*${amountPattern}`, 'i'));
  if (!match) return undefined;
  return Math.round(Number(match[1].replace(/\./g, '').replace(',', '.')) * 100);
}