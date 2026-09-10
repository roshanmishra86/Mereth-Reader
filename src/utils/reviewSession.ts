import type { ReviewPromptRecord } from './promptTypes';
import type { ReviewOutcome } from './fsrsScheduler';
import type { DueReviewPromptRecord } from './reviewIo';
import { getUniqueClozeIndices } from './cloze';
import { formatWikiLink } from './noteLinks';

export type ReviewSessionStep = 'loading' | 'empty' | 'prompt' | 'revealed' | 'complete';

export interface ReviewSessionCard {
  prompt: ReviewPromptRecord;
  userResponse: string;
  revealed: boolean;
  startedAt: string;
  clozeIndex?: number;
  isRelearning?: boolean;
}

export interface ReviewSessionState {
  step: ReviewSessionStep;
  queue: ReviewSessionCard[];
  currentIndex: number;
  current: ReviewSessionCard | null;
  completed: number;
}

export interface CompletedReviewAttempt {
  prompt: ReviewPromptRecord;
  outcome: ReviewOutcome;
  userResponse: string;
  durationMs: number;
  clozeIndex?: number;
}

export function createReviewSession(
  queue: (ReviewPromptRecord | DueReviewPromptRecord)[],
  now = new Date()
): ReviewSessionState {
  const cards: ReviewSessionCard[] = [];
  const startedAt = now.toISOString();
  const seenKeys = new Set<string>();

  for (const item of queue) {
    const isDueRecord = 'prompt' in item && typeof (item as DueReviewPromptRecord).prompt === 'object';
    const prompt: ReviewPromptRecord = isDueRecord ? (item as DueReviewPromptRecord).prompt : (item as ReviewPromptRecord);
    const schedule = isDueRecord ? (item as DueReviewPromptRecord).schedule : undefined;

    if (prompt.prompt_type === 'cloze') {
      const explicitIndex = isDueRecord ? (item as DueReviewPromptRecord).cloze_index : undefined;
      if (explicitIndex !== undefined || (schedule !== null && schedule !== undefined)) {
        // Schedule identity is preserved: create card specifically for this cloze_index
        const clozeIndex = explicitIndex ?? schedule?.cloze_index ?? 0;
        const key = `${prompt.id}:${clozeIndex}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          cards.push({
            prompt,
            userResponse: '',
            revealed: false,
            startedAt,
            clozeIndex,
          });
        }
      } else {
        // Unscheduled cloze: expand into all unique cloze variants
        const indices = getUniqueClozeIndices(prompt.question);
        if (indices.length > 0) {
          for (const clozeIndex of indices) {
            const key = `${prompt.id}:${clozeIndex}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              cards.push({
                prompt,
                userResponse: '',
                revealed: false,
                startedAt,
                clozeIndex,
              });
            }
          }
        } else {
          const key = `${prompt.id}:default`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            cards.push({
              prompt,
              userResponse: '',
              revealed: false,
              startedAt,
              clozeIndex: undefined,
            });
          }
        }
      }
    } else {
      const key = `${prompt.id}:default`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        cards.push({
          prompt,
          userResponse: '',
          revealed: false,
          startedAt,
          clozeIndex: undefined,
        });
      }
    }
  }

  if (cards.length === 0) {
    return { step: 'empty', queue: cards, currentIndex: 0, current: null, completed: 0 };
  }
  return {
    step: 'prompt',
    queue: cards,
    currentIndex: 0,
    current: cards[0],
    completed: 0,
  };
}

export function updateUserResponse(state: ReviewSessionState, userResponse: string): ReviewSessionState {
  if (!state.current) return state;
  return { ...state, current: { ...state.current, userResponse } };
}

/** Keep history intact; budgets apply only to the unreviewed suffix. */
export function limitReviewSession(state: ReviewSessionState, remaining: number): ReviewSessionState {
  const queue = state.queue.slice(0, state.currentIndex + Math.max(0, Math.floor(remaining)));
  if (queue.length <= state.currentIndex) {
    return { ...state, queue, current: null, step: state.completed > 0 ? 'complete' : 'empty' };
  }
  return { ...state, queue };
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
    clozeIndex: state.current.clozeIndex,
  };
  const nextIndex = state.currentIndex + 1;
  if (nextIndex >= state.queue.length) {
    return {
      attempt,
      state: { ...state, step: 'complete', currentIndex: nextIndex, current: null, completed: state.completed + 1 },
    };
  }
  const nextCard = state.queue[nextIndex];
  return {
    attempt,
    state: {
      ...state,
      step: 'prompt',
      currentIndex: nextIndex,
      current: {
        ...nextCard,
        userResponse: '',
        revealed: false,
        startedAt: now.toISOString(),
      },
      completed: state.completed + 1,
    },
  };
}

export function requeueCardForRelearning(
  state: ReviewSessionState,
  card: ReviewSessionCard,
  now = new Date()
): ReviewSessionState {
  const relearnCard: ReviewSessionCard = {
    prompt: card.prompt,
    userResponse: '',
    revealed: false,
    startedAt: now.toISOString(),
    clozeIndex: card.clozeIndex,
    isRelearning: true,
  };
  const newQueue = [...state.queue, relearnCard];

  if (state.step === 'complete' || state.step === 'empty' || !state.current) {
    return {
      ...state,
      step: 'prompt',
      queue: newQueue,
      currentIndex: state.currentIndex < newQueue.length ? state.currentIndex : newQueue.length - 1,
      current: relearnCard,
    };
  }

  return {
    ...state,
    queue: newQueue,
  };
}

export function rewindReviewSession(
  state: ReviewSessionState,
  restoredCard: ReviewSessionCard
): ReviewSessionState {
  const targetIndex = Math.max(0, state.currentIndex > 0 ? state.currentIndex - 1 : 0);
  const newQueue = [...state.queue];

  // If the last card was an intra-session relearning clone of this card, drop the trailing clone
  if (
    newQueue.length > targetIndex + 1 &&
    newQueue[newQueue.length - 1]?.prompt.id === restoredCard.prompt.id &&
    newQueue[newQueue.length - 1]?.clozeIndex === restoredCard.clozeIndex
  ) {
    newQueue.pop();
  }

  if (targetIndex < newQueue.length) {
    newQueue[targetIndex] = restoredCard;
  } else {
    newQueue.push(restoredCard);
  }

  const step: ReviewSessionStep = restoredCard.revealed ? 'revealed' : 'prompt';

  return {
    ...state,
    step,
    queue: newQueue,
    currentIndex: targetIndex,
    current: restoredCard,
    completed: Math.max(0, state.completed - 1),
  };
}

/**
 * Prunes an active review session queue when resuming Review, preserving:
 * 1. Previously reviewed cards in the current session (indices < currentIndex).
 * 2. Unreviewed cards that are currently due from the database.
 * 3. Explicitly queued relearning cards (marked with isRelearning or completed earlier in this session),
 *    even when the database due query excludes them (since their next due date was persisted as tomorrow).
 * 4. Bound the unreviewed queue by remainingDailyBudget.
 */
export function pruneReviewSessionQueue(
  active: ReviewSessionState,
  mergedDue: (ReviewPromptRecord | DueReviewPromptRecord)[],
  remainingDailyBudget: number
): ReviewSessionCard[] {
  const dueKeys = new Set(createReviewSession(mergedDue).queue.map((card) => `${card.prompt.id}:${card.clozeIndex ?? 0}`));
  const completedKeys = new Set(active.queue.slice(0, active.currentIndex).map((card) => `${card.prompt.id}:${card.clozeIndex ?? 0}`));

  const remainingQueue = active.queue
    .slice(active.currentIndex)
    .filter((card) => {
      const key = `${card.prompt.id}:${card.clozeIndex ?? 0}`;
      const isExplicitRelearning = card.isRelearning === true || completedKeys.has(key);
      return dueKeys.has(key) || isExplicitRelearning;
    })
    .slice(0, Math.max(0, remainingDailyBudget));

  return [
    ...active.queue.slice(0, active.currentIndex),
    ...remainingQueue,
  ];
}

export function reconcileReviewSession(
  state: ReviewSessionState,
  freshPrompts: Map<string, ReviewPromptRecord | null>
): ReviewSessionState {
  if (state.step === 'empty' && state.queue.length === 0) {
    return state;
  }

  const isCardValid = (card: ReviewSessionCard): { valid: boolean; prompt: ReviewPromptRecord | null } => {
    const fresh = freshPrompts.get(card.prompt.id);
    if (!fresh) return { valid: false, prompt: null };
    if (fresh.status !== 'adopted' || fresh.paused_at !== null) {
      return { valid: false, prompt: fresh };
    }
    if (fresh.prompt_type === 'cloze' && card.clozeIndex !== undefined) {
      const validIndices = getUniqueClozeIndices(fresh.question);
      if (!validIndices.includes(card.clozeIndex)) {
        return { valid: false, prompt: fresh };
      }
    }
    return { valid: true, prompt: fresh };
  };

  let currentCardKept = false;
  let newCurrentIndex = -1;
  let keptBeforeCurrent = 0;
  const newQueue: ReviewSessionCard[] = [];

  for (let i = 0; i < state.queue.length; i++) {
    const card = state.queue[i];
    const { valid, prompt } = isCardValid(card);
    if (valid && prompt) {
      const updatedCard: ReviewSessionCard = {
        ...card,
        prompt,
      };
      if (i < state.currentIndex) {
        keptBeforeCurrent++;
      } else if (i === state.currentIndex) {
        currentCardKept = true;
        newCurrentIndex = newQueue.length;
      }
      newQueue.push(updatedCard);
    }
  }

  if (newQueue.length === 0) {
    return {
      ...state,
      step: 'empty',
      queue: [],
      currentIndex: 0,
      current: null,
    };
  }

  if (state.step === 'complete') {
    return {
      ...state,
      queue: newQueue,
      currentIndex: newQueue.length,
      current: null,
    };
  }

  if (currentCardKept && newCurrentIndex >= 0) {
    const existingCurrent = state.current;
    const activeCard: ReviewSessionCard = {
      ...newQueue[newCurrentIndex],
      userResponse: existingCurrent?.userResponse ?? '',
      revealed: existingCurrent?.revealed ?? false,
      startedAt: existingCurrent?.startedAt ?? new Date().toISOString(),
    };
    newQueue[newCurrentIndex] = activeCard;
    return {
      ...state,
      queue: newQueue,
      currentIndex: newCurrentIndex,
      current: activeCard,
    };
  }

  // Current card was paused or retired: advance cleanly to next card
  const candidateIndex = keptBeforeCurrent;
  if (candidateIndex < newQueue.length) {
    const nextCard = newQueue[candidateIndex];
    const freshCurrentCard: ReviewSessionCard = {
      ...nextCard,
      userResponse: '',
      revealed: false,
      startedAt: new Date().toISOString(),
    };
    newQueue[candidateIndex] = freshCurrentCard;
    return {
      ...state,
      step: 'prompt',
      queue: newQueue,
      currentIndex: candidateIndex,
      current: freshCurrentCard,
    };
  }

  return {
    ...state,
    step: 'complete',
    queue: newQueue,
    currentIndex: newQueue.length,
    current: null,
  };
}

let activeReviewSession: ReviewSessionState | null = null;

export function getActiveReviewSession(): ReviewSessionState | null {
  return activeReviewSession;
}

export function setActiveReviewSession(session: ReviewSessionState | null): void {
  activeReviewSession = session;
}

export function clearActiveReviewSession(): void {
  activeReviewSession = null;
}

/**
 * Generates a navigable link for a review prompt in synthesis notes (Issue 7).
 * Precedence:
 * 1. Annotation wiki link: [[mereth:ann/{annotation_id}|{question}]]
 * 2. Note wiki link: [[mereth:note/{note_id}|{question}]]
 * 3. Deep link URL: [{question}](mereth://review/{id})
 */
export function formatReviewPromptLink(
  prompt: Pick<ReviewPromptRecord, 'id' | 'question'> & {
    annotation_id?: string | null;
    note_id?: string | null;
  }
): string {
  if (prompt.annotation_id) {
    return formatWikiLink('ann', prompt.annotation_id, prompt.question);
  }
  if (prompt.note_id) {
    return formatWikiLink('note', prompt.note_id, prompt.question);
  }
  const label = prompt.question.replace(/[\r\n]+/g, ' ').replace(/[\\\[\]]/g, '\\$&');
  return `[${label}](mereth://review/${encodeURIComponent(prompt.id)})`;
}
