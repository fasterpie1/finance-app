export type MonthlyBudgetStatus = 'healthy' | 'caution' | 'over';

export interface MonthlyBudgetSummary {
  predictedRemainderCents: number;
  savingsGoalCents: number;
  availableCents: number;
  remainingRatio: number;
  goalShortfallCents: number;
  status: MonthlyBudgetStatus;
}

export type SavingsGoalStatus = 'achieved' | 'nearly' | 'in-progress';

export interface SavingsGoalProgress {
  projectedSavingsCents: number;
  goalCents: number;
  progressRatio: number;
  progressPercent: number;
  remainingCents: number;
  status: SavingsGoalStatus;
}

export function getSavingsGoalProgress(projectedSavingsCents: number, goalCents: number): SavingsGoalProgress {
  const projected = Number.isSafeInteger(projectedSavingsCents) ? Math.max(0, projectedSavingsCents) : 0;
  const goal = Number.isSafeInteger(goalCents) ? Math.max(0, goalCents) : 0;
  const progressRatio = goal > 0 ? Math.min(projected / goal, 1) : 0;
  const progressPercent = Math.round(progressRatio * 100);

  return {
    projectedSavingsCents: projected,
    goalCents: goal,
    progressRatio,
    progressPercent,
    remainingCents: Math.max(goal - projected, 0),
    status: goal > 0 && projected >= goal ? 'achieved' : goal > 0 && progressRatio >= 0.8 ? 'nearly' : 'in-progress',
  };
}

export function getMonthlyBudgetSummary(
  predictedRemainderCents: number,
  savingsGoalCents: number,
): MonthlyBudgetSummary {
  const predicted = Number.isSafeInteger(predictedRemainderCents) ? predictedRemainderCents : 0;
  const goal = Number.isSafeInteger(savingsGoalCents) ? Math.max(0, savingsGoalCents) : 0;
  const availableCents = predicted - goal;
  const remainingRatio = predicted > 0
    ? Math.max(0, Math.min(1, availableCents / predicted))
    : 0;
  const goalShortfallCents = Math.max(-availableCents, 0);
  const status: MonthlyBudgetStatus = goalShortfallCents > 0
    ? 'over'
    : remainingRatio <= 0.02 ? 'caution' : 'healthy';

  return {
    predictedRemainderCents: predicted,
    savingsGoalCents: goal,
    availableCents: Math.max(availableCents, 0),
    remainingRatio,
    goalShortfallCents,
    status,
  };
}
