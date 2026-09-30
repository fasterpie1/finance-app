import React, { useEffect, useRef, useState } from 'react';
import {
  type BillCategory,
  BILL_CATEGORY_LABELS,
  getMonthIndex,
} from '../types';
import { type CreditCardInvoice, type CreditCardTransaction, type ExpenseOwner } from '../types';
import { getTransactionDay, setTransactionDay } from '../services/cardTransactions';
import {
  type ExtractedPurchase,
  extractPurchasesFromImage,
  extractPurchasesFromText,
} from '../services/statementImport';
import { fileToBase64, pdfToText } from '../services/statementFiles';
import { extractStatementTotalCents } from '../services/statementTotals';
import { findDuplicateTransaction } from '../services/transactionDuplicates';
import { hasGroqKey } from '../services/groq';
import { readUserStorage, writeUserStorage } from '../services/userStorage';
import { usePreferences } from '../i18n';

interface Props {
  onImport: (invoice: CreditCardInvoice) => void;
  userId: string | null;
  month: string;
  year: number;
  existingTransactions: CreditCardTransaction[];
}

const fieldStyle: React.CSSProperties = {
  background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 6, color: '#e0e0e0', padding: '6px 10px', fontSize: 12, outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};

function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

const STORAGE_KEY_GROQ_STATUS = 'groq_configured';
const MAX_FILE_SIZE_MB = 20;
/** A Groq responde com o texto cru do limite de plano (inclui id da organização e link de
 *  cobrança). Esse texto não serve para o usuário final, então vira a mensagem traduzida. */
const AI_LIMIT_ERROR = /request too large|output tokens per minute|otpm|rate limit|tokens per minute|try again in|upgrade to dev tier|service tier/i;

export const StatementImportPanel: React.FC<Props> = ({ onImport, userId, month, year, existingTransactions }) => {
  const { formatMoney, parseAmount, t } = usePreferences();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [incomplete, setIncomplete] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsPdf, setPreviewIsPdf] = useState(false);
  const [items, setItems] = useState<ExtractedPurchase[]>([]);
  const [statementTotalCents, setStatementTotalCents] = useState<number | undefined>();

  const hasCachedKeyStatus = readUserStorage(userId, STORAGE_KEY_GROQ_STATUS) === 'true';
  const [apiKeyConfigured, setApiKeyConfigured] = useState(hasCachedKeyStatus);
  const [checkingKey, setCheckingKey] = useState(!hasCachedKeyStatus);
  const selectedCount = items.filter((i) => i.selected).length;
  const selectedTotal = items.filter((i) => i.selected).reduce((s, i) => s + i.amount, 0);
  const displayedTotal = statementTotalCents != null ? statementTotalCents / 100 : selectedTotal;

  const handleFile = async (file: File) => {
    setError('');
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Envie um PDF ou imagem de até ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }
    setLoading(true);
    setItems([]);
    setIncomplete(false);
    setStatementTotalCents(undefined);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setPreviewIsPdf(file.type === 'application/pdf');

    try {
      if (!apiKeyConfigured) throw new Error('Configure sua chave Groq na aba Assistente antes de importar.');
      const outcome = file.type === 'application/pdf'
        ? await (async () => {
          const text = await pdfToText(file);
          setStatementTotalCents(extractStatementTotalCents(text));
          return extractPurchasesFromText(text, getMonthIndex(month));
        })()
        : await (async () => {
          const { base64, mimeType } = await fileToBase64(file);
          return extractPurchasesFromImage(base64, mimeType, getMonthIndex(month));
        })();
      const extracted = outcome.purchases;
      if (extracted.length === 0) throw new Error(file.type === 'application/pdf' ? t('noItemsPdf') : t('noItemsImage'));
      setIncomplete(!outcome.complete);
      setItems(extracted.map((p) => {
        const duplicate = findDuplicateTransaction({ ...p, amountCents: Math.round(p.amount * 100) }, existingTransactions);
        return { ...p, id: makeId(), selected: true, duplicateConfidence: duplicate?.confidence };
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao processar arquivo';
      setError(AI_LIMIT_ERROR.test(message) ? t('importAiLimit') : message);
    } finally {
      setLoading(false);
    }
  };

  const updateItem = (id: string, patch: Partial<ExtractedPurchase>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  const handleConfirm = () => {
    const transactions: CreditCardTransaction[] = items
      .filter((i) => i.selected && i.name.trim() && i.amount > 0)
      .map((i) => ({
        id: makeId(),
        invoiceId: '',
        merchant: i.name.trim(),
        amountCents: Math.round(i.amount * 100),
        type: i.type,
        owner: i.owner,
        personalAmountCents: i.owner === 'SHARED' ? Math.min(Math.round(i.amount * 100), Math.max(0, i.personalAmountCents ?? 0)) : undefined,
        thirdPartyName: i.owner === 'THIRD_PARTY' ? i.thirdPartyName?.trim() || undefined : undefined,
        cardLast4: i.cardLast4,
        date: setTransactionDay(i.date, getTransactionDay(i.date), getMonthIndex(month)),
        category: i.category,
        installmentCurrent: Math.max(1, Math.min(i.installmentCurrent, i.installmentTotal)),
        installmentTotal: Math.max(i.installmentCurrent, i.installmentTotal),
        source: 'IMPORT',
      }));
    if (transactions.length === 0) return;
    const invoiceId = makeId();
    onImport({
      id: invoiceId,
      month,
      year,
      statementTotalCents,
      transactions: transactions.map((transaction) => ({ ...transaction, invoiceId })),
    });
    setItems([]);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewIsPdf(false);
    setStatementTotalCents(undefined);
    setOpen(false);
  };

  const toggleOpen = () => {
    setOpen((prev) => {
      if (prev) {
        setItems([]);
        setError('');
        setIncomplete(false);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setPreviewIsPdf(false);
        setStatementTotalCents(undefined);
      }
      return !prev;
    });
  };

  // Revoga a URL de preview ao trocar de arquivo ou desmontar, evitando vazamento.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!open) return;
    const cachedStatus = readUserStorage(userId, STORAGE_KEY_GROQ_STATUS) === 'true';
    if (cachedStatus) {
      void hasGroqKey().then((configured) => {
        if (!configured) setApiKeyConfigured(false);
      }).catch(() => undefined);
      return;
    }
    void hasGroqKey().then((configured) => {
      setApiKeyConfigured(configured);
      if (configured) writeUserStorage(userId, STORAGE_KEY_GROQ_STATUS, 'true');
    }).catch(() => setApiKeyConfigured(false)).finally(() => setCheckingKey(false));
  }, [open, userId]);

  return (
    <div className="theme-import-panel" style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden' }}>
      <button type="button" onClick={toggleOpen} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', padding: '14px 18px', cursor: 'pointer', color: '#c0c0c0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t('importInvoice')}</span>
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M2 4l4 4 4-4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="cc-divider" style={{ height: 1, background: '#1a1a1a' }} />

          {checkingKey && (
            <div className="import-info-box" style={{ background: '#111520', border: '1px solid #1e2a3e', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#60a5fa' }}>
              {t('checkingAssistant')}
            </div>
          )}

          {!checkingKey && !apiKeyConfigured && (
            <div className="import-warn-box" style={{ background: '#1a150a', border: '1px solid #2a2010', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f59e0b' }}>
              {t('configureGroq')}
            </div>
          )}

          <p style={{ margin: 0, fontSize: 12, color: '#8f8f8f', lineHeight: 1.5 }}>
            {t('importInvoiceDescription')}
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />

          <button type="button"
            onClick={() => fileRef.current?.click()}
            disabled={loading || checkingKey || !apiKeyConfigured}
            className="import-upload"
            style={{
              background: loading ? '#151520' : '#111520',
              border: '1px dashed #1e2a3e',
              borderRadius: 8,
              color: loading ? '#3a4a5a' : '#60a5fa',
              cursor: loading || checkingKey || !apiKeyConfigured ? 'not-allowed' : 'pointer',
              padding: '14px',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? (
              <>
                <span style={{ width: 14, height: 14, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
                {t('analyzingInvoice')}
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                {t('selectImagePdf')}
              </>
            )}
          </button>

          {previewUrl && !previewIsPdf && (
            <img src={previewUrl} alt={t('invoicePreviewAlt')} style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, border: '1px solid #1e1e1e' }} />
          )}
          {previewUrl && previewIsPdf && (
            <div className="import-pdf" style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, padding: '14px', color: '#999', fontSize: 12 }}>{t('pdfSelected')}</div>
          )}

          {error && (
            <div className="import-error-box" style={{ background: '#1a1010', border: '1px solid #2a1515', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#ef4444' }}>{error}</div>
          )}

          {incomplete && items.length > 0 && (
            <div className="import-warn-box" style={{ background: '#1a150a', border: '1px solid #2a2010', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f59e0b' }}>{t('importTruncated')}</div>
          )}

          {items.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {items.length} {items.length !== 1 ? t('purchasesFound') : t('purchaseFound')}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                {items.map((item) => (
                  <div key={item.id} className={item.duplicateConfidence ? 'import-item-card is-duplicate' : 'import-item-card'} style={{ background: '#0e0e0e', border: `1px solid ${item.duplicateConfidence ? '#5a3b12' : item.selected ? '#1e2a3e' : '#1a1a1a'}`, borderRadius: 8, padding: '10px 12px', opacity: item.selected ? 1 : 0.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <input type="checkbox" checked={item.selected} onChange={(e) => updateItem(item.id, { selected: e.target.checked })} style={{ accentColor: '#3b82f6', width: 16, height: 16 }} />
                      <input style={{ ...fieldStyle, flex: 1 }} value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} placeholder="Nome" />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 9, color: '#8b8b8b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('dayPlaceholder')}</span>
                        <input inputMode="numeric" pattern="[0-9]*" aria-label={t('transactionDayAria')} placeholder="--" value={getTransactionDay(item.date) ?? ''} onChange={(e) => updateItem(item.id, { date: setTransactionDay(item.date, parseInt(e.target.value) || undefined, getMonthIndex(month)) })} style={{ ...fieldStyle, width: 44, padding: '6px 4px', textAlign: 'center' }} />
                      </div>
                    </div>
                    {item.duplicateConfidence && (
                      <div className="cc-dup-warning" style={{ background: '#241a0b', border: '1px solid #5a3b12', borderRadius: 6, padding: '7px 9px', marginBottom: 8, color: '#f59e0b', fontSize: 11 }}>
                        {item.duplicateConfidence === 'high' ? `${t('possibleDuplicate')}: ${t('duplicateHigh')}` : `${t('possibleDuplicate')}: ${t('duplicatePossible')}`}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 9, color: '#8b8b8b', marginBottom: 2 }}>{t('amount')}</div>
                        <input style={fieldStyle} inputMode="decimal" value={item.amount.toFixed(2).replace('.', ',')} onChange={(e) => updateItem(item.id, { amount: parseAmount(e.target.value) })} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: '#8b8b8b', marginBottom: 2 }}>{t('installmentShort')}</div>
                        <input style={fieldStyle} inputMode="numeric" value={String(item.installmentCurrent)} onChange={(e) => updateItem(item.id, { installmentCurrent: parseInt(e.target.value) || 1 })} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: '#8b8b8b', marginBottom: 2 }}>{t('installmentTotal')}</div>
                        <input style={fieldStyle} inputMode="numeric" value={String(item.installmentTotal)} onChange={(e) => updateItem(item.id, { installmentTotal: parseInt(e.target.value) || 1 })} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: '#8b8b8b', marginBottom: 2 }}>{t('category')}</div>
                        <select style={fieldStyle} value={item.category} onChange={(e) => updateItem(item.id, { category: e.target.value as BillCategory })}>
                          {(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((c) => (
                            <option key={c} value={c}>{BILL_CATEGORY_LABELS[c]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {item.installmentTotal > 1 && (
                      <div style={{ fontSize: 10, color: '#8f8f8f', marginTop: 6 }}>
                        {t('installmentSummary', { cur: item.installmentCurrent, total: item.installmentTotal, amount: formatMoney(item.amount) })}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: item.owner === 'SHARED' || item.owner === 'THIRD_PARTY' ? '1fr 1fr' : '1fr', gap: 6, marginTop: 8 }}>
                      <div>
                        <div style={{ fontSize: 9, color: '#8b8b8b', marginBottom: 2 }}>{t('responsibility')}</div>
                        <select style={fieldStyle} value={item.owner} onChange={(e) => updateItem(item.id, { owner: e.target.value as ExpenseOwner })}>
                          <option value="ME">{t('me')}</option>
                          <option value="THIRD_PARTY">{t('thirdParty')}</option>
                          <option value="SHARED">{t('shared')}</option>
                          <option value="UNCLASSIFIED">{t('unclassified')}</option>
                        </select>
                      </div>
                      {item.owner === 'THIRD_PARTY' && (
                        <div>
                          <div style={{ fontSize: 9, color: '#8b8b8b', marginBottom: 2 }}>{t('thirdParty')}</div>
                          <input style={fieldStyle} value={item.thirdPartyName ?? ''} onChange={(e) => updateItem(item.id, { thirdPartyName: e.target.value })} placeholder={t('optionalName')} />
                        </div>
                      )}
                      {item.owner === 'SHARED' && (
                        <div>
                          <div style={{ fontSize: 9, color: '#8b8b8b', marginBottom: 2 }}>{t('myShare')}</div>
                          <input style={fieldStyle} inputMode="decimal" value={item.personalAmountCents == null ? '' : (item.personalAmountCents / 100).toFixed(2).replace('.', ',')} onChange={(e) => updateItem(item.id, { personalAmountCents: Math.round(parseAmount(e.target.value) * 100) })} placeholder="0,00" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 12, color: '#9a9a9a' }}>
                  {selectedCount} · {t('invoiceTotal')}: <strong className="import-total-strong" style={{ color: '#c0c0c0' }}>{formatMoney(displayedTotal)}</strong>
                </span>
                <button type="button"
                  onClick={handleConfirm}
                  disabled={selectedCount === 0}
                  className="import-confirm"
                  style={{
                    background: selectedCount > 0 ? '#16a34a' : '#151520',
                    border: 'none',
                    borderRadius: 6,
                    color: selectedCount > 0 ? '#fff' : '#3a4a5a',
                    cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
                    padding: '10px 20px',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {t('launchPurchases')} ({selectedCount})
                </button>
              </div>
            </>
          )}

          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
};
