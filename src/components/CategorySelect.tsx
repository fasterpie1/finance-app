import React, { useEffect, useRef, useState } from 'react';
import { usePreferences } from '../i18n';
import { type CategoryId } from '../types';

/** Valor sentinela da opção "+ Nova categoria"; nunca é salvo em um lançamento. */
const CREATE_VALUE = '__create__';

interface Props {
  value: string;
  onChange: (category: CategoryId) => void;
  ariaLabel: string;
  style?: React.CSSProperties;
  /** Descreve o fim do ciclo de edição (fechar o campo inline do dashboard). */
  onFinished?: () => void;
  autoFocus?: boolean;
  unsetLabel?: string;
  /** Campos inline do dashboard fecham quando o foco sai; aqui só o seletor fecha, criar continua aberto. */
  onBlur?: () => void;
}

const REASON_KEY = { empty: 'categoryNameInvalid', duplicate: 'categoryExists', limit: 'categoryLimit' } as const;

/**
 * Seletor de categoria que também cria: a categoria nova fica só nesta conta e aparece
 * na hora nos outros lançamentos, no gráfico e no prompt da IA.
 */
export const CategorySelect: React.FC<Props> = ({ value, onChange, ariaLabel, style, onFinished, autoFocus, unsetLabel, onBlur }) => {
  const { categoryOptions, categoryLabel, addCategory, t } = usePreferences();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Ao virar campo de criação o seletor é desmontado e o navegador dispara o blur dele;
  // sem segurar esse evento, a linha do dashboard fecharia a edição antes de a categoria nascer.
  const suppressBlur = useRef(false);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const close = () => {
    setCreating(false);
    setDraft('');
    setError('');
    onFinished?.();
  };

  const tryCreate = () => {
    const result = addCategory(draft);
    if (!result.ok) {
      setError(t(REASON_KEY[result.reason]));
      return;
    }
    onChange(result.category.id);
    close();
  };

  if (creating) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <input
          ref={inputRef}
          value={draft}
          maxLength={24}
          aria-label={t('newCategoryPlaceholder')}
          placeholder={t('newCategoryPlaceholder')}
          onChange={(event) => { setDraft(event.target.value); setError(''); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); tryCreate(); return; }
            if (event.key === 'Escape') { event.preventDefault(); setCreating(false); setError(''); return; }
          }}
          onBlur={() => { if (!draft.trim()) close(); }}
          style={{ ...style, width: 132 }}
        />
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={tryCreate} aria-label={t('add')} style={{ ...style, width: 28, padding: '5px 0', textAlign: 'center', cursor: 'pointer' }}>+</button>
        {error && <span style={{ fontSize: 10, color: '#ef4444' }}>{error}</span>}
      </span>
    );
  }

  // Uma categoria excluída depois continua no lançamento; sumir da lista deixaria a linha em branco.
  const isKnown = value === '' || categoryOptions.some((option) => option.value === value);
  return (
    <select
      autoFocus={autoFocus}
      value={value}
      aria-label={ariaLabel}
      onChange={(event) => {
        const picked = event.target.value;
        if (picked === CREATE_VALUE) { suppressBlur.current = true; setCreating(true); return; }
        if (picked === '') { onChange(''); return; }
        onChange(picked);
        onFinished?.();
      }}
      onBlur={() => { if (suppressBlur.current) { suppressBlur.current = false; return; } onBlur?.(); }}
      style={style}
    >
      {unsetLabel !== undefined && <option value="">{unsetLabel}</option>}
      {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      {!isKnown && <option value={value}>{categoryLabel(value)}</option>}
      <option value={CREATE_VALUE}>{t('newCategoryOption')}</option>
    </select>
  );
};
