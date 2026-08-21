import { describe, expect, it } from 'vitest';
import { createDefaultPromptRecord } from './promptTypes';
import { createReviewSession, revealCurrentCard, submitCurrentReview, updateUserResponse } from './reviewSession';

describe('reviewSession state machine', () => {
  const prompt = createDefaultPromptRecord({
    id: 'p1',
    annotation_id: 'a1',
    question: 'What does testing practice improve?',
    answer: 'Delayed recall.',
    status: 'adopted',
  });

  it('starts empty when no prompts are due', () => {
    expect(createReviewSession([]).step).toBe('empty');
  });

  it('hides the answer until reveal', () => {
    const session = createReviewSession([prompt], new Date('2026-08-21T00:00:00Z'));
    expect(session.step).toBe('prompt');
    expect(session.current?.revealed).toBe(false);

    const revealed = revealCurrentCard(session);
    expect(revealed.step).toBe('revealed');
    expect(revealed.current?.revealed).toBe(true);
  });

  it('preserves typed responses in the submitted attempt', () => {
    const session = createReviewSession([prompt], new Date('2026-08-21T00:00:00Z'));
    const answered = updateUserResponse(session, 'It improves later retrieval.');
    const revealed = revealCurrentCard(answered);
    const { attempt, state } = submitCurrentReview(revealed, 'good', new Date('2026-08-21T00:00:05Z'));

    expect(attempt?.userResponse).toBe('It improves later retrieval.');
    expect(attempt?.durationMs).toBe(5000);
    expect(state.step).toBe('complete');
  });

  it('rejects rating before reveal', () => {
    const session = createReviewSession([prompt]);
    const result = submitCurrentReview(session, 'easy');
    expect(result.attempt).toBeNull();
    expect(result.state).toBe(session);
  });
});

