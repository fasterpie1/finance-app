import React from 'react';
import { useModalA11y } from '../hooks/useModalA11y';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onClose: () => void;
}

/** Substitui window.confirm: mesmo fluxo de confirmação, porém temático e acessível. */
export const ConfirmDialog: React.FC<Props> = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  onConfirm,
  onClose,
}) => {
  const dialogRef = useModalA11y<HTMLDivElement>(open, onClose);
  if (!open) return null;

  return (
    <div className="confirm-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`confirm-card theme-confirm ${tone === 'danger' ? 'confirm-card-danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="confirm-title" style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: '#e0e0e0' }}>{title}</h2>
        <p id="confirm-dialog-message" className="confirm-message" style={{ margin: '0 0 18px', fontSize: 13, color: '#a3a3a3', lineHeight: 1.55 }}>{message}</p>
        <div className="confirm-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="confirm-cancel" onClick={onClose} style={{ background: 'transparent', border: '1px solid #2e2e2e', borderRadius: 8, color: '#b3b3b3', cursor: 'pointer', padding: '9px 14px', fontSize: 12, fontWeight: 600, minHeight: 40 }}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-submit"
            onClick={onConfirm}
            style={{ background: tone === 'danger' ? '#dc2626' : '#2563eb', border: 0, borderRadius: 8, color: '#ffffff', cursor: 'pointer', padding: '9px 14px', fontSize: 12, fontWeight: 700, minHeight: 40 }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
