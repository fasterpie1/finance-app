import type { CreditCardTransaction, ReimbursementReceipt } from '../types';
import { getThirdPartyImpactForPersonCents } from './cardTransactions';
import { getReimbursementBalances } from './reimbursements';

export interface ReimbursementImageLine {
  merchant: string;
  date?: string;
  amountCents: number;
}

export interface ReimbursementImageSummary {
  personName: string;
  periodLabel: string;
  items: ReimbursementImageLine[];
  owedCents: number;
  receivedCents: number;
  remainingCents: number;
  creditCents: number;
}

export function getReimbursementImageSummary(
  personName: string,
  periodLabel: string,
  transactions: CreditCardTransaction[],
  receipts: ReimbursementReceipt[],
): ReimbursementImageSummary {
  const key = personName.trim().toLocaleLowerCase();
  const balance = getReimbursementBalances(transactions, receipts)
    .find((group) => group.name.toLocaleLowerCase() === key);
  const items = transactions.flatMap((transaction) => {
    const amountCents = getThirdPartyImpactForPersonCents(transaction, personName);
    return amountCents === 0 ? [] : [{
      merchant: transaction.merchant.trim() || 'Compra',
      date: transaction.date,
      amountCents,
    }];
  });
  return {
    personName: personName.trim(),
    periodLabel,
    items,
    owedCents: balance?.owedCents ?? 0,
    receivedCents: balance?.receivedCents ?? 0,
    remainingCents: balance?.remainingCents ?? 0,
    creditCents: balance?.creditCents ?? 0,
  };
}

function formatCurrency(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

function displayDate(value: string | undefined, locale: string): string {
  if (!value) return '';
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return locale === 'en' ? `${iso[2]}/${iso[3]}/${iso[1]}` : `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dayMonth = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (dayMonth) return `${dayMonth[1].padStart(2, '0')}/${dayMonth[2].padStart(2, '0')}`;
  return value;
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
): void {
  let visible = text;
  while (visible.length > 1 && context.measureText(visible).width > maxWidth) {
    visible = `${visible.slice(0, -2)}…`;
  }
  context.fillText(visible, x, y, maxWidth);
}

export async function createReimbursementPng(summary: ReimbursementImageSummary, locale: string): Promise<Blob> {
  const width = 1080;
  const padding = 72;
  const rowHeight = 74;
  const listTop = 570;
  const height = listTop + Math.max(summary.items.length, 1) * rowHeight + 112;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar a imagem da cobrança.');

  const text = locale === 'en'
    ? {
      eyebrow: 'SHARED EXPENSE SUMMARY', title: 'Card bill split', period: 'Period',
      owed: 'Share assigned', received: 'Already received', remaining: 'Still due',
      items: 'ITEMS', share: 'PERSON’S SHARE', credit: 'Credit balance',
      footer: 'Amounts shown are this person’s share of each purchase.',
    }
    : {
      eyebrow: 'RESUMO DE DESPESAS COMPARTILHADAS', title: 'Divisão da fatura', period: 'Período',
      owed: 'Parte atribuída', received: 'Já recebido', remaining: 'Falta pagar',
      items: 'LANÇAMENTOS', share: 'PARTE DA PESSOA', credit: 'Crédito excedente',
      footer: 'Os valores mostram apenas a parte desta pessoa em cada compra.',
    };

  context.fillStyle = '#0b0f14';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#121923';
  context.fillRect(padding, 52, width - padding * 2, 440);

  context.fillStyle = '#8fa3b8';
  context.font = '600 20px system-ui, sans-serif';
  context.fillText(text.eyebrow, padding + 36, 104);
  context.fillStyle = '#f2f5f8';
  context.font = '700 48px system-ui, sans-serif';
  drawText(context, text.title, padding + 36, 170, width - padding * 2 - 72);
  context.font = '600 34px system-ui, sans-serif';
  drawText(context, summary.personName, padding + 36, 224, width - padding * 2 - 72);
  context.fillStyle = '#a8b2bf';
  context.font = '22px system-ui, sans-serif';
  context.fillText(`${text.period}: ${summary.periodLabel}`, padding + 36, 270);

  const columns = [
    { label: text.owed, value: summary.owedCents },
    { label: text.received, value: summary.receivedCents },
    { label: text.remaining, value: summary.remainingCents },
  ];
  const columnGap = 16;
  const columnWidth = (width - padding * 2 - 72 - columnGap * 2) / 3;
  columns.forEach((column, index) => {
    const x = padding + 36 + index * (columnWidth + columnGap);
    context.fillStyle = '#1b2632';
    context.fillRect(x, 310, columnWidth, 132);
    context.fillStyle = '#a8b2bf';
    context.font = '20px system-ui, sans-serif';
    context.fillText(column.label, x + 18, 346);
    context.fillStyle = index === 2 ? '#93c5fd' : '#f2f5f8';
    context.font = '700 28px system-ui, sans-serif';
    drawText(context, formatCurrency(column.value, locale), x + 18, 397, columnWidth - 36);
  });

  context.fillStyle = '#f2f5f8';
  context.font = '700 20px system-ui, sans-serif';
  context.fillText(text.items, padding, 536);
  context.fillStyle = '#8793a1';
  context.font = '600 16px system-ui, sans-serif';
  context.textAlign = 'right';
  context.fillText(text.share, width - padding, 536);
  context.textAlign = 'left';

  summary.items.forEach((item, index) => {
    const y = listTop + index * rowHeight;
    context.fillStyle = index % 2 === 0 ? '#111821' : '#0e141b';
    context.fillRect(padding, y, width - padding * 2, rowHeight);
    context.fillStyle = '#e5eaf0';
    context.font = '600 22px system-ui, sans-serif';
    drawText(context, item.merchant, padding + 20, y + 32, width - padding * 2 - 280);
    const date = displayDate(item.date, locale);
    if (date) {
      context.fillStyle = '#8793a1';
      context.font = '17px system-ui, sans-serif';
      context.fillText(date, padding + 20, y + 57);
    }
    context.fillStyle = item.amountCents < 0 ? '#73d5a2' : '#e5eaf0';
    context.font = '600 22px system-ui, sans-serif';
    context.textAlign = 'right';
    context.fillText(formatCurrency(item.amountCents, locale), width - padding - 20, y + 43);
    context.textAlign = 'left';
  });

  const footerY = listTop + Math.max(summary.items.length, 1) * rowHeight + 46;
  context.fillStyle = '#8793a1';
  context.font = '17px system-ui, sans-serif';
  context.fillText(text.footer, padding, footerY);
  if (summary.creditCents > 0) {
    context.fillStyle = '#73d5a2';
    context.textAlign = 'right';
    context.fillText(`${text.credit}: ${formatCurrency(summary.creditCents, locale)}`, width - padding, footerY);
    context.textAlign = 'left';
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Não foi possível exportar a imagem em PNG.'));
    }, 'image/png');
  });
}
