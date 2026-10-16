import React, { useEffect, useRef, useState } from 'react';
import { findOrCreatePaymentCard, getPaymentCardLabel, type PaymentCard } from '../services/paymentCards';
import { usePreferences } from '../i18n';

/** Valor sentinela da opção "+ Novo cartão"; nunca é salvo em uma fatura. */
const CREATE_VALUE = '__new_card__';

interface Props {
  userId: string | null;
  cards: PaymentCard[];
  /** '' = sem cartão: a compra ou a fatura entra no grupo geral do mês. */
  value: string;
  onChange: (cardId: string) => void;
  ariaLabel: string;
  style?: React.CSSProperties;
}

const REASON_KEY = { incomplete: 'cardIncomplete', limit: 'cardLimit' } as const;

/**
 * Cartão escolhido na hora de lançar ou de importar o print, o CSV e o PDF. O cartão novo nasce
 * aqui, fica só nesta conta e já aparece nos outros lançamentos e nas barras de fatura.
 */
export const CardSelect: React.FC<Props> = ({ userId, cards, value, onChange, ariaLabel, style }) => {
  const { t } = usePreferences();
  const [creating, setCreating] = useState(false);
  const [bank, setBank] = useState('');
  const [last4, setLast4] = useState('');
  const [error, setError] = useState('');
  const bankRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) bankRef.current?.focus();
  }, [creating]);

  const close = () => {
    setCreating(false);
    setBank('');
    setLast4('');
    setError('');
  };

  const tryCreate = () => {
    const result = findOrCreatePaymentCard(userId, bank, last4);
    if (!result.ok) {
      setError(t(REASON_KEY[result.reason]));
      return;
    }
    onChange(result.card.id);
    close();
  };

  if (creating) {
    return (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <input
          ref={bankRef}
          value={bank}
          maxLength={20}
          aria-label={t('cardBank')}
          placeholder={t('newCardPlaceholder')}
          onChange={(event) => { setBank(event.target.value); setError(''); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); tryCreate(); return; }
            if (event.key === 'Escape') { event.preventDefault(); close(); }
          }}
          style={style}
        />
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            value={last4}
            maxLength={4}
            inputMode="numeric"
            aria-label={t('cardLast4')}
            placeholder={t('cardLast4Placeholder')}
            onChange={(event) => { setLast4(event.target.value.replace(/[^0-9]/g, '')); setError(''); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); tryCreate(); return; }
              if (event.key === 'Escape') { event.preventDefault(); close(); }
            }}
            style={{ ...style, width: 80, textAlign: 'center', flex: 'none' }}
          />
          <button type="button" onClick={tryCreate} aria-label={t('add')} disabled={!bank.trim() || last4.length < 4} style={{ ...style, width: 32, padding: '6px 0', textAlign: 'center', cursor: 'pointer', flex: 'none', opacity: !bank.trim() || last4.length < 4 ? 0.4 : 1 }}>+</button>
          <button type="button" onClick={close} aria-label={t('cancel')} style={{ ...style, width: 32, padding: '6px 0', textAlign: 'center', cursor: 'pointer', flex: 'none' }}>×</button>
        </span>
        {error && <span style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.35 }}>{error}</span>}
      </span>
    );
  }

  return (
    <select
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => {
        const picked = event.target.value;
        if (picked === CREATE_VALUE) { setCreating(true); return; }
        onChange(picked);
      }}
      style={style}
    >
      <option value="">{t('noCard')}</option>
      {cards.map((card) => <option key={card.id} value={card.id}>{getPaymentCardLabel(card)}</option>)}
      <option value={CREATE_VALUE}>{t('newCardOption')}</option>
    </select>
  );
};
