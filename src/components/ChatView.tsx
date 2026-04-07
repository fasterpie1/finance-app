import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
}

interface Props {
  financialContext: string;
}

const SUGGESTIONS = [
  '📊 Como estou indo financeiramente este mês?',
  '💡 Onde posso economizar?',
  '⚠️ Quais contas ainda estão pendentes?',
  '📈 Como melhorar meu saldo no fim do mês?',
  '🎯 Me dê 3 dicas para organizar melhor meus gastos',
  '📉 Meus gastos estão altos? O que cortar?',
];

export const ChatView: React.FC<Props> = ({ financialContext }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openai_api_key') || '');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKeySetup, setShowKeySetup] = useState(() => !localStorage.getItem('openai_api_key'));
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const saveKey = () => {
    const k = apiKeyInput.trim();
    if (!k.startsWith('sk-')) return;
    localStorage.setItem('openai_api_key', k);
    setApiKey(k);
    setShowKeySetup(false);
    setApiKeyInput('');
  };

  const removeKey = () => {
    localStorage.removeItem('openai_api_key');
    setApiKey('');
    setShowKeySetup(true);
    setMessages([]);
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
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: financialContext },
            ...history.map((m) => ({ role: m.role, content: m.content })),
          ],
          max_tokens: 700,
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
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      setMessages((prev) => [...prev, { role: 'error', content: `⚠️ ${msg}` }]);
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 24, padding: '0 16px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#f0f0f0' }}>Assistente Financeiro IA</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#6b7280', maxWidth: 380 }}>
            Use o ChatGPT para analisar seus gastos, receber dicas personalizadas e tirar dúvidas sobre finanças — tudo com base nos seus dados reais.
          </p>
        </div>

        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 16, padding: 24, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
              Chave da API OpenAI
            </label>
            <input
              autoFocus
              type="password"
              placeholder="sk-..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              style={{ width: '100%', background: '#111', border: '1px solid #2d2d2d', borderRadius: 8, color: '#e0e0e0', padding: '10px 14px', fontSize: 14, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <p style={{ margin: 0, fontSize: 12, color: '#555' }}>
            Acesse <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}>platform.openai.com/api-keys</a> para gerar sua chave. O modelo usado é o <strong style={{ color: '#9ca3af' }}>gpt-4o-mini</strong> (muito barato — menos de $0,01 por conversa).
          </p>
          <button
            onClick={saveKey}
            disabled={!apiKeyInput.startsWith('sk-')}
            style={{ background: apiKeyInput.startsWith('sk-') ? '#3b82f6' : '#1a2a3a', border: 'none', borderRadius: 8, color: apiKeyInput.startsWith('sk-') ? '#fff' : '#4b6a8a', cursor: apiKeyInput.startsWith('sk-') ? 'pointer' : 'not-allowed', padding: '10px', fontSize: 14, fontWeight: 600 }}
          >
            Salvar e começar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', minHeight: 500, gap: 0 }}>
      {/* Header com info */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>Assistente Financeiro</div>
            <div style={{ fontSize: 11, color: '#555' }}>Com acesso aos seus dados do mês atual</div>
          </div>
        </div>
        <button
          onClick={removeKey}
          style={{ background: 'transparent', border: '1px solid #2d2d2d', borderRadius: 7, color: '#555', cursor: 'pointer', fontSize: 11, padding: '4px 10px' }}
          title="Remover chave de API"
        >
          🔑 Trocar chave
        </button>
      </div>

      {/* Área de mensagens */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 4, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingTop: 20 }}>
            <div style={{ textAlign: 'center', color: '#444', fontSize: 14 }}>
              Olá! Pergunte sobre seus gastos, peça dicas ou análises. 👋
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  style={{
                    background: '#141414',
                    border: '1px solid #2a2a2a',
                    borderRadius: 20,
                    color: '#9ca3af',
                    cursor: 'pointer',
                    padding: '8px 14px',
                    fontSize: 13,
                    transition: 'all 0.15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#3b82f644'; (e.currentTarget as HTMLButtonElement).style.color = '#e0e0e0'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a2a2a'; (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
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
              gap: 8,
            }}
          >
            {m.role !== 'user' && (
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: m.role === 'error' ? '#2d1a1a' : '#1a2a3a', border: `1px solid ${m.role === 'error' ? '#ef444433' : '#3b82f633'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginBottom: 2 }}>
                {m.role === 'error' ? '⚠' : '🤖'}
              </div>
            )}
            <div
              style={{
                maxWidth: '80%',
                background: m.role === 'user' ? '#2563eb' : m.role === 'error' ? '#2d1a1a' : '#1e1e1e',
                border: `1px solid ${m.role === 'user' ? '#3b82f6' : m.role === 'error' ? '#ef444433' : '#2a2a2a'}`,
                borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                padding: '10px 14px',
                fontSize: 14,
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
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1a2a3a', border: '1px solid #3b82f633', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🤖</div>
            <div style={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: '18px 18px 18px 4px', padding: '12px 16px' }}>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                {[0, 1, 2].map((d) => (
                  <div
                    key={d}
                    style={{
                      width: 7,
                      height: 7,
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

      {/* Sugestões rápidas (aparecem quando tem mensagens) */}
      {messages.length > 0 && !loading && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '8px 0', borderTop: '1px solid #1a1a1a' }}>
          {SUGGESTIONS.slice(0, 4).map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              style={{
                background: '#141414',
                border: '1px solid #222',
                borderRadius: 20,
                color: '#6b7280',
                cursor: 'pointer',
                padding: '5px 12px',
                fontSize: 12,
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
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', paddingTop: 10, borderTop: '1px solid #1a1a1a' }}>
        <textarea
          ref={inputRef}
          placeholder="Pergunte sobre seus gastos, peça dicas... (Enter para enviar)"
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
            padding: '10px 14px',
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
            padding: '10px 18px',
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

      {/* CSS para animação dos dots */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};
