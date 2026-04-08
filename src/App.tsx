import { useState, useEffect } from 'react';
import { useDashboard } from './store/useDashboard';
import { SummaryCard } from './components/SummaryCard';
import { BillRow } from './components/BillRow';
import { InlineAddRow } from './components/InlineAddRow';
import { CreditCardView } from './components/CreditCardView';
import { ChatView } from './components/ChatView';
import { CategoryChart } from './components/CategoryChart';
import { type Bill, formatCurrency, parseBRL, formatMonthShort, BILL_CATEGORY_LABELS } from './types';

type Tab = 'dashboard' | 'cartao' | 'chat';
type AddSection = 'fixed' | 'variable' | null;

// Persistir seções colapsadas/expandidas no localStorage
const SECTIONS_KEY = 'financa_sections_v1';

function loadSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveSections(sections: Record<string, boolean>) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
}

// Detectar se o teclado virtual está aberto no mobile
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => {
      setOpen(vv.height < window.innerHeight * 0.75);
    };
    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', check);
    return () => {
      vv.removeEventListener('resize', check);
      vv.removeEventListener('scroll', check);
    };
  }, []);
  return open;
}

function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ background: '#222', borderRadius: 4, height: 5, width: '100%', overflow: 'hidden' }}>
      <div
        style={{
          height: '100%',
          width: `${pct}%`,
          background: color || (pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981'),
          borderRadius: 4,
          transition: 'width 0.4s ease',
        }}
      />
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  totalAmount,
  isOpen,
  onToggle,
  rightAction,
  children,
}: {
  title: string;
  count?: number;
  totalAmount?: number;
  isOpen: boolean;
  onToggle: () => void;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ background: '#141414', border: '1px solid #1e1e1e', borderRadius: 14, padding: '14px 18px', transition: 'all 0.2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isOpen ? 10 : 0 }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}
          onClick={onToggle}
        >
          <span style={{ fontSize: 14, color: '#555', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', lineHeight: 1 }}>⌄</span>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {title}
          </h3>
          {count !== undefined && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#555', background: '#1e1e1e', border: '1px solid #2d2d2d', borderRadius: 20, padding: '1px 8px' }}>
              {count}
            </span>
          )}
          {totalAmount !== undefined && !isOpen && (
            <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginLeft: 'auto', paddingRight: 8 }}>
              {formatCurrency(totalAmount)}
            </span>
          )}
        </div>
        {isOpen && rightAction}
      </div>
      {isOpen && children}
    </section>
  );
}

function EmptyState({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  return (
    <div style={{ background: '#111', border: '1px dashed #2a2a2a', borderRadius: 12, padding: '22px 20px', textAlign: 'center', color: '#444', fontSize: 13 }}>
      <div>{label}</div>
      {action && onAction && (
        <button
          onClick={onAction}
          style={{ marginTop: 10, background: '#1a2a3a', border: '1px solid #3b82f633', borderRadius: 8, color: '#60a5fa', cursor: 'pointer', padding: '8px 16px', fontSize: 13, fontWeight: 600 }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

export default function App() {
  const db = useDashboard();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [addSection, setAddSection] = useState<AddSection>(null);
  const [incomeEditing, setIncomeEditing] = useState(false);
  const [incomeInput, setIncomeInput] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const keyboardOpen = useKeyboardOpen();

  // Meta de economia
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalInput, setGoalInput] = useState('');

  // Seções colapsáveis com memória
  const [sections, setSections] = useState<Record<string, boolean>>(loadSections);
  const isSectionOpen = (key: string, defaultOpen = true) => sections[key] ?? defaultOpen;
  const toggleSection = (key: string) => {
    setSections((prev) => {
      const next = { ...prev, [key]: !(prev[key] ?? true) };
      saveSections(next);
      return next;
    });
  };

  const paidCount = db.selectedMonth.bills.filter((b) => b.isPaid).length;
  const totalCount = db.selectedMonth.bills.length;
  const progressPct = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;

  // Totais por seção
  const fixedTotal = db.fixedBills.reduce((s, b) => s + b.amount, 0);
  const fixedPaidTotal = db.fixedBills.filter((b) => b.isPaid).reduce((s, b) => s + b.amount, 0);
  const pendingAmount = db.totalPlanned - db.totalPaid;

  // Meta de economia
  const savingsGoal = db.selectedMonth.savingsGoal || 0;
  const savingsActual = db.remaining > 0 ? db.remaining : 0;
  const savingsPct = savingsGoal > 0 ? Math.min(Math.round((savingsActual / savingsGoal) * 100), 100) : 0;

  const financialContext = `Você é um assistente financeiro pessoal inteligente e simpático. Responda sempre em português do Brasil, de forma objetiva e prática. Use emojis quando fizer sentido.

📅 Mês atual: ${db.selectedMonth.name} ${db.selectedMonth.year}
💵 Renda mensal: ${formatCurrency(db.selectedMonth.income)}
📋 Total previsto em contas: ${formatCurrency(db.totalPlanned)}
✅ Total já pago: ${formatCurrency(db.totalPaid)}
⏳ Total pendente: ${formatCurrency(db.totalPlanned - db.totalPaid)}
📈 Saldo que sobra (entrada - previsto): ${formatCurrency(db.remaining)}
🔢 Contas pagas: ${paidCount} de ${totalCount}
🎯 Meta de economia: ${savingsGoal > 0 ? formatCurrency(savingsGoal) : 'Não definida'}

📝 Contas do mês:
${db.billsSorted.map((b) => `• ${b.name} (${BILL_CATEGORY_LABELS[b.category]}) — ${formatCurrency(b.amount)} — Dia ${b.dueDay}${b.installmentCurrent ? ` — Parcela ${b.installmentCurrent}/${b.installmentTotal}` : ''} — ${b.isPaid ? '✅ Pago' : '⏳ Pendente'}`).join('\n')}

Com base nesses dados reais, ajude o usuário quando ele perguntar sobre seus gastos, dívidas, planejamento financeiro ou como economizar.`;

  const toggleAdd = (section: AddSection) =>
    setAddSection((prev) => (prev === section ? null : section));

  const handleAddBill = (bill: Bill) => {
    db.addBill(bill);
    setAddSection(null);
  };

  // Verifica se o mês atual está vazio (para sugerir copiar do anterior)
  const hasFixedBills = db.fixedBills.length > 0;

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', color: '#e0e0e0', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      {/* Top bar */}
      <header style={{ borderBottom: '1px solid #1a1a1a', padding: '0 16px', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'sticky', top: 0, background: '#0d0d0d', zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 17 }}>💸</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#f0f0f0', letterSpacing: '-0.01em' }}>Finança</span>
          <span style={{ fontSize: 10, color: '#3b82f6', background: '#1e3a5f', border: '1px solid #2563eb33', borderRadius: 5, padding: '1px 6px', fontWeight: 600 }}>PESSOAL</span>
        </div>
      </header>

      {/* Bottom tab bar — esconde quando teclado abre */}
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 64,
        background: '#111',
        borderTop: '1px solid #1e1e1e',
        display: keyboardOpen ? 'none' : 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 100,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {([
          { key: 'dashboard' as Tab, icon: '📊', label: 'Dashboard' },
          { key: 'cartao' as Tab, icon: '💳', label: 'Cartão' },
          { key: 'chat' as Tab, icon: '🤖', label: 'IA' },
        ]).map(({ key, icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: '6px 16px',
              minWidth: 70,
              transition: 'all 0.15s',
            }}
          >
            <span style={{ fontSize: 22, filter: tab === key ? 'none' : 'grayscale(0.6)', opacity: tab === key ? 1 : 0.5 }}>{icon}</span>
            <span style={{ fontSize: 10, fontWeight: tab === key ? 700 : 400, color: tab === key ? '#e0e0e0' : '#555', letterSpacing: '0.02em' }}>{label}</span>
            {tab === key && <div style={{ width: 20, height: 2, borderRadius: 1, background: '#3b82f6', marginTop: 1 }} />}
          </button>
        ))}
      </nav>

      {/* Main */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px 90px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Month selector com ano + botão adicionar mês */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, alignItems: 'center' }}>
          {db.months.map((m) => (
            <button
              key={m.id}
              onClick={() => db.selectMonth(m.id)}
              style={{
                background: db.selectedMonthId === m.id ? '#3b82f6' : '#161616',
                border: `1px solid ${db.selectedMonthId === m.id ? '#3b82f6' : '#2a2a2a'}`,
                borderRadius: 8,
                color: db.selectedMonthId === m.id ? '#fff' : '#6b7280',
                cursor: 'pointer',
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              {formatMonthShort(m.name, m.year)}
            </button>
          ))}
          <button
            onClick={db.addNextMonth}
            style={{
              background: 'transparent',
              border: '1px dashed #2a2a2a',
              borderRadius: 8,
              color: '#555',
              cursor: 'pointer',
              padding: '6px 12px',
              fontSize: 16,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
            title="Adicionar próximo mês"
          >
            +
          </button>
        </div>

        {/* ===================== DASHBOARD TAB ===================== */}
        {tab === 'dashboard' && (
          <>
            {/* Barra de progresso */}
            <div style={{ background: '#141414', border: '1px solid #1e1e1e', borderRadius: 14, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#6b7280' }}>
                  Contas pagas: <strong style={{ color: '#e0e0e0' }}>{paidCount}</strong> de <strong style={{ color: '#e0e0e0' }}>{totalCount}</strong>
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: progressPct === 100 ? '#10b981' : '#9ca3af' }}>{progressPct}%</span>
              </div>
              <ProgressBar value={paidCount} max={totalCount} />
            </div>

            {/* Cards resumo */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 11 }}>
              {/* Entrada (editável) */}
              {incomeEditing ? (
                <div style={{ background: '#1a1a1a', border: '1px solid #3b82f6', borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Entrada mensal</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      autoFocus
                      inputMode="decimal"
                      pattern="[0-9.,]*"
                      value={incomeInput}
                      onChange={(e) => setIncomeInput(e.target.value.replace(/[^0-9.,]/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { db.updateIncome(parseBRL(incomeInput)); setIncomeEditing(false); }
                        if (e.key === 'Escape') setIncomeEditing(false);
                      }}
                      style={{ background: '#111', border: '1px solid #333', borderRadius: 7, color: '#e0e0e0', padding: '6px 10px', fontSize: 16, fontWeight: 700, width: '100%', outline: 'none', fontFamily: 'inherit' }}
                    />
                    <button onClick={() => { db.updateIncome(parseBRL(incomeInput)); setIncomeEditing(false); }} style={{ background: '#10b981', border: 'none', borderRadius: 7, color: '#fff', cursor: 'pointer', padding: '6px 12px', fontSize: 13, fontWeight: 600 }}>✓</button>
                  </div>
                </div>
              ) : (
                <div onClick={() => { setIncomeInput(db.selectedMonth.income.toString()); setIncomeEditing(true); }} style={{ cursor: 'pointer' }}>
                  <SummaryCard title="Entrada mensal" value={formatCurrency(db.selectedMonth.income)} icon="💵" accent="green" subtitle="Clique para editar" />
                </div>
              )}

              <SummaryCard title="Contas a pagar" value={formatCurrency(pendingAmount)} icon="🔴" accent="red" subtitle={`${totalCount - paidCount} pendente${totalCount - paidCount !== 1 ? 's' : ''} de ${totalCount}`} valueColor="#ef4444" />
              <SummaryCard title="Total pago" value={formatCurrency(db.totalPaid)} icon="✅" accent="green" subtitle={`${paidCount} de ${totalCount} pagas`} valueColor="#10b981" />
              <SummaryCard
                title={db.remaining >= 0 ? 'Sobra prevista' : 'Déficit previsto'}
                value={formatCurrency(Math.abs(db.remaining))}
                icon={db.remaining >= 0 ? '📈' : '📉'}
                accent={db.remaining >= 0 ? 'yellow' : 'red'}
                subtitle="Entrada − contas a pagar"
              />
            </div>

            {/* Meta de economia — colapsável */}
            <CollapsibleSection
              title="🎯 Meta de economia"
              isOpen={isSectionOpen('savings', false)}
              onToggle={() => toggleSection('savings')}
            >
              {savingsGoal > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Meta mensal</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#f0f0f0', marginTop: 4 }}>{formatCurrency(savingsGoal)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Previsto sobrar</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: savingsActual >= savingsGoal ? '#10b981' : '#f59e0b', marginTop: 4 }}>{formatCurrency(savingsActual)}</div>
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#555' }}>{savingsPct}% da meta</span>
                      <span style={{ fontSize: 11, color: savingsActual >= savingsGoal ? '#10b981' : '#555' }}>
                        {savingsActual >= savingsGoal ? '✅ Meta atingida!' : `Faltam ${formatCurrency(savingsGoal - savingsActual)}`}
                      </span>
                    </div>
                    <ProgressBar value={savingsActual} max={savingsGoal} color={savingsActual >= savingsGoal ? '#10b981' : '#3b82f6'} />
                  </div>
                  <button
                    onClick={() => { setGoalInput(savingsGoal.toString()); setGoalEditing(true); }}
                    style={{ background: 'transparent', border: '1px solid #2d2d2d', borderRadius: 7, color: '#555', cursor: 'pointer', fontSize: 11, padding: '5px 12px', alignSelf: 'flex-start' }}
                  >
                    ✏️ Alterar meta
                  </button>
                </div>
              ) : goalEditing ? null : (
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                  <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>Defina quanto você quer economizar por mês</div>
                  <button
                    onClick={() => { setGoalInput(''); setGoalEditing(true); }}
                    style={{ background: '#1a2a3a', border: '1px solid #3b82f633', borderRadius: 8, color: '#60a5fa', cursor: 'pointer', padding: '8px 20px', fontSize: 13, fontWeight: 600 }}
                  >
                    🎯 Definir meta
                  </button>
                </div>
              )}
              {goalEditing && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: savingsGoal > 0 ? 8 : 0 }}>
                  <input
                    autoFocus
                    inputMode="decimal"
                    pattern="[0-9.,]*"
                    placeholder="Ex: 500,00"
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value.replace(/[^0-9.,]/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { db.updateSavingsGoal(parseBRL(goalInput)); setGoalEditing(false); }
                      if (e.key === 'Escape') setGoalEditing(false);
                    }}
                    style={{ background: '#111', border: '1px solid #333', borderRadius: 7, color: '#e0e0e0', padding: '8px 12px', fontSize: 14, fontWeight: 700, flex: 1, outline: 'none', fontFamily: 'inherit' }}
                  />
                  <button onClick={() => { db.updateSavingsGoal(parseBRL(goalInput)); setGoalEditing(false); }} style={{ background: '#10b981', border: 'none', borderRadius: 7, color: '#fff', cursor: 'pointer', padding: '8px 14px', fontSize: 13, fontWeight: 600 }}>✓</button>
                  <button onClick={() => setGoalEditing(false)} style={{ background: 'transparent', border: '1px solid #333', borderRadius: 7, color: '#6b7280', cursor: 'pointer', padding: '8px 12px', fontSize: 13 }}>✕</button>
                </div>
              )}
            </CollapsibleSection>

            {/* Contas mensais/fixas — colapsável */}
            <CollapsibleSection
              title="Contas mensais e fixas"
              count={db.fixedBills.length}
              totalAmount={fixedTotal}
              isOpen={isSectionOpen('fixed')}
              onToggle={() => toggleSection('fixed')}
              rightAction={
                <button
                  onClick={() => toggleAdd('fixed')}
                  style={{
                    background: addSection === 'fixed' ? '#1a2a3a' : 'transparent',
                    border: `1px solid ${addSection === 'fixed' ? '#3b82f633' : '#2d2d2d'}`,
                    borderRadius: 7,
                    color: addSection === 'fixed' ? '#60a5fa' : '#6b7280',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: '3px 10px',
                    transition: 'all 0.15s',
                  }}
                >
                  {addSection === 'fixed' ? '− Cancelar' : '+ Adicionar'}
                </button>
              }
            >
              {/* Resumo de valor da seção */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1, background: '#111', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>Total mensal</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#ef4444' }}>{formatCurrency(fixedTotal)}</span>
                </div>
                <div style={{ flex: 1, background: '#111', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>Pago</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#10b981' }}>{formatCurrency(fixedPaidTotal)}</span>
                </div>
              </div>

              {!hasFixedBills && addSection !== 'fixed' && (
                <EmptyState
                  label="Nenhuma conta mensal ou fixa ainda."
                  action="📋 Copiar contas do mês anterior"
                  onAction={db.copyFixedBillsFromPrevious}
                />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {db.fixedBills.map((bill) => (
                  <BillRow key={bill.id} bill={bill} onTogglePaid={() => db.togglePaid(bill.id)} onSave={db.saveBill} onDelete={() => db.deleteBill(bill.id)} />
                ))}
                {addSection === 'fixed' && (
                  <InlineAddRow monthName={db.selectedMonth.name} onSave={handleAddBill} onCancel={() => setAddSection(null)} defaultType="mensal" />
                )}
              </div>

              {/* Botão copiar contas (quando já tem contas) */}
              {hasFixedBills && (
                <button
                  onClick={() => {
                    if (confirm('Copiar contas fixas do mês anterior? As contas existentes serão mantidas.')) {
                      db.copyFixedBillsFromPrevious();
                    }
                  }}
                  style={{ marginTop: 10, background: 'transparent', border: '1px dashed #2a2a2a', borderRadius: 8, color: '#555', cursor: 'pointer', padding: '6px 12px', fontSize: 11, width: '100%' }}
                >
                  📋 Copiar contas fixas do mês anterior
                </button>
              )}
            </CollapsibleSection>

            {/* Resumo do Cartão de Crédito */}
            <section>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Cartão de Crédito
                </h3>
                <button
                  onClick={() => setTab('cartao')}
                  style={{ background: 'transparent', border: '1px solid #2d2d2d', borderRadius: 7, color: '#6b7280', cursor: 'pointer', fontSize: 12, padding: '3px 10px' }}
                >
                  Ver detalhes →
                </button>
              </div>
              {db.creditCardBills.length === 0 ? (
                <div
                  onClick={() => setTab('cartao')}
                  style={{ background: '#141414', border: '1px dashed #2a2a2a', borderRadius: 12, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                >
                  <span style={{ fontSize: 13, color: '#444' }}>Nenhuma parcela de cartão em {db.selectedMonth.name}</span>
                  <span style={{ fontSize: 12, color: '#555' }}>+ Lançar compra →</span>
                </div>
              ) : (
                <div
                  onClick={() => setTab('cartao')}
                  style={{
                    background: '#141414',
                    border: '1px solid #222',
                    borderRadius: 12,
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#333')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#222')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ fontSize: 22 }}>💳</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>
                        {db.creditCardBills.length} parcela{db.creditCardBills.length > 1 ? 's' : ''} em {db.selectedMonth.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                        {db.creditCardBills.filter((b) => b.isPaid).length} de {db.creditCardBills.length} pagas
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444', letterSpacing: '-0.02em' }}>
                      {formatCurrency(db.creditCardBills.reduce((s, b) => s + b.amount, 0))}
                    </div>
                    <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Ver detalhes →</div>
                  </div>
                </div>
              )}
            </section>

            {/* Variáveis — colapsável */}
            {(db.variableBills.length > 0 || addSection === 'variable') && (
              <CollapsibleSection
                title="Variáveis / Reservas"
                count={db.variableBills.length}
                totalAmount={db.variableBills.reduce((s, b) => s + b.amount, 0)}
                isOpen={isSectionOpen('variable')}
                onToggle={() => toggleSection('variable')}
                rightAction={
                  <button
                    onClick={() => toggleAdd('variable')}
                    style={{
                      background: addSection === 'variable' ? '#1a2a3a' : 'transparent',
                      border: `1px solid ${addSection === 'variable' ? '#3b82f633' : '#2d2d2d'}`,
                      borderRadius: 7,
                      color: addSection === 'variable' ? '#60a5fa' : '#6b7280',
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: '3px 10px',
                      transition: 'all 0.15s',
                    }}
                  >
                    {addSection === 'variable' ? '− Cancelar' : '+ Adicionar'}
                  </button>
                }
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {db.variableBills.map((bill) => (
                    <BillRow key={bill.id} bill={bill} onTogglePaid={() => db.togglePaid(bill.id)} onSave={db.saveBill} onDelete={() => db.deleteBill(bill.id)} />
                  ))}
                  {addSection === 'variable' && (
                    <InlineAddRow monthName={db.selectedMonth.name} onSave={handleAddBill} onCancel={() => setAddSection(null)} defaultType="variavel" />
                  )}
                </div>
              </CollapsibleSection>
            )}

            {/* Gráfico de gastos por categoria — colapsável */}
            {db.billsSorted.length > 0 && (
              <CollapsibleSection
                title="📊 Gastos por categoria"
                isOpen={isSectionOpen('chart', false)}
                onToggle={() => toggleSection('chart')}
              >
                <CategoryChart bills={db.selectedMonth.bills} />
              </CollapsibleSection>
            )}

            {/* Backup / Restaurar — colapsável */}
            <CollapsibleSection
              title="📦 Backup dos dados"
              isOpen={isSectionOpen('backup', false)}
              onToggle={() => toggleSection('backup')}
            >
              {importMsg && (
                <div style={{
                  background: importMsg.includes('✅') ? '#0f1f0f' : '#2d1a1a',
                  border: `1px solid ${importMsg.includes('✅') ? '#1a3a1a' : '#ef444433'}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                  color: importMsg.includes('✅') ? '#4ade80' : '#ef4444',
                  marginBottom: 10,
                }}>
                  {importMsg}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={db.exportData}
                  style={{
                    flex: 1,
                    minWidth: 130,
                    background: '#1a2a3a',
                    border: '1px solid #2563eb33',
                    borderRadius: 8,
                    color: '#60a5fa',
                    cursor: 'pointer',
                    padding: '10px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  📤 Exportar backup
                </button>

                <label
                  style={{
                    flex: 1,
                    minWidth: 130,
                    background: '#1a1f2a',
                    border: '1px solid #2d2d2d',
                    borderRadius: 8,
                    color: '#9ca3af',
                    cursor: 'pointer',
                    padding: '10px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    textAlign: 'center',
                  }}
                >
                  📥 Importar backup
                  <input
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const ok = await db.importData(file);
                      setImportMsg(ok ? '✅ Dados restaurados com sucesso!' : '❌ Arquivo inválido. Use um backup exportado pelo app.');
                      setTimeout(() => setImportMsg(null), 4000);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              <p style={{ margin: '10px 0 0', fontSize: 11, color: '#444', lineHeight: 1.5 }}>
                💡 <strong>Dica:</strong> Exporte um backup antes de trocar de celular ou limpar o navegador. Assim você nunca perde seus dados!
              </p>
            </CollapsibleSection>

            {/* Footer */}
            <footer style={{ textAlign: 'center', fontSize: 12, color: '#2a2a2a', paddingTop: 10, borderTop: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <span>💾 Dados salvos automaticamente</span>
              <span style={{ color: '#1e1e1e' }}>·</span>
              <button
                onClick={() => { if (confirm('Limpar todos os dados e voltar ao exemplo?')) db.resetData(); }}
                style={{ background: 'transparent', border: 'none', color: '#2a2a2a', cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' }}
              >
                Resetar dados
              </button>
            </footer>
          </>
        )}

        {/* ===================== CHAT IA TAB ===================== */}
        {tab === 'chat' && (
          <ChatView financialContext={financialContext} />
        )}

        {/* ===================== CARTÃO DE CRÉDITO TAB ===================== */}
        {tab === 'cartao' && (
          <CreditCardView
            selectedMonthName={db.selectedMonth.name}
            selectedMonthYear={db.selectedMonth.year}
            creditCardBills={db.creditCardBills}
            allMonths={db.months}
            onTogglePaid={db.togglePaid}
            onSaveBill={db.saveBill}
            onDeleteBill={db.deleteBill}
            onAddPurchase={db.addCreditCardPurchase}
            getAffectedMonths={db.getAffectedMonths}
          />
        )}
      </div>
    </div>
  );
}
