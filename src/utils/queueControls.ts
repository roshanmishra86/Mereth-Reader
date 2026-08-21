import type { ReviewPromptRecord } from './promptTypes';

/** Task 4.6 — calm review queue policy (FR-11.11). */

export interface ReviewQueuePreferences {
  dailyCardLimit: number;
  dailyTimeLimitMinutes: number;
  queuePaused: boolean;
}

export const DEFAULT_REVIEW_QUEUE_PREFERENCES: ReviewQueuePreferences = {
  dailyCardLimit: 20,
  dailyTimeLimitMinutes: 15,
  queuePaused: false,
};

export interface ReviewBudgetUsage {
  completedCards: number;
  elapsedSeconds: number;
}

export interface ReviewBudgetSummary {
  cardsUsed: number;
  cardsRemaining: number;
  secondsUsed: number;
  secondsRemaining: number;
  isCardBudgetReached: boolean;
  isTimeBudgetReached: boolean;
  isOverBudget: boolean;
  /** Due cards remain due when this is true; nothing is punished or lost. */
  backlogRemainsDue: boolean;
}

export type QueuePrompt = ReviewPromptRecord & {
  dueAt?: string | null;
  estimatedSeconds?: number;
};

export type QueueControlAction =
  | { type: 'pause'; at?: string }
  | { type: 'resume' }
  | { type: 'set_priority'; priority: number }
  | { type: 'reschedule'; dueAt: string }
  | { type: 'retire' };

const clampNonNegative = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

export function calculateDailyBudget(
  preferences: ReviewQueuePreferences,
  usage: ReviewBudgetUsage,
): ReviewBudgetSummary {
  const cardLimit = clampNonNegative(Math.floor(preferences.dailyCardLimit));
  const secondLimit = clampNonNegative(preferences.dailyTimeLimitMinutes * 60);
  const cardsUsed = clampNonNegative(Math.floor(usage.completedCards));
  const secondsUsed = clampNonNegative(usage.elapsedSeconds);
  const cardBudgetReached = cardsUsed >= cardLimit;
  const timeBudgetReached = secondsUsed >= secondLimit;

  return {
    cardsUsed,
    cardsRemaining: Math.max(0, cardLimit - cardsUsed),
    secondsUsed,
    secondsRemaining: Math.max(0, secondLimit - secondsUsed),
    isCardBudgetReached: cardBudgetReached,
    isTimeBudgetReached: timeBudgetReached,
    isOverBudget: cardBudgetReached || timeBudgetReached,
    backlogRemainsDue: cardBudgetReached || timeBudgetReached,
  };
}

export function isPromptDue(prompt: QueuePrompt, now: Date = new Date()): boolean {
  if (prompt.status !== 'adopted' || prompt.paused_at || prompt.dueAt === null) return false;
  return !prompt.dueAt || new Date(prompt.dueAt).getTime() <= now.getTime();
}

/** Returns due prompts in deterministic priority, due-date, and creation order. */
export function selectDuePrompts(
  prompts: readonly QueuePrompt[],
  now: Date = new Date(),
): QueuePrompt[] {
  return prompts
    .filter((prompt) => isPromptDue(prompt, now))
    .sort((left, right) => {
      const priority = right.priority - left.priority;
      if (priority !== 0) return priority;
      const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.NEGATIVE_INFINITY;
      const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.NEGATIVE_INFINITY;
      if (leftDue !== rightDue) return leftDue - rightDue;
      return left.created_at.localeCompare(right.created_at);
    });
}

/** Applies a queue control without changing review history or creating streak state. */
export function applyQueueControl(
  prompt: QueuePrompt,
  action: QueueControlAction,
  now: Date = new Date(),
): QueuePrompt {
  const updatedAt = now.toISOString();
  switch (action.type) {
    case 'pause':
      return { ...prompt, paused_at: action.at ?? updatedAt, updated_at: updatedAt };
    case 'resume':
      return { ...prompt, paused_at: null, updated_at: updatedAt };
    case 'set_priority':
      return { ...prompt, priority: Math.trunc(action.priority), updated_at: updatedAt };
    case 'reschedule':
      return { ...prompt, dueAt: action.dueAt, updated_at: updatedAt };
    case 'retire':
      return { ...prompt, status: 'retired', paused_at: null, updated_at: updatedAt };
  }
}

export function canStartAnotherReview(
  preferences: ReviewQueuePreferences,
  usage: ReviewBudgetUsage,
): boolean {
  return !preferences.queuePaused && !calculateDailyBudget(preferences, usage).isOverBudget;
}
