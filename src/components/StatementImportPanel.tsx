import React, { useEffect, useRef, useState } from 'react';
import {
  type BillCategory,
  BILL_CATEGORY_LABELS,
  formatCurrency,
  parseBRL,
} from '../types';
import { type CreditCardInvoice, type CreditCardTransaction, type ExpenseOwner } from '../types';
import {
  type ExtractedPurchase,
  extractPurchasesFromImage,
  extractPurchasesFromText,
  fileToBase64,
  pdfToText,
} from '../services/statementImport';
import { extractStatementTotalCents } from '../services/statementTotals';
import { findDuplicateTransaction } from '../services/transactionDuplicates';
import { hasGroqKey } from '../services/groq';
import { readUserStorage, writeUserStorage } from '../services/userStorage';

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

export const StatementImportPanel: React.FC<Props> = ({ onImport, userId, month, year, existingTransactions }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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
    setLoading(true);
    setItems([]);
    setStatementTotalCents(undefined);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setPreviewIsPdf(file.type === 'application/pdf');

    try {
      if (!apiKeyConfigured) throw new Error('Configure sua chave Groq na aba Assistente antes de importar.');
      const extracted = file.type === 'application/pdf'
        ? await (async () => {
          const text = await pdfToText(file);
          setStatementTotalCents(extractStatementTotalCents(text));
          return extractPurchasesFromText(text);
        })()
        : await (async () => {
          const { base64, mimeType } = await fileToBase64(file);
          return extractPurchasesFromImage(base64, mimeType);
        })();
      if (extracted.length === 0) throw new Error(file.type === 'application/pdf' ? 'Nenhuma compra encontrada no PDF. Se ele for escaneado, envie uma imagem ou um PDF com texto selecionável.' : 'Nenhuma compra encontrada na imagem. Verifique se a fatura está legível e tente novamente.');
      setItems(extracted.map((p) => {
        const duplicate = findDuplicateTransaction({ ...p, amountCents: Math.round(p.amount * 100) }, existingTransactions);
        return { ...p, id: makeId(), selected: true, duplicateConfidence: duplicate?.confidence };
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar arquivo');
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
        date: i.date,
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
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setPreviewIsPdf(false);
        setStatementTotalCents(undefined);
      }
      return !prev;
    });
  };

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
      <button onClick={toggleOpen} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'transparent', border: 'none', padding: '14px 18px', cursor: 'pointer', color: '#c0c0c0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Importar fatura</span>
        </div>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M2 4l4 4 4-4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ height: 1, background: '#1a1a1a' }} />

          {checkingKey && (
            <div style={{ background: '#111520', border: '1px solid #1e2a3e', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#60a5fa' }}>
              Verificando o Assistente...
            </div>
          )}

          {!checkingKey && !apiKeyConfigured && (
            <div style={{ background: '#1a150a', border: '1px solid #2a2010', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#f59e0b' }}>
              Configure sua chave Groq na aba <strong>Assistente</strong> para usar a importação por foto.
            </div>
          )}

          <p style={{ margin: 0, fontSize: 12, color: '#555', lineHeight: 1.5 }}>
            Selecione uma imagem, print ou arquivo PDF da fatura do cartão. A IA extrai as compras para você revisar antes de lançar.
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

          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading || checkingKey || !apiKeyConfigured}
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
                Analisando fatura...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Selecionar imagem ou PDF
              </>
            )}
          </button>

          {previewUrl && !previewIsPdf && (
            <img src={previewUrl} alt="Preview da fatura" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, border: '1px solid #1e1e1e' }} />
          )}
          {previewUrl && previewIsPdf && (
            <div style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, padding: '14px', color: '#999', fontSize: 12 }}>PDF selecionado. O texto da fatura será analisado.</div>
          )}

          {error && (
            <div style={{ background: '#1a1010', border: '1px solid #2a1515', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#ef4444' }}>{error}</div>
          )}

          {items.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {items.length} compra{items.length !== 1 ? 's' : ''} encontrada{items.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                {items.map((item) => (
                  <div key={item.id} style={{ background: '#0e0e0e', border: `1px solid ${item.duplicateConfidence ? '#5a3b12' : item.selected ? '#1e2a3e' : '#1a1a1a'}`, borderRadius: 8, padding: '10px 12px', opacity: item.selected ? 1 : 0.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <input type="checkbox" checked={item.selected} onChange={(e) => updateItem(item.id, { selected: e.target.checked })} style={{ accentColor: '#3b82f6', width: 16, height: 16 }} />
                      <input style={{ ...fieldStyle, flex: 1 }} value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} placeholder="Nome" />
                    </div>
                    {item.duplicateConfidence && (
                      <div style={{ background: '#241a0b', border: '1px solid #5a3b12', borderRadius: 6, padding: '7px 9px', marginBottom: 8, color: '#f59e0b', fontSize: 11 }}>
                        {item.duplicateConfidence === 'high' ? 'Possível duplicado: valor, parcela e identificadores coincidem.' : 'Possível duplicado: valor, tipo e parcela coincidem; confirme antes de lançar.'}
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 9, color: '#444', marginBottom: 2 }}>Valor</div>
                        <input style={fieldStyle} inputMode="decimal" value={item.amount.toFixed(2).replace('.', ',')} onChange={(e) => updateItem(item.id, { amount: parseBRL(e.target.value) })} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: '#444', marginBottom: 2 }}>Parc.</div>
                        <input style={fieldStyle} inputMode="numeric" value={String(item.installmentCurrent)} onChange={(e) => updateItem(item.id, { installmentCurrent: parseInt(e.target.value) || 1 })} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: '#444', marginBottom: 2 }}>Total</div>
                        <input style={fieldStyle} inputMode="numeric" value={String(item.installmentTotal)} onChange={(e) => updateItem(item.id, { installmentTotal: parseInt(e.target.value) || 1 })} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: '#444', marginBottom: 2 }}>Cat.</div>
                        <select style={fieldStyle} value={item.category} onChange={(e) => updateItem(item.id, { category: e.target.value as BillCategory })}>
                          {(Object.keys(BILL_CATEGORY_LABELS) as BillCategory[]).map((c) => (
                            <option key={c} value={c}>{BILL_CATEGORY_LABELS[c]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {item.installmentTotal > 1 && (
                      <div style={{ fontSize: 10, color: '#555', marginTop: 6 }}>
                        Parcela {item.installmentCurrent}/{item.installmentTotal} · {formatCurrency(item.amount)}/mês
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: item.owner === 'SHARED' || item.owner === 'THIRD_PARTY' ? '1fr 1fr' : '1fr', gap: 6, marginTop: 8 }}>
                      <div>
                        <div style={{ fontSize: 9, color: '#444', marginBottom: 2 }}>Responsabilidade</div>
                        <select style={fieldStyle} value={item.owner} onChange={(e) => updateItem(item.id, { owner: e.target.value as ExpenseOwner })}>
                          <option value="ME">Eu</option>
                          <option value="THIRD_PARTY">Terceiro</option>
                          <option value="SHARED">Compartilhado</option>
                          <option value="UNCLASSIFIED">Não classificado</option>
                        </select>
                      </div>
                      {item.owner === 'THIRD_PARTY' && (
                        <div>
                          <div style={{ fontSize: 9, color: '#444', marginBottom: 2 }}>Terceiro</div>
                          <input style={fieldStyle} value={item.thirdPartyName ?? ''} onChange={(e) => updateItem(item.id, { thirdPartyName: e.target.value })} placeholder="Nome (opcional)" />
                        </div>
                      )}
                      {item.owner === 'SHARED' && (
                        <div>
                          <div style={{ fontSize: 9, color: '#444', marginBottom: 2 }}>Minha parte</div>
                          <input style={fieldStyle} inputMode="decimal" value={item.personalAmountCents == null ? '' : (item.personalAmountCents / 100).toFixed(2).replace('.', ',')} onChange={(e) => updateItem(item.id, { personalAmountCents: Math.round(parseBRL(e.target.value) * 100) })} placeholder="0,00" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 12, color: '#777' }}>
                  {selectedCount} lançamento{selectedCount !== 1 ? 's' : ''} · Total da fatura: <strong style={{ color: '#c0c0c0' }}>{formatCurrency(displayedTotal)}</strong>
                </span>
                <button
                  onClick={handleConfirm}
                  disabled={selectedCount === 0}
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
                  Lançar {selectedCount} compra{selectedCount !== 1 ? 's' : ''}
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
