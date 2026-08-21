import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
}

interface Props {
  financialContext: string;
}

const STORAGE_KEY_API = 'groq_api_key';
const STORAGE_KEY_CHAT = 'finance_chat_history';
const CHAT_MODEL = 'groq/compound-mini';
const MAX_CONTEXT_MESSAGES = 12;

const SUGGESTIONS = [
  'Como estou indo financeiramente este mês?',
  'Onde posso economizar?',
  'Quais contas ainda estão pendentes?',
  'Como melhorar meu saldo no fim do mês?',
  'Me dê 3 dicas para organizar meus gastos',
  'Meus gastos estão altos? O que cortar?',
];

function loadChat(): Message[] {
  try { const raw = localStorage.getItem(STORAGE_KEY_CHAT); if (raw) return JSON.parse(raw) as Message[]; } catch { /* ignore */ }
  return [];
}

const IconAI = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a4 4 0 014 4v1h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2V6a4 4 0 014-4z" />
    <circle cx="9" cy="13" r="1" fill="currentColor" /><circle cx="15" cy="13" r="1" fill="currentColor" />
  </svg>
);

export const ChatView: React.FC<Props> = ({ financialContext }) => {
  const [messages, setMessages] = useState<Message[]>(loadChat);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY_API) || '');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKeySetup, setShowKeySetup] = useState(() => !localStorage.getItem(STORAGE_KEY_API));
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(messages.slice(-50))); }, [messages]);

  const saveKey = () => { const k = apiKeyInput.trim(); if (!k.startsWith('gsk_')) return; localStorage.setItem(STORAGE_KEY_API, k); setApiKey(k); setShowKeySetup(false); setApiKeyInput(''); };
  const removeKey = () => { localStorage.removeItem(STORAGE_KEY_API); setApiKey(''); setShowKeySetup(true); };
  const clearChat = () => { setMessages([]); localStorage.removeItem(STORAGE_KEY_CHAT); };

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || !apiKey || loading) return;
    setInput('');
    const userMsg: Message = { role: 'user', content: msg };
    const history = [...messages.filter((m) => m.role !== 'error'), userMsg].slice(-MAX_CONTEXT_MESSAGES);
    setMessages(history);
    setLoading(true);
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: [{ role: 'system', content: financialContext }, ...history.map((m) => ({ role: m.role === 'error' ? 'user' : m.role, content: m.content }))],
          max_tokens: 1200,
          temperature: 0.5,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after');
          const wait = retryAfter ? ` Aguarde ${retryAfter} segundos.` : ' Aguarde alguns segundos.';
          throw new Error(`Limite gratuito da Groq atingido.${wait}`);
        }
        throw new Error(err.error?.message ?? `Erro ${res.status}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('A Groq encerrou a resposta antes de gerar o texto. Tente novamente com uma pergunta mais curta.');
      setMessages((prev) => [...prev, { role: 'assistant', content }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'error', content: err instanceof Error ? err.message : 'Erro desconhecido' }]);
    } finally { setLoading(false); setTimeout(() => inputRef.current?.focus(), 100); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  if (showKeySetup) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 24, padding: '0 4px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#111520', border: '1px solid #1e2a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#60a5fa' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 014 4v1h2a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2V6a4 4 0 014-4z" /><circle cx="9" cy="13" r="1" fill="currentColor" /><circle cx="15" cy="13" r="1" fill="currentColor" /></svg>
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#e0e0e0' }}>Assistente Financeiro</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#555', maxWidth: 360 }}>IA gratuita para analisar seus gastos e dar dicas personalizadas.</p>
        </div>
        <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 12, padding: 20, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 10, color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Chave API Groq</label>
            <input autoFocus type="password" placeholder="gsk_..." value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveKey()} style={{ width: '100%', background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 6, color: '#e0e0e0', padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          </div>
          <div style={{ background: '#0a1a0a', border: '1px solid #152515', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#4ade80', marginBottom: 8 }}>Como configurar</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#777', lineHeight: 1.8 }}>
              <li>Acesse <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>console.groq.com/keys</a></li>
              <li>Crie conta com Google</li>
              <li>Clique em <strong style={{ color: '#c0c0c0' }}>Create API Key</strong></li>
              <li>Cole a chave aqui (começa com <code style={{ color: '#f59e0b', background: '#1a1a0a', padding: '1px 4px', borderRadius: 2 }}>gsk_</code>)</li>
            </ol>
            <div style={{ fontSize: 10, color: '#3a3a3a', marginTop: 8 }}>Gratuito · Sem cartão · Modelo Compound Mini</div>
          </div>
          <button onClick={saveKey} disabled={!apiKeyInput.startsWith('gsk_')} style={{ background: apiKeyInput.startsWith('gsk_') ? '#3b82f6' : '#151520', border: 'none', borderRadius: 6, color: apiKeyInput.startsWith('gsk_') ? '#fff' : '#3a4a5a', cursor: apiKeyInput.startsWith('gsk_') ? 'pointer' : 'not-allowed', padding: '10px', fontSize: 13, fontWeight: 600 }}>Salvar e começar</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 400, gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: '#111520', border: '1px solid #1e2a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa' }}><IconAI /></div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#c0c0c0' }}>Assistente Financeiro</div>
            <div style={{ fontSize: 10, color: '#3a3a3a' }}>Groq · Compound Mini</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {messages.length > 0 && (
            <button onClick={clearChat} style={{ background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 6, color: '#444', cursor: 'pointer', fontSize: 11, padding: '4px 8px' }} title="Limpar conversa">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
            </button>
          )}
          <button onClick={removeKey} style={{ background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 6, color: '#444', cursor: 'pointer', fontSize: 11, padding: '4px 8px' }} title="Trocar chave">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
            </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16 }}>
            <div style={{ textAlign: 'center', color: '#333', fontSize: 12 }}>Pergunte sobre seus gastos, peça dicas ou análises.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (<button key={s} onClick={() => sendMessage(s)} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: 6, color: '#777', cursor: 'pointer', padding: '7px 12px', fontSize: 11, transition: 'all 0.15s', textAlign: 'left' }}>{s}</button>))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 6 }}>
            {m.role !== 'user' && (
              <div style={{ width: 22, height: 22, borderRadius: 6, background: m.role === 'error' ? '#1a1010' : '#111520', border: `1px solid ${m.role === 'error' ? '#2a1515' : '#1e2a3e'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: m.role === 'error' ? '#ef4444' : '#60a5fa', flexShrink: 0, marginBottom: 2 }}>
                {m.role === 'error' ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg> : <IconAI />}
              </div>
            )}
            <div style={{ maxWidth: '85%', background: m.role === 'user' ? '#1a2a4a' : m.role === 'error' ? '#1a1010' : '#141414', border: `1px solid ${m.role === 'user' ? '#1e3050' : m.role === 'error' ? '#2a1515' : '#1e1e1e'}`, borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px', padding: '9px 13px', fontSize: 13, color: m.role === 'error' ? '#ef4444' : '#c0c0c0', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, background: '#111520', border: '1px solid #1e2a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa' }}><IconAI /></div>
            <div style={{ background: '#141414', border: '1px solid #1e1e1e', borderRadius: '12px 12px 12px 4px', padding: '10px 14px' }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0, 1, 2].map((d) => (<div key={d} style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6', animation: `bounce 1.2s ${d * 0.2}s infinite ease-in-out` }} />))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length > 0 && !loading && (
        <div style={{ display: 'flex', gap: 5, overflowX: 'auto', padding: '6px 0', borderTop: '1px solid #141414' }}>
          {SUGGESTIONS.slice(0, 3).map((s) => (<button key={s} onClick={() => sendMessage(s)} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 5, color: '#555', cursor: 'pointer', padding: '4px 10px', fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>{s}</button>))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingTop: 8, borderTop: '1px solid #141414' }}>
        <textarea ref={inputRef} placeholder="Pergunte sobre seus gastos..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} rows={2} style={{ flex: 1, background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 8, color: '#e0e0e0', padding: '9px 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit', resize: 'none', lineHeight: 1.5, transition: 'border-color 0.15s' }} onFocus={(e) => { e.currentTarget.style.borderColor = '#2a3a4a'; }} onBlur={(e) => { e.currentTarget.style.borderColor = '#1e1e1e'; }} />
        <button onClick={() => sendMessage()} disabled={!input.trim() || loading} style={{ background: input.trim() && !loading ? '#3b82f6' : '#151520', border: 'none', borderRadius: 8, color: input.trim() && !loading ? '#fff' : '#3a4a5a', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', padding: '9px 14px', transition: 'all 0.15s', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
        </button>
      </div>

      <style>{`@keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }`}</style>
    </div>
  );
};
