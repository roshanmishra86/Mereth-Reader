import { describe, expect, it } from 'vitest';
import { applyQueueControl, calculateDailyBudget, canStartAnotherReview, selectDuePrompts } from './queueControls';
import { createDefaultPromptRecord } from './promptTypes';

describe('queue controls', () => {
  it('calculates card and time budgets without streak state', () => {
    const summary = calculateDailyBudget(
      { dailyCardLimit: 2, dailyTimeLimitMinutes: 1, queuePaused: false },
      { completedCards: 2, elapsedSeconds: 30 },
    );
    expect(summary.cardsRemaining).toBe(0);
    expect(summary.secondsRemaining).toBe(30);
    expect(summary.isOverBudget).toBe(true);
    expect(summary.backlogRemainsDue).toBe(true);
  });

  it('filters paused, draft, and retired prompts and orders by priority', () => {
    const base = createDefaultPromptRecord({ status: 'adopted', question: 'What is retrieval practice?', id: 'base' });
    const due = { ...base, id: 'due', priority: 1, dueAt: '2020-01-01T00:00:00.000Z' };
    const high = { ...due, id: 'high', priority: 2 };
    expect(selectDuePrompts([due, high, { ...due, id: 'paused', paused_at: '2020-01-01T00:00:00.000Z' }, { ...due, id: 'retired', status: 'retired' }], new Date('2021-01-01')) .map((prompt) => prompt.id)).toEqual(['high', 'due']);
  });

  it('models pause, priority, reschedule, and retire without punishment', () => {
    const prompt = createDefaultPromptRecord({ status: 'adopted', question: 'What is retrieval practice?', id: 'p' });
    const now = new Date('2026-08-21T00:00:00.000Z');
    expect(applyQueueControl(prompt, { type: 'pause' }, now).paused_at).toBe(now.toISOString());
    expect(applyQueueControl(prompt, { type: 'set_priority', priority: 4 }, now).priority).toBe(4);
    expect(applyQueueControl(prompt, { type: 'reschedule', dueAt: '2026-08-22T00:00:00.000Z' }, now).dueAt).toBe('2026-08-22T00:00:00.000Z');
    expect(applyQueueControl(prompt, { type: 'retire' }, now).status).toBe('retired');
    expect(canStartAnotherReview({ dailyCardLimit: 1, dailyTimeLimitMinutes: 10, queuePaused: false }, { completedCards: 1, elapsedSeconds: 0 })).toBe(false);
  });
});
