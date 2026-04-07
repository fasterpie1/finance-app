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

const SUGGESTIONS = [
  '📊 Como estou indo financeiramente este mês?',
  '💡 Onde posso economizar?',
  '⚠️ Quais contas ainda estão pendentes?',
  '📈 Como melhorar meu saldo no fim do mês?',
  '🎯 Me dê 3 dicas para organizar melhor meus gastos',
  '📉 Meus gastos estão altos? O que cortar?',
];

function loadChat(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHAT);
    if (raw) return JSON.parse(raw) as Message[];
  } catch { /* ignore */ }
  return [];
}

export const ChatView: React.FC<Props> = ({ financialContext }) => {
  const [messages, setMessages] = useState<Message[]>(loadChat);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY_API) || '');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKeySetup, setShowKeySetup] = useState(() => !localStorage.getItem(STORAGE_KEY_API));
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Salvar histórico do chat
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(messages.slice(-50)));
  }, [messages]);

  const saveKey = () => {
    const k = apiKeyInput.trim();
    if (!k.startsWith('gsk_')) return;
    localStorage.setItem(STORAGE_KEY_API, k);
    setApiKey(k);
    setShowKeySetup(false);
    setApiKeyInput('');
  };

  const removeKey = () => {
    localStorage.removeItem(STORAGE_KEY_API);
    setApiKey('');
    setShowKeySetup(true);
  };

  const clearChat = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY_CHAT);
  };

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || !apiKey || loading) return;
    setInput('');

    const userMsg: Message = { role: 'user', content: msg };
    const history = [...messages.filter((m) => m.role !== 'error'), userMsg];
    setMessages(history);
    setLoading(true);

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: financialContext },
            ...history.map((m) => ({ role: m.role === 'error' ? 'user' : m.role, content: m.content })),
          ],
          max_tokens: 800,
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message ?? `Erro ${res.status}`);
      }

      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content ?? 'Sem resposta.';
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      setMessages((prev) => [...prev, { role: 'error', content: `⚠️ ${errMsg}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (showKeySetup) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 24, padding: '0 4px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#f0f0f0' }}>Assistente Financeiro IA</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#6b7280', maxWidth: 380 }}>
            Use a IA <strong style={{ color: '#4ade80' }}>100% grátis</strong> para analisar seus gastos e receber dicas personalizadas.
          </p>
        </div>

        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 16, padding: 20, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
              Chave da API Groq (grátis)
            </label>
            <input
              autoFocus
              type="password"
              placeholder="gsk_..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              style={{ width: '100%', background: '#111', border: '1px solid #2d2d2d', borderRadius: 8, color: '#e0e0e0', padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ background: '#0f1f0f', border: '1px solid #1a3a1a', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#4ade80', marginBottom: 8 }}>📋 Como pegar a chave (1 minuto):</div>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#9ca3af', lineHeight: 1.8 }}>
              <li>Acesse <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>console.groq.com/keys</a></li>
              <li>Crie conta com Google (1 clique)</li>
              <li>Clique em <strong style={{ color: '#e0e0e0' }}>"Create API Key"</strong></li>
              <li>Copie a chave (começa com <code style={{ color: '#f59e0b', background: '#1a1a0a', padding: '1px 4px', borderRadius: 3 }}>gsk_</code>) e cole aqui</li>
            </ol>
            <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>
              ✅ Grátis · Sem cartão · Rápido · Modelo: Llama 3.3 70B
            </div>
          </div>

          <button
            onClick={saveKey}
            disabled={!apiKeyInput.startsWith('gsk_')}
            style={{ background: apiKeyInput.startsWith('gsk_') ? '#3b82f6' : '#1a2a3a', border: 'none', borderRadius: 8, color: apiKeyInput.startsWith('gsk_') ? '#fff' : '#4b6a8a', cursor: apiKeyInput.startsWith('gsk_') ? 'pointer' : 'not-allowed', padding: '10px', fontSize: 14, fontWeight: 600 }}
          >
            Salvar e começar ✨
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)', minHeight: 400, gap: 0 }}>
      {/* Header com info */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>🤖</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0e0' }}>Assistente Financeiro</div>
            <div style={{ fontSize: 10, color: '#555' }}>Groq · Grátis · Dados do mês atual</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              style={{ background: 'transparent', border: '1px solid #2d2d2d', borderRadius: 7, color: '#555', cursor: 'pointer', fontSize: 11, padding: '4px 8px' }}
              title="Limpar conversa"
            >
              🗑
            </button>
          )}
          <button
            onClick={removeKey}
            style={{ background: 'transparent', border: '1px solid #2d2d2d', borderRadius: 7, color: '#555', cursor: 'pointer', fontSize: 11, padding: '4px 8px' }}
            title="Trocar chave"
          >
            🔑
          </button>
        </div>
      </div>

      {/* Área de mensagens */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 16 }}>
            <div style={{ textAlign: 'center', color: '#444', fontSize: 13 }}>
              Olá! Pergunte sobre seus gastos, peça dicas ou análises. 👋
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  style={{
                    background: '#141414',
                    border: '1px solid #2a2a2a',
                    borderRadius: 18,
                    color: '#9ca3af',
                    cursor: 'pointer',
                    padding: '7px 12px',
                    fontSize: 12,
                    transition: 'all 0.15s',
                    textAlign: 'left',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              alignItems: 'flex-end',
              gap: 6,
            }}
          >
            {m.role !== 'user' && (
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: m.role === 'error' ? '#2d1a1a' : '#1a2a3a', border: `1px solid ${m.role === 'error' ? '#ef444433' : '#3b82f633'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0, marginBottom: 2 }}>
                {m.role === 'error' ? '⚠' : '🤖'}
              </div>
            )}
            <div
              style={{
                maxWidth: '85%',
                background: m.role === 'user' ? '#2563eb' : m.role === 'error' ? '#2d1a1a' : '#1e1e1e',
                border: `1px solid ${m.role === 'user' ? '#3b82f6' : m.role === 'error' ? '#ef444433' : '#2a2a2a'}`,
                borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                padding: '9px 13px',
                fontSize: 13,
                color: m.role === 'error' ? '#ef4444' : '#e0e0e0',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1a2a3a', border: '1px solid #3b82f633', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>🤖</div>
            <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: '16px 16px 16px 4px', padding: '10px 14px' }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {[0, 1, 2].map((d) => (
                  <div
                    key={d}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#3b82f6',
                      animation: `bounce 1.2s ${d * 0.2}s infinite ease-in-out`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Sugestões rápidas */}
      {messages.length > 0 && !loading && (
        <div style={{ display: 'flex', gap: 5, overflowX: 'auto', padding: '6px 0', borderTop: '1px solid #1a1a1a' }}>
          {SUGGESTIONS.slice(0, 3).map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                background: '#141414',
                border: '1px solid #222',
                borderRadius: 16,
                color: '#6b7280',
                cursor: 'pointer',
                padding: '4px 10px',
                fontSize: 11,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingTop: 8, borderTop: '1px solid #1a1a1a' }}>
        <textarea
          ref={inputRef}
          placeholder="Pergunte sobre seus gastos..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          style={{
            flex: 1,
            background: '#141414',
            border: '1px solid #2d2d2d',
            borderRadius: 12,
            color: '#e0e0e0',
            padding: '9px 12px',
            fontSize: 14,
            outline: 'none',
            fontFamily: 'inherit',
            resize: 'none',
            lineHeight: 1.5,
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = '#3b82f644'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = '#2d2d2d'; }}
        />
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || loading}
          style={{
            background: input.trim() && !loading ? '#3b82f6' : '#1a2a3a',
            border: 'none',
            borderRadius: 12,
            color: input.trim() && !loading ? '#fff' : '#4b6a8a',
            cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
            padding: '9px 16px',
            fontSize: 18,
            transition: 'all 0.15s',
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          ➤
        </button>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
