import { describe, expect, it } from 'vitest';
import { getMonthlyBudgetSummary, getSavingsGoalProgress } from './monthlyBudget';

describe('getMonthlyBudgetSummary', () => {
  it('subtracts the savings goal from the predicted remainder', () => {
    expect(getMonthlyBudgetSummary(444_700, 400_000, false)).toEqual({
      predictedRemainderCents: 444_700,
      savingsGoalCents: 400_000,
      availableCents: 44_700,
      remainingRatio: 44_700 / 444_700,
      goalShortfallCents: 0,
      status: 'over',
    });
  });

  it('treats the full predicted remainder as spendable when no manual goal is set', () => {
    expect(getMonthlyBudgetSummary(444_700, 0, true).availableCents).toBe(444_700);
    expect(getMonthlyBudgetSummary(444_700, 0, true).status).toBe('healthy');
    expect(getMonthlyBudgetSummary(444_700, 0, false).status).toBe('over');
    expect(getMonthlyBudgetSummary(-1, 0, true).status).toBe('over');
  });

  it('keeps spendable percentage separate from the bill-payment status', () => {
    const unpaid = getMonthlyBudgetSummary(444_700, 400_000, false);
    const paid = getMonthlyBudgetSummary(444_700, 400_000, true);
    expect(unpaid.remainingRatio).toBe(paid.remainingRatio);
    expect(unpaid.status).toBe('over');
    expect(paid.status).toBe('healthy');
  });

  it('only turns green after all obligations are paid and the goal is fully achievable', () => {
    expect(getMonthlyBudgetSummary(320_000, 400_000, false).status).toBe('over');
    expect(getMonthlyBudgetSummary(320_000, 400_000, true).status).toBe('caution');
    expect(getMonthlyBudgetSummary(300_000, 400_000, true).status).toBe('over');
    expect(getMonthlyBudgetSummary(400_000, 400_000, true).status).toBe('healthy');
  });

  it('never reports a negative spendable amount and exposes the savings shortfall', () => {
    const summary = getMonthlyBudgetSummary(300_000, 400_000, false);
    expect(summary.availableCents).toBe(0);
    expect(summary.goalShortfallCents).toBe(100_000);
    expect(summary.remainingRatio).toBe(0);
    expect(summary.status).toBe('over');
  });
});

describe('getSavingsGoalProgress', () => {
  it('shows when the predicted remainder can fully cover the goal', () => {
    expect(getSavingsGoalProgress(400_000, 400_000)).toMatchObject({
      projectedSavingsCents: 400_000,
      progressPercent: 100,
      remainingCents: 0,
      status: 'achieved',
    });
  });

  it('marks projected savings from 80% to below 100% as nearly achieved', () => {
    expect(getSavingsGoalProgress(320_000, 400_000)).toMatchObject({
      progressPercent: 80,
      remainingCents: 80_000,
      status: 'nearly',
    });
    expect(getSavingsGoalProgress(319_999, 400_000).status).toBe('in-progress');
  });

  it('clamps excess savings to 100% and handles a missing goal', () => {
    expect(getSavingsGoalProgress(450_000, 400_000).progressPercent).toBe(100);
    expect(getSavingsGoalProgress(10_000, 0)).toMatchObject({
      progressPercent: 0,
      status: 'in-progress',
    });
  });
});
