import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
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

const SECTIONS_KEY = 'financa_sections_v1';
const PRIVACY_KEY = 'financa_privacy';
const LAYOUT_KEY = 'financa_layout_order';

type SectionId = 'savings' | 'fixed' | 'cartao_preview' | 'variable' | 'chart' | 'backup';

const DEFAULT_ORDER: SectionId[] = ['savings', 'fixed', 'cartao_preview', 'variable', 'chart', 'backup'];

function loadSections(): Record<string, boolean> {
  try { const raw = localStorage.getItem(SECTIONS_KEY); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
  return {};
}
function saveSections(sections: Record<string, boolean>) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
}
function loadPrivacy(): boolean {
  try { return localStorage.getItem(PRIVACY_KEY) === 'true'; } catch { return false; }
}
function loadLayoutOrder(): SectionId[] {
  try { const raw = localStorage.getItem(LAYOUT_KEY); if (raw) { const arr = JSON.parse(raw) as SectionId[]; if (arr.length === DEFAULT_ORDER.length) return arr; } } catch { /* ignore */ }
  return DEFAULT_ORDER;
}
function saveLayoutOrder(order: SectionId[]) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(order));
}

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(vv.height < window.innerHeight * 0.75);
    vv.addEventListener('resize', check);
    vv.addEventListener('scroll', check);
    return () => { vv.removeEventListener('resize', check); vv.removeEventListener('scroll', check); };
  }, []);
  return open;
}

/* ─── SVG Icons ─── */
const IconDashboard = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? '#e0e0e0' : '#555'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
const IconCard = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? '#e0e0e0' : '#555'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);
const IconChat = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={active ? '#e0e0e0' : '#555'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);
const IconEyeOpen = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);
const IconEyeClosed = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const IconChevron = ({ open }: { open: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
    <path d="M2 4l4 4 4-4" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ─── Grip Icon for drag handle ─── */
const GripIcon = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
    <div style={{ display: 'flex', gap: 3 }}>
      {[0, 1, 2].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: 1, background: '#444' }} />)}
    </div>
    <div style={{ display: 'flex', gap: 3 }}>
      {[0, 1, 2].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: 1, background: '#444' }} />)}
    </div>
  </div>
);

/* ─── Progress Bar ─── */
function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ background: '#1a1a1a', borderRadius: 3, height: 4, width: '100%', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color || (pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10b981'), borderRadius: 3, transition: 'width 0.4s ease' }} />
    </div>
  );
}

/* ─── Collapsible Section ─── */
function CollapsibleSection({ title, count, totalAmount, isOpen, onToggle, rightAction, children, hideValues, editMode }: {
  title: string; count?: number; totalAmount?: number; isOpen: boolean; onToggle: () => void; rightAction?: React.ReactNode; children: React.ReactNode; hideValues?: boolean; editMode?: boolean;
}) {
  return (
    <section style={{ background: '#111', border: `1px solid ${editMode ? '#2a3a4a' : '#1a1a1a'}`, borderRadius: 10, padding: '14px 16px', transition: 'border-color 0.2s', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isOpen && !editMode ? 12 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: editMode ? 'default' : 'pointer', flex: 1 }} onClick={editMode ? undefined : onToggle}>
          {!editMode && <IconChevron open={isOpen} />}
          <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</h3>
          {count !== undefined && <span style={{ fontSize: 10, fontWeight: 600, color: '#3a3a3a', background: '#151515', border: '1px solid #1e1e1e', borderRadius: 4, padding: '1px 6px' }}>{count}</span>}
          {totalAmount !== undefined && !isOpen && !editMode && <span style={{ fontSize: 12, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#ef4444', marginLeft: 'auto', paddingRight: 8, transition: 'color 0.2s' }}>{hideValues ? 'R$ ••••' : formatCurrency(totalAmount)}</span>}
        </div>
        {isOpen && !editMode && rightAction}
      </div>
      {isOpen && !editMode && children}
    </section>
  );
}

function EmptyState({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  return (
    <div style={{ background: '#0e0e0e', border: '1px dashed #1e1e1e', borderRadius: 8, padding: 20, textAlign: 'center', color: '#333', fontSize: 12 }}>
      <div>{label}</div>
      {action && onAction && <button onClick={onAction} style={{ marginTop: 10, background: '#111520', border: '1px solid #1e2a3e', borderRadius: 6, color: '#60a5fa', cursor: 'pointer', padding: '7px 14px', fontSize: 12, fontWeight: 600 }}>{action}</button>}
    </div>
  );
}

/* ─── Main App ─── */
export default function App() {
  const db = useDashboard();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [addSection, setAddSection] = useState<AddSection>(null);
  const [incomeEditing, setIncomeEditing] = useState(false);
  const [incomeInput, setIncomeInput] = useState('');
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const keyboardOpen = useKeyboardOpen();

  const [goalEditing, setGoalEditing] = useState(false);
  const [goalInput, setGoalInput] = useState('');

  const [hideValues, setHideValues] = useState(loadPrivacy);
  const togglePrivacy = () => {
    setHideValues((prev) => {
      const next = !prev;
      localStorage.setItem(PRIVACY_KEY, String(next));
      return next;
    });
  };

  const [sections, setSections] = useState<Record<string, boolean>>(loadSections);
  const isSectionOpen = (key: string, defaultOpen = true) => sections[key] ?? defaultOpen;
  const toggleSection = (key: string) => {
    setSections((prev) => { const next = { ...prev, [key]: !(prev[key] ?? true) }; saveSections(next); return next; });
  };

  // Layout order
  const [layoutOrder, setLayoutOrder] = useState<SectionId[]>(loadLayoutOrder);
  const [editMode, setEditMode] = useState(false);

  // ─── DRAG TO REORDER STATE ───
  const [dragId, setDragId] = useState<SectionId | null>(null);
  const [dragDelta, setDragDelta] = useState(0);
  const dragMeta = useRef({ startY: 0, heights: {} as Record<string, number> });
  const layoutOrderRef = useRef(layoutOrder);
  layoutOrderRef.current = layoutOrder;
  const flipRef = useRef<{ id: SectionId; delta: number } | null>(null);
  const prevOrderStr = useRef(layoutOrder.join(','));
  const GAP = 20; // matches the flex container gap

  // Start drag from grip handle
  const onDragStart = useCallback((id: SectionId, clientY: number) => {
    const heights: Record<string, number> = {};
    layoutOrderRef.current.forEach(sId => {
      const el = document.getElementById(`sw-${sId}`);
      if (el) heights[sId] = el.offsetHeight;
    });
    dragMeta.current = { startY: clientY, heights };
    setDragId(id);
    setDragDelta(0);
  }, []);

  // Touch/mouse move and end handlers
  useEffect(() => {
    if (!dragId) return;

    const handleMove = (clientY: number) => {
      let delta = clientY - dragMeta.current.startY;
      const order = layoutOrderRef.current;
      const idx = order.indexOf(dragId);
      const { heights } = dragMeta.current;

      // Check swap DOWN
      if (delta > 0 && idx < order.length - 1) {
        const nextId = order[idx + 1];
        const nextH = heights[nextId] || 0;
        if (nextH > 0 && delta > (nextH + GAP) * 0.45) {
          // Prepare FLIP for the displaced item
          const draggedH = heights[dragId] || 0;
          flipRef.current = { id: nextId, delta: draggedH + GAP };

          const newOrder = [...order];
          [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
          layoutOrderRef.current = newOrder;
          setLayoutOrder(newOrder);
          saveLayoutOrder(newOrder);
          const shift = nextH + GAP;
          dragMeta.current.startY += shift;
          delta -= shift;
        }
      }

      // Check swap UP
      if (delta < 0 && idx > 0) {
        const prevId = order[idx - 1];
        const prevH = heights[prevId] || 0;
        if (prevH > 0 && -delta > (prevH + GAP) * 0.45) {
          // Prepare FLIP for the displaced item
          const draggedH = heights[dragId] || 0;
          flipRef.current = { id: prevId, delta: -(draggedH + GAP) };

          const newOrder = [...order];
          [newOrder[idx], newOrder[idx - 1]] = [newOrder[idx - 1], newOrder[idx]];
          layoutOrderRef.current = newOrder;
          setLayoutOrder(newOrder);
          saveLayoutOrder(newOrder);
          const shift = prevH + GAP;
          dragMeta.current.startY -= shift;
          delta += shift;
        }
      }

      setDragDelta(delta);
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      handleMove(e.touches[0].clientY);
    };
    const onMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      handleMove(e.clientY);
    };
    const onEnd = () => {
      // Clean up any lingering inline styles from FLIP
      layoutOrderRef.current.forEach(id => {
        const el = document.getElementById(`sw-${id}`);
        if (el) {
          el.style.transition = '';
          el.style.transform = '';
        }
      });
      setDragId(null);
      setDragDelta(0);
    };

    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onEnd);

    return () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onEnd);
    };
  }, [dragId, GAP]);

  // FLIP animation: smooth slide for the displaced item after a swap
  useLayoutEffect(() => {
    const orderStr = layoutOrder.join(',');
    const orderChanged = orderStr !== prevOrderStr.current;
    prevOrderStr.current = orderStr;

    if (orderChanged && flipRef.current && dragId) {
      const { id, delta } = flipRef.current;
      flipRef.current = null;

      const el = document.getElementById(`sw-${id}`);
      if (el) {
        // Invert: place item at its old visual position
        el.style.transition = 'none';
        el.style.transform = `translateY(${delta}px)`;

        // Play: animate to new position
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)';
            el.style.transform = 'translateY(0)';
          });
        });
      }
    }
  }, [layoutOrder, dragId]);

  const paidCount = db.selectedMonth.bills.filter((b) => b.isPaid).length;
  const totalCount = db.selectedMonth.bills.length;
  const progressPct = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;
  const fixedTotal = db.fixedBills.reduce((s, b) => s + b.amount, 0);
  const fixedPaidTotal = db.fixedBills.filter((b) => b.isPaid).reduce((s, b) => s + b.amount, 0);
  const pendingAmount = db.totalPlanned - db.totalPaid;
  const savingsGoal = db.selectedMonth.savingsGoal || 0;
  const savingsActual = db.remaining > 0 ? db.remaining : 0;
  const savingsPct = savingsGoal > 0 ? Math.min(Math.round((savingsActual / savingsGoal) * 100), 100) : 0;

  const financialContext = `Você é um assistente financeiro pessoal inteligente e simpático. Responda sempre em português do Brasil, de forma objetiva e prática.

Mês atual: ${db.selectedMonth.name} ${db.selectedMonth.year}
Renda mensal: ${formatCurrency(db.selectedMonth.income)}
Total previsto em contas: ${formatCurrency(db.totalPlanned)}
Total já pago: ${formatCurrency(db.totalPaid)}
Total pendente: ${formatCurrency(db.totalPlanned - db.totalPaid)}
Saldo que sobra: ${formatCurrency(db.remaining)}
Contas pagas: ${paidCount} de ${totalCount}
Meta de economia: ${savingsGoal > 0 ? formatCurrency(savingsGoal) : 'Não definida'}

Contas do mês:
${db.billsSorted.map((b) => `- ${b.name} (${BILL_CATEGORY_LABELS[b.category]}) — ${formatCurrency(b.amount)} — Dia ${b.dueDay}${b.installmentCurrent ? ` — Parcela ${b.installmentCurrent}/${b.installmentTotal}` : ''} — ${b.isPaid ? 'Pago' : 'Pendente'}`).join('\n')}

Com base nesses dados reais, ajude o usuário quando ele perguntar sobre seus gastos, dívidas, planejamento financeiro ou como economizar.`;

  const toggleAdd = (section: AddSection) => setAddSection((prev) => (prev === section ? null : section));
  const handleAddBill = (bill: Bill) => { db.addBill(bill); setAddSection(null); };
  const hasFixedBills = db.fixedBills.length > 0;
  const masked = 'R$ ••••';
  const linkedFixedBills = db.fixedBills.filter((b) => b.isOnCreditCard);
  const creditCardTotal = db.creditCardBills.reduce((s, b) => s + b.amount, 0) + linkedFixedBills.reduce((s, b) => s + b.amount, 0);
  const allCardPaid = db.creditCardBills.length > 0 && db.creditCardBills.every((b) => b.isPaid) && linkedFixedBills.every((b) => b.isPaid);

  /* ─── Section renderers ─── */
  const renderSection = (id: SectionId) => {
    switch (id) {
      case 'savings':
        return (
          <CollapsibleSection key="savings" title="Meta de economia" isOpen={isSectionOpen('savings', false)} onToggle={() => toggleSection('savings')} hideValues={hideValues} editMode={editMode}>
            {savingsGoal > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Meta mensal</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#d4d4d4', marginTop: 4, transition: 'color 0.2s' }}>{hideValues ? masked : formatCurrency(savingsGoal)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Previsto sobrar</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: hideValues ? '#1a1a1a' : (savingsActual >= savingsGoal ? '#10b981' : '#f59e0b'), marginTop: 4, transition: 'color 0.2s' }}>{hideValues ? masked : formatCurrency(savingsActual)}</div>
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#3a3a3a' }}>{savingsPct}% da meta</span>
                    <span style={{ fontSize: 10, color: savingsActual >= savingsGoal ? '#10b981' : '#3a3a3a' }}>{savingsActual >= savingsGoal ? 'Meta atingida' : `Faltam ${hideValues ? masked : formatCurrency(savingsGoal - savingsActual)}`}</span>
                  </div>
                  <ProgressBar value={savingsActual} max={savingsGoal} color={savingsActual >= savingsGoal ? '#10b981' : '#3b82f6'} />
                </div>
                <button onClick={() => { setGoalInput(savingsGoal.toString()); setGoalEditing(true); }} style={{ background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 6, color: '#444', cursor: 'pointer', fontSize: 10, padding: '4px 10px', alignSelf: 'flex-start' }}>Alterar meta</button>
              </div>
            ) : goalEditing ? null : (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 12, color: '#333', marginBottom: 10 }}>Defina quanto quer economizar por mês</div>
                <button onClick={() => { setGoalInput(''); setGoalEditing(true); }} style={{ background: '#111520', border: '1px solid #1e2a3e', borderRadius: 6, color: '#60a5fa', cursor: 'pointer', padding: '7px 18px', fontSize: 12, fontWeight: 600 }}>Definir meta</button>
              </div>
            )}
            {goalEditing && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: savingsGoal > 0 ? 8 : 0 }}>
                <input autoFocus inputMode="decimal" pattern="[0-9.,]*" placeholder="Ex: 500,00" value={goalInput} onChange={(e) => setGoalInput(e.target.value.replace(/[^0-9.,]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') { db.updateSavingsGoal(parseBRL(goalInput)); setGoalEditing(false); } if (e.key === 'Escape') setGoalEditing(false); }} style={{ background: '#0e0e0e', border: '1px solid #1e1e1e', borderRadius: 6, color: '#e0e0e0', padding: '8px 12px', fontSize: 14, fontWeight: 700, flex: 1, outline: 'none', fontFamily: 'inherit' }} />
                <button onClick={() => { db.updateSavingsGoal(parseBRL(goalInput)); setGoalEditing(false); }} style={{ background: '#10b981', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '8px 14px', fontSize: 12, fontWeight: 600 }}>OK</button>
                <button onClick={() => setGoalEditing(false)} style={{ background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 6, color: '#555', cursor: 'pointer', padding: '8px 12px', fontSize: 12 }}>×</button>
              </div>
            )}
          </CollapsibleSection>
        );

      case 'fixed':
        return (
          <CollapsibleSection key="fixed" title="Contas mensais e fixas" count={db.fixedBills.length} totalAmount={fixedTotal} isOpen={isSectionOpen('fixed')} onToggle={() => toggleSection('fixed')} hideValues={hideValues} editMode={editMode} rightAction={
            <button onClick={() => toggleAdd('fixed')} style={{ background: addSection === 'fixed' ? '#111520' : 'transparent', border: `1px solid ${addSection === 'fixed' ? '#1e2a3e' : '#1e1e1e'}`, borderRadius: 6, color: addSection === 'fixed' ? '#60a5fa' : '#555', cursor: 'pointer', fontSize: 11, padding: '3px 10px', transition: 'all 0.15s' }}>
              {addSection === 'fixed' ? 'Cancelar' : 'Adicionar'}
            </button>
          }>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1, background: '#0e0e0e', borderRadius: 6, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#444' }}>Total</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#ef4444', transition: 'color 0.2s' }}>{hideValues ? masked : formatCurrency(fixedTotal)}</span>
              </div>
              <div style={{ flex: 1, background: '#0e0e0e', borderRadius: 6, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: '#444' }}>Pago</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: hideValues ? '#1a1a1a' : '#10b981', transition: 'color 0.2s' }}>{hideValues ? masked : formatCurrency(fixedPaidTotal)}</span>
              </div>
            </div>
            {!hasFixedBills && addSection !== 'fixed' && <EmptyState label="Nenhuma conta fixa ainda." action="Copiar do mês anterior" onAction={db.copyFixedBillsFromPrevious} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {db.fixedBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => db.togglePaid(bill.id)} onSave={db.saveBill} onDelete={() => db.deleteBill(bill.id)} hideValues={hideValues} showCreditCardToggle />))}
              {addSection === 'fixed' && <InlineAddRow monthName={db.selectedMonth.name} onSave={handleAddBill} onCancel={() => setAddSection(null)} defaultType="mensal" />}
            </div>
            {hasFixedBills && (
              <button onClick={() => { if (confirm('Copiar contas fixas do mês anterior?')) db.copyFixedBillsFromPrevious(); }} style={{ marginTop: 10, background: 'transparent', border: '1px dashed #1e1e1e', borderRadius: 6, color: '#333', cursor: 'pointer', padding: '6px 12px', fontSize: 10, width: '100%' }}>
                Copiar contas fixas do mês anterior
              </button>
            )}
          </CollapsibleSection>
        );

      case 'cartao_preview':
        return (
          <section key="cartao_preview" style={editMode ? { background: '#111', border: '1px solid #2a3a4a', borderRadius: 10, padding: '14px 16px' } : undefined}>
            {!editMode && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cartão de crédito</h3>
                  <button onClick={() => setTab('cartao')} style={{ background: 'transparent', border: '1px solid #1e1e1e', borderRadius: 6, color: '#555', cursor: 'pointer', fontSize: 10, padding: '3px 10px' }}>Ver detalhes</button>
                </div>
                {db.creditCardBills.length === 0 && linkedFixedBills.length === 0 ? (
                  <div onClick={() => setTab('cartao')} style={{ background: '#111', border: '1px dashed #1e1e1e', borderRadius: 10, padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                    <span style={{ fontSize: 12, color: '#333' }}>Nenhuma parcela em {db.selectedMonth.name}</span>
                    <span style={{ fontSize: 11, color: '#444' }}>Lançar compra →</span>
                  </div>
                ) : (
                  <div style={{ background: '#131313', border: `1px solid ${allCardPaid ? '#10b98122' : '#1a1a1a'}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, opacity: allCardPaid ? 0.55 : 1, transition: 'all 0.15s' }}>
                    {/* Bolinha de pago — igual às contas */}
                    <button
                      onClick={(e) => { e.stopPropagation(); allCardPaid ? db.unpayCreditCard() : db.payCreditCard(); }}
                      style={{
                        width: 20, height: 20, borderRadius: '50%',
                        border: `2px solid ${allCardPaid ? '#10b981' : '#2d2d2d'}`,
                        background: allCardPaid ? '#10b981' : 'transparent',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, transition: 'all 0.15s', padding: 0,
                      }}
                    >
                      {allCardPaid && (
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>

                    {/* Color dot */}
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0, opacity: 0.8 }} />

                    {/* Info */}
                    <div onClick={() => setTab('cartao')} style={{ flex: 1, cursor: 'pointer', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: allCardPaid ? '#555' : '#d4d4d4', textDecoration: allCardPaid ? 'line-through' : 'none' }}>Fatura do mês</span>
                      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: '#444', background: '#151515', border: '1px solid #1e1e1e', borderRadius: 4, padding: '1px 6px' }}>
                          {db.creditCardBills.length} parcela{db.creditCardBills.length !== 1 ? 's' : ''}
                        </span>
                        {linkedFixedBills.length > 0 && (
                          <>
                            <span style={{ fontSize: 10, color: '#2a2a2a' }}>·</span>
                            <span style={{ fontSize: 10, color: '#60a5fa', background: '#111520', border: '1px solid #1e2a3e', borderRadius: 4, padding: '1px 6px' }}>
                              {linkedFixedBills.length} fixa{linkedFixedBills.length !== 1 ? 's' : ''}
                            </span>
                          </>
                        )}
                        <span style={{ fontSize: 10, color: '#2a2a2a' }}>·</span>
                        <span style={{ fontSize: 10, color: '#444' }}>Detalhes →</span>
                      </div>
                    </div>

                    {/* Valor */}
                    <span style={{ fontSize: 14, fontWeight: 700, color: hideValues ? '#1a1a1a' : (allCardPaid ? '#10b981' : '#d4d4d4'), flexShrink: 0, letterSpacing: '-0.01em', transition: 'color 0.2s' }}>
                      {hideValues ? masked : formatCurrency(creditCardTotal)}
                    </span>
                  </div>
                )}
              </>
            )}
            {editMode && <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cartão de crédito</h3>}
          </section>
        );

      case 'variable':
        if (db.variableBills.length === 0 && addSection !== 'variable' && !editMode) return null;
        return (
          <CollapsibleSection key="variable" title="Variáveis / Reservas" count={db.variableBills.length} totalAmount={db.variableBills.reduce((s, b) => s + b.amount, 0)} isOpen={isSectionOpen('variable')} onToggle={() => toggleSection('variable')} hideValues={hideValues} editMode={editMode} rightAction={
            <button onClick={() => toggleAdd('variable')} style={{ background: addSection === 'variable' ? '#111520' : 'transparent', border: `1px solid ${addSection === 'variable' ? '#1e2a3e' : '#1e1e1e'}`, borderRadius: 6, color: addSection === 'variable' ? '#60a5fa' : '#555', cursor: 'pointer', fontSize: 11, padding: '3px 10px', transition: 'all 0.15s' }}>
              {addSection === 'variable' ? 'Cancelar' : 'Adicionar'}
            </button>
          }>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {db.variableBills.map((bill) => (<BillRow key={bill.id} bill={bill} onTogglePaid={() => db.togglePaid(bill.id)} onSave={db.saveBill} onDelete={() => db.deleteBill(bill.id)} hideValues={hideValues} />))}
              {addSection === 'variable' && <InlineAddRow monthName={db.selectedMonth.name} onSave={handleAddBill} onCancel={() => setAddSection(null)} defaultType="variavel" />}
            </div>
          </CollapsibleSection>
        );

      case 'chart':
        if (db.billsSorted.length === 0 && !editMode) return null;
        return (
          <CollapsibleSection key="chart" title="Gastos por categoria" isOpen={isSectionOpen('chart', false)} onToggle={() => toggleSection('chart')} hideValues={hideValues} editMode={editMode}>
            <CategoryChart bills={db.selectedMonth.bills} hideValues={hideValues} />
          </CollapsibleSection>
        );

      case 'backup':
        return (
          <CollapsibleSection key="backup" title="Backup dos dados" isOpen={isSectionOpen('backup', false)} onToggle={() => toggleSection('backup')} hideValues={hideValues} editMode={editMode}>
            {importMsg && (
              <div style={{ background: importMsg.includes('sucesso') ? '#0a1a0a' : '#1a1010', border: `1px solid ${importMsg.includes('sucesso') ? '#152515' : '#2a1515'}`, borderRadius: 6, padding: '8px 12px', fontSize: 11, color: importMsg.includes('sucesso') ? '#4ade80' : '#ef4444', marginBottom: 10 }}>{importMsg}</div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={db.exportData} style={{ flex: 1, minWidth: 130, background: '#111520', border: '1px solid #1e2a3e', borderRadius: 6, color: '#60a5fa', cursor: 'pointer', padding: '10px 14px', fontSize: 12, fontWeight: 600 }}>Exportar backup</button>
              <label style={{ flex: 1, minWidth: 130, background: '#131313', border: '1px solid #1e1e1e', borderRadius: 6, color: '#777', cursor: 'pointer', padding: '10px 14px', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                Importar backup
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const ok = await db.importData(file); setImportMsg(ok ? 'Dados restaurados com sucesso!' : 'Arquivo inválido.'); setTimeout(() => setImportMsg(null), 4000); e.target.value = ''; }} />
              </label>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 10, color: '#2a2a2a', lineHeight: 1.5 }}>Exporte antes de trocar de celular ou limpar o navegador.</p>
          </CollapsibleSection>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e0e0e0', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>

      {/* ─── Header (simples, com safe area) ─── */}
      <header style={{
        borderBottom: '1px solid #151515',
        paddingLeft: 16, paddingRight: 16,
        paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)',
        paddingBottom: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, background: '#0a0a0a', zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#c0c0c0', letterSpacing: '-0.02em' }}>finança</span>
          <span style={{ fontSize: 9, color: '#3a3a3a', letterSpacing: '0.1em', fontWeight: 500 }}>PESSOAL</span>
        </div>
      </header>

      {/* ─── Bottom Nav ─── */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, height: 56,
        background: '#0e0e0e', borderTop: '1px solid #151515',
        display: keyboardOpen ? 'none' : 'flex', alignItems: 'center', justifyContent: 'space-around',
        zIndex: 100, paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {([
          { key: 'dashboard' as Tab, icon: IconDashboard, label: 'Dashboard' },
          { key: 'cartao' as Tab, icon: IconCard, label: 'Cartão' },
          { key: 'chat' as Tab, icon: IconChat, label: 'IA' },
        ]).map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => { setTab(key); setEditMode(false); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 18px', minWidth: 70, transition: 'all 0.15s' }}>
            <Icon active={tab === key} />
            <span style={{ fontSize: 9, fontWeight: tab === key ? 600 : 400, color: tab === key ? '#c0c0c0' : '#3a3a3a', letterSpacing: '0.02em', textTransform: 'uppercase' }}>{label}</span>
        </button>
        ))}
      </nav>

      {/* ─── Main ─── */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 16px 80px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Month selector */}
        <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 2, alignItems: 'center' }}>
          {db.months.map((m) => (
            <button key={m.id} onClick={() => db.selectMonth(m.id)} style={{
              background: db.selectedMonthId === m.id ? '#1a1a1a' : 'transparent',
              border: `1px solid ${db.selectedMonthId === m.id ? '#2a2a2a' : '#151515'}`,
              borderRadius: 6, color: db.selectedMonthId === m.id ? '#e0e0e0' : '#444',
              cursor: 'pointer', padding: '5px 12px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}>
              {formatMonthShort(m.name, m.year)}
            </button>
          ))}
          <button onClick={db.addNextMonth} style={{ background: 'transparent', border: '1px dashed #1e1e1e', borderRadius: 6, color: '#333', cursor: 'pointer', padding: '5px 10px', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }} title="Adicionar mês">+</button>
        </div>

        {/* ──── DASHBOARD ──── */}
        {tab === 'dashboard' && (
          <>
            {/* Edit mode banner */}
            {editMode && (
              <div style={{ background: '#111520', border: '1px solid #1e2a3e', borderRadius: 8, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <GripIcon />
                  <span style={{ fontSize: 12, color: '#60a5fa', fontWeight: 500 }}>Arraste para reordenar</span>
                </div>
                <button onClick={() => setEditMode(false)} style={{ background: '#3b82f6', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '5px 14px', fontSize: 11, fontWeight: 600 }}>Pronto</button>
              </div>
            )}

            {/* Progress */}
            <div style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 10, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#555' }}>Contas pagas: <strong style={{ color: '#999' }}>{paidCount}</strong> de <strong style={{ color: '#999' }}>{totalCount}</strong></span>
                <span style={{ fontSize: 12, fontWeight: 700, color: progressPct === 100 ? '#10b981' : '#666' }}>{progressPct}%</span>
              </div>
              <ProgressBar value={paidCount} max={totalCount} />
            </div>

            {/* Summary cards 2×2 com olhinho no centro */}
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                {incomeEditing ? (
                  <div style={{ background: '#131313', border: '1px solid #2a2a2a', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Entrada mensal</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input autoFocus inputMode="decimal" pattern="[0-9.,]*" value={incomeInput} onChange={(e) => setIncomeInput(e.target.value.replace(/[^0-9.,]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') { db.updateIncome(parseBRL(incomeInput)); setIncomeEditing(false); } if (e.key === 'Escape') setIncomeEditing(false); }} style={{ background: '#0e0e0e', border: '1px solid #252525', borderRadius: 6, color: '#e0e0e0', padding: '6px 10px', fontSize: 16, fontWeight: 700, width: '100%', outline: 'none', fontFamily: 'inherit' }} />
                      <button onClick={() => { db.updateIncome(parseBRL(incomeInput)); setIncomeEditing(false); }} style={{ background: '#10b981', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>OK</button>
                    </div>
                  </div>
                ) : (
                  <div onClick={() => { setIncomeInput(db.selectedMonth.income.toString()); setIncomeEditing(true); }} style={{ cursor: 'pointer' }}>
                    <SummaryCard title="Entrada mensal" value={formatCurrency(db.selectedMonth.income)} accent="green" subtitle="Toque para editar" hidden={hideValues} />
                  </div>
                )}

                <SummaryCard title="Contas a pagar" value={formatCurrency(pendingAmount)} accent="red" subtitle={`${totalCount - paidCount} pendente${totalCount - paidCount !== 1 ? 's' : ''}`} valueColor="#ef4444" hidden={hideValues} />
                <SummaryCard title="Total pago" value={formatCurrency(db.totalPaid)} accent="green" subtitle={`${paidCount} de ${totalCount}`} valueColor="#10b981" hidden={hideValues} />
                <SummaryCard title={db.remaining >= 0 ? 'Sobra prevista' : 'Déficit previsto'} value={formatCurrency(Math.abs(db.remaining))} accent={db.remaining >= 0 ? 'yellow' : 'red'} subtitle="Entrada menos contas" hidden={hideValues} />
              </div>

              {/* Olhinho flutuante no centro exato dos 4 cards */}
              <button
                onClick={togglePrivacy}
                aria-label={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  background: hideValues ? '#3b82f6' : '#1a1a1a',
                  border: `2px solid ${hideValues ? '#3b82f6' : '#2a2a2a'}`,
                  color: hideValues ? '#fff' : '#555',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s',
                  zIndex: 10,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
                }}
              >
                {hideValues ? <IconEyeClosed /> : <IconEyeOpen />}
              </button>
            </div>

            {/* Sections in custom order — draggable in edit mode */}
            {layoutOrder.map((id) => {
              const section = renderSection(id);
              if (!section) return null;

              const isDragging = dragId === id;

              return (
                <div
                  key={id}
                  id={`sw-${id}`}
                  style={{
                    position: 'relative',
                    transform: isDragging ? `translateY(${dragDelta}px) scale(1.015)` : undefined,
                    transition: isDragging ? 'box-shadow 0.15s' : undefined,
                    zIndex: isDragging ? 50 : 1,
                    opacity: isDragging ? 0.92 : 1,
                    boxShadow: isDragging ? '0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.3)' : 'none',
                    borderRadius: 10,
                    willChange: isDragging ? 'transform' : undefined,
                    touchAction: editMode ? 'none' : undefined,
                  }}
                >
                  {/* Drag grip handle — only in edit mode */}
                  {editMode && (
                    <div
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        onDragStart(id, e.touches[0].clientY);
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onDragStart(id, e.clientY);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '10px 0 4px',
                        cursor: isDragging ? 'grabbing' : 'grab',
                        touchAction: 'none',
                        userSelect: 'none',
                      }}
                    >
                      <div style={{
                        width: 36,
                        height: 5,
                        borderRadius: 3,
                        background: isDragging ? '#3b82f6' : '#2a2a2a',
                        transition: 'background 0.2s',
                      }} />
                    </div>
                  )}
                  {section}
        </div>
              );
            })}

            {/* Footer */}
            <footer style={{ textAlign: 'center', fontSize: 10, color: '#1e1e1e', paddingTop: 10, borderTop: '1px solid #111', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <span>Dados salvos automaticamente</span>
                <span style={{ color: '#151515' }}>·</span>
                <button onClick={() => { if (confirm('Limpar todos os dados e voltar ao exemplo?')) db.resetData(); }} style={{ background: 'transparent', border: 'none', color: '#1e1e1e', cursor: 'pointer', fontSize: 10, padding: 0, textDecoration: 'underline' }}>Resetar</button>
              </div>
              <button
                onClick={() => setEditMode((p) => !p)}
                style={{
                  background: editMode ? '#111520' : 'transparent',
                  border: `1px solid ${editMode ? '#1e2a3e' : '#1e1e1e'}`,
                  borderRadius: 6,
                  color: editMode ? '#60a5fa' : '#333',
                  cursor: 'pointer',
                  padding: '5px 14px',
                  fontSize: 10,
                  fontWeight: 600,
                  transition: 'all 0.15s',
                }}
              >
                {editMode ? 'Pronto' : 'Editar layout'}
              </button>
            </footer>
          </>
        )}

        {tab === 'chat' && <ChatView financialContext={financialContext} />}
        {tab === 'cartao' && (
          <CreditCardView
            selectedMonthName={db.selectedMonth.name} selectedMonthYear={db.selectedMonth.year}
            creditCardBills={db.creditCardBills} linkedFixedBills={linkedFixedBills} allMonths={db.months}
            onTogglePaid={db.togglePaid} onSaveBill={db.saveBill} onDeleteBill={db.deleteBill}
            onAddPurchase={db.addCreditCardPurchase} onImportBatch={db.addCreditCardPurchasesBatch} getAffectedMonths={db.getAffectedMonths}
            onPayCreditCard={db.payCreditCard} onUnpayCreditCard={db.unpayCreditCard}
            hideValues={hideValues}
          />
        )}
      </div>
    </div>
  );
}
