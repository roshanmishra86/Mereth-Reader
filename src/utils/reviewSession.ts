import type { ReviewPromptRecord } from './promptTypes';
import type { ReviewOutcome } from './fsrsScheduler';

export type ReviewSessionStep = 'loading' | 'empty' | 'prompt' | 'revealed' | 'complete';

export interface ReviewSessionCard {
  prompt: ReviewPromptRecord;
  userResponse: string;
  revealed: boolean;
  startedAt: string;
}

export interface ReviewSessionState {
  step: ReviewSessionStep;
  queue: ReviewPromptRecord[];
  currentIndex: number;
  current: ReviewSessionCard | null;
  completed: number;
}

export interface CompletedReviewAttempt {
  prompt: ReviewPromptRecord;
  outcome: ReviewOutcome;
  userResponse: string;
  durationMs: number;
}

export function createReviewSession(queue: ReviewPromptRecord[], now = new Date()): ReviewSessionState {
  if (queue.length === 0) {
    return { step: 'empty', queue, currentIndex: 0, current: null, completed: 0 };
  }
  return {
    step: 'prompt',
    queue,
    currentIndex: 0,
    current: { prompt: queue[0], userResponse: '', revealed: false, startedAt: now.toISOString() },
    completed: 0,
  };
}

export function updateUserResponse(state: ReviewSessionState, userResponse: string): ReviewSessionState {
  if (!state.current) return state;
  return { ...state, current: { ...state.current, userResponse } };
}

export function revealCurrentCard(state: ReviewSessionState): ReviewSessionState {
  if (!state.current) return state;
  return { ...state, step: 'revealed', current: { ...state.current, revealed: true } };
}

export function submitCurrentReview(
  state: ReviewSessionState,
  outcome: ReviewOutcome,
  now = new Date()
): { state: ReviewSessionState; attempt: CompletedReviewAttempt | null } {
  if (!state.current || !state.current.revealed) {
    return { state, attempt: null };
  }
  const attempt: CompletedReviewAttempt = {
    prompt: state.current.prompt,
    outcome,
    userResponse: state.current.userResponse,
    durationMs: Math.max(0, now.getTime() - new Date(state.current.startedAt).getTime()),
  };
  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.queue.length) {
    return {
      attempt,
      state: { ...state, step: 'complete', currentIndex: nextIndex, current: null, completed: state.completed + 1 },
    };
  }
  return {
    attempt,
    state: {
      ...state,
      step: 'prompt',
      currentIndex: nextIndex,
      current: { prompt: state.queue[nextIndex], userResponse: '', revealed: false, startedAt: now.toISOString() },
      completed: state.completed + 1,
    },
  };
}

