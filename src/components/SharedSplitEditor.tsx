import { useId, type CSSProperties } from 'react';
import { usePreferences } from '../i18n';
import { isValidThirdPartyNames, splitAmountEqually } from '../services/cardTransactions';

interface Props {
  totalCents: number;
  names: string[];
  onChange: (names: string[]) => void;
}

const fieldStyle: CSSProperties = {
  minHeight: 40,
  minWidth: 0,
  flex: '1 1 160px',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #2a2a2a',
  background: '#0e0e0e',
  color: '#e0e0e0',
  font: 'inherit',
};

export function SharedSplitEditor({ totalCents, names, onChange }: Props) {
  const { locale, formatMoney } = usePreferences();
  const id = useId();
  const text = locale === 'en'
    ? { title: 'Split equally, including you', you: 'Your share', person: 'Person', add: 'Add person', remove: 'Remove', placeholder: 'Person name', duplicate: 'Enter a valid, distinct name for each person.' }
    : { title: 'Dividir igualmente, incluindo você', you: 'Sua parte', person: 'Pessoa', add: 'Adicionar pessoa', remove: 'Remover', placeholder: 'Nome da pessoa', duplicate: 'Informe um nome válido e diferente para cada pessoa.' };
  const displayedNames = names.length > 0 ? names : [''];
  const valid = isValidThirdPartyNames(displayedNames);
  const allocation = valid ? splitAmountEqually(totalCents, displayedNames) : undefined;
  const participantCount = displayedNames.length + 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#9a9a9a' }}>
        {text.title} · {participantCount} {locale === 'en' ? 'parts' : 'partes'}
      </div>
      {displayedNames.map((name, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label htmlFor={`${id}-person-${index}`} style={{ fontSize: 11, color: '#a3a3a3' }}>
            {text.person} {index + 1}
          </label>
          <input
            id={`${id}-person-${index}`}
            value={name}
            maxLength={120}
            onChange={(event) => onChange(displayedNames.map((person, personIndex) => (
              personIndex === index ? event.target.value : person
            )))}
            placeholder={text.placeholder}
            style={fieldStyle}
          />
          {displayedNames.length > 1 && (
            <button type="button" onClick={() => onChange(displayedNames.filter((_, personIndex) => personIndex !== index))}
              aria-label={`${text.remove} ${text.person.toLowerCase()} ${index + 1}`}
              style={{ minHeight: 40, padding: '8px 10px', borderRadius: 6, border: '1px solid #2a2a2a', background: '#151515', color: '#aaa', cursor: 'pointer' }}>
              {text.remove}
            </button>
          )}
          {allocation && (
            <span style={{ flex: '0 0 auto', color: '#d4d4d4', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(allocation.thirdPartyShares[index].amountCents / 100)}
            </span>
          )}
        </div>
      ))}
      {!valid && <div role="alert" style={{ fontSize: 11, color: '#f87171' }}>{text.duplicate}</div>}
      {allocation && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: '#93c5fd', fontSize: 12 }}>
          <span>{text.you}</span>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(allocation.personalAmountCents / 100)}</strong>
        </div>
      )}
      <button type="button" onClick={() => onChange([...displayedNames, ''])}
        style={{ alignSelf: 'flex-start', minHeight: 38, padding: '7px 10px', borderRadius: 6, border: '1px solid #2a2a2a', background: '#151515', color: '#c4c4c4', cursor: 'pointer', font: 'inherit', fontSize: 11 }}>
        + {text.add}
      </button>
    </div>
  );
}
