import { useEffect, useId, useRef, useState } from 'react';
import { centsToAmount } from '../services/cardTransactions';
import { getMonthlyBudgetSummary, getSavingsGoalProgress } from '../services/monthlyBudget';
import { usePreferences } from '../i18n';

interface Props {
  predictedRemainderCents: number;
  savingsGoalCents: number;
  paidBillCount: number;
  totalBillCount: number;
  hasCardItems: boolean;
  allObligationsPaid: boolean;
  hideValues?: boolean;
}

const colors = {
  healthy: { stroke: '#10b981', text: '#34d399' },
  caution: { stroke: '#f59e0b', text: '#fbbf24' },
  over: { stroke: '#ef4444', text: '#f87171' },
} as const;

const copy = {
  'pt-BR': {
    title: 'Pode gastar',
    remaining: 'da meta',
    predicted: 'Sobra prevista',
    goal: 'Meta financeira',
    noGoal: 'Meta não definida',
    availableLabel: 'disponível',
    paid: 'contas pagas',
    invoicePaid: 'fatura paga',
    invoicePending: 'fatura pendente',
    allPaid: 'Fatura e contas em dia.',
    achievable: 'Pela sobra prevista, você pode guardar até',
    nearly: 'Você está perto da meta: pode guardar até',
    inProgress: 'Pela sobra prevista, você pode guardar até',
    projected: 'Meta atingível',
    goalOf: 'de',
    shortfall: 'A meta supera a sobra prevista em',
    noGoalMessage: 'Sem meta definida: “Pode gastar” é a sobra prevista. Defina uma meta para reservar esse valor antes de calcular o disponível.',
    pendingMessage: 'O disponível já desconta a meta e as contas previstas. Marcar contas como pagas atualiza o status, não soma o valor duas vezes.',
    privacy: 'Valor oculto',
  },
  en: {
    title: 'Available to spend',
    remaining: 'available',
    predicted: 'Predicted remainder',
    goal: 'Savings goal',
    noGoal: 'No goal set',
    availableLabel: 'available',
    paid: 'bills paid',
    invoicePaid: 'invoice paid',
    invoicePending: 'invoice pending',
    allPaid: 'All bills and card invoices are paid.',
    achievable: 'Based on the predicted remainder, you can save up to',
    nearly: 'You are close to your goal: you can save up to',
    inProgress: 'Based on the predicted remainder, you can save up to',
    projected: 'Goal potential',
    goalOf: 'of',
    shortfall: 'The savings goal exceeds the predicted remainder by',
    noGoalMessage: 'No savings goal set: “Available to spend” equals your predicted remainder. Set a goal to reserve that amount before calculating what is available.',
    pendingMessage: 'Available already subtracts the goal and planned bills. Marking bills paid updates their status; it does not add the amount twice.',
    privacy: 'Amount hidden',
  },
} as const;

export function MonthlyLimitHero({
  predictedRemainderCents,
  savingsGoalCents,
  paidBillCount,
  totalBillCount,
  hasCardItems,
  allObligationsPaid,
  hideValues = false,
}: Props) {
  const { formatMoney, locale } = usePreferences();
  const text = copy[locale];
  const id = useId();
  const summary = getMonthlyBudgetSummary(predictedRemainderCents, savingsGoalCents, allObligationsPaid);
  const progress = getSavingsGoalProgress(predictedRemainderCents, savingsGoalCents);
  const milestone = allObligationsPaid ? 1 : 0;
  const previousMilestone = useRef(milestone);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (milestone <= previousMilestone.current) {
      previousMilestone.current = milestone;
      return;
    }

    previousMilestone.current = milestone;
    setCelebrating(true);
    const timer = window.setTimeout(() => setCelebrating(false), 1200);
    return () => window.clearTimeout(timer);
  }, [milestone]);
  const status = !allObligationsPaid
    ? 'over'
    : savingsGoalCents <= 0
      ? summary.status
      : progress.status === 'achieved' ? 'healthy' : progress.status === 'nearly' ? 'caution' : 'over';
  const state = colors[status];
  const circumference = 2 * Math.PI * 48;
  const percentage = Math.round(summary.remainingRatio * 100);
  const maskedMoney = hideValues ? '••••' : undefined;
  const pendingBillCount = Math.max(totalBillCount - paidBillCount, 0);
  const paymentStatus = [
    `${paidBillCount}/${totalBillCount} ${text.paid}`,
    ...(hasCardItems ? [allObligationsPaid ? text.invoicePaid : text.invoicePending] : []),
  ].join(' · ');
  const projectedAmountCents = Math.min(progress.projectedSavingsCents, progress.goalCents);
  const projectedGoalMessage = `${progress.status === 'achieved' ? text.achievable : progress.status === 'nearly' ? text.nearly : text.inProgress} ${hideValues ? maskedMoney : formatMoney(centsToAmount(projectedAmountCents))} ${text.goalOf} ${hideValues ? maskedMoney : formatMoney(centsToAmount(progress.goalCents))} (${progress.progressPercent}% ${text.projected.toLowerCase()}).`;
  const message = savingsGoalCents <= 0
    ? `${text.noGoalMessage} ${paymentStatus}.`
    : allObligationsPaid
      ? `${text.allPaid} ${projectedGoalMessage}`
      : `${paymentStatus}. ${text.pendingMessage}`;

  return (
    <section className={`monthly-limit-hero is-${status}${celebrating ? ' is-celebrating' : ''}`} aria-labelledby={`${id}-title`}>
      <div className="monthly-limit-heading">
        <span id={`${id}-title`} className="monthly-limit-title">{text.title}</span>
        <span className="monthly-limit-badge" style={{ color: state.text }}>
          {percentage}% {text.availableLabel}
        </span>
      </div>
      <div className="monthly-limit-main">
        <div className="monthly-limit-gauge" style={{ color: state.stroke }}>
          <svg aria-hidden="true" viewBox="0 0 112 112">
            <circle cx="56" cy="56" r="48" fill="none" stroke="currentColor" strokeOpacity="0.14" strokeWidth="7" />
            <circle
              cx="56"
              cy="56"
              r="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - summary.remainingRatio)}
              transform="rotate(-90 56 56)"
              className="monthly-limit-arc"
            />
          </svg>
          <span className="monthly-limit-gauge-label" aria-hidden="true">{percentage}%</span>
        </div>
        <div className="monthly-limit-values">
          <div className="monthly-limit-amount privacy-mask" aria-label={hideValues ? text.privacy : undefined} style={{ color: hideValues ? 'var(--privacy-mask)' : state.text }}>
            {hideValues ? maskedMoney : formatMoney(centsToAmount(summary.availableCents))}
          </div>
          <div className="monthly-limit-context">
            {text.predicted}: {hideValues ? maskedMoney : formatMoney(centsToAmount(summary.predictedRemainderCents))}
          </div>
          <div className="monthly-limit-context">
            {summary.savingsGoalCents > 0
              ? `${text.goal}: ${hideValues ? maskedMoney : formatMoney(centsToAmount(summary.savingsGoalCents))}`
              : text.noGoal}
          </div>
          {savingsGoalCents > 0 && !allObligationsPaid && (
            <div className="monthly-limit-context">{pendingBillCount} {locale === 'en' ? 'bills still pending' : 'contas ainda pendentes'}</div>
          )}
        </div>
      </div>
      <p className="monthly-limit-message" role="status">{message}</p>
    </section>
  );
}
