import { describe, expect, it } from 'vitest';
import { createDefaultPromptRecord } from './promptTypes';
import {
  clearActiveReviewSession,
  createReviewSession,
  getActiveReviewSession,
  reconcileReviewSession,
  requeueCardForRelearning,
  revealCurrentCard,
  rewindReviewSession,
  setActiveReviewSession,
  submitCurrentReview,
  updateUserResponse,
  formatReviewPromptLink,
  limitReviewSession,
  pruneReviewSessionQueue,
} from './reviewSession';

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

  it('preserves explicit unscheduled cloze identity and deduplicates rows', () => {
    const cloze = { ...prompt, prompt_type: 'cloze' as const, question: '{{c1::one}} {{c2::two}}' };
    const session = createReviewSession([
      { prompt: cloze, schedule: null, cloze_index: 2 },
      { prompt: cloze, schedule: null, cloze_index: 2 },
    ]);
    expect(session.queue.map(card => card.clozeIndex)).toEqual([2]);
  });

  it('limits only pending cards without replaying completed cards', () => {
    const initial = createReviewSession([prompt, { ...prompt, id: 'p2' }, { ...prompt, id: 'p3' }]);
    const rated = submitCurrentReview(revealCurrentCard(initial), 'good').state;
    const limited = limitReviewSession(rated, 1);
    expect(limited.current?.prompt.id).toBe('p2');
    expect(limited.currentIndex).toBe(1);
    expect(limited.queue.map(card => card.prompt.id)).toEqual(['p1', 'p2']);
    expect(limitReviewSession(rated, 0).step).toBe('complete');
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

  it('manages active review session singleton persistence', () => {
    clearActiveReviewSession();
    expect(getActiveReviewSession()).toBeNull();

    const session = createReviewSession([prompt]);
    setActiveReviewSession(session);
    expect(getActiveReviewSession()).toEqual(session);

    clearActiveReviewSession();
    expect(getActiveReviewSession()).toBeNull();
  });

  it('expands a multi-cloze prompt into distinct review cards for each unique index', () => {
    const multiClozePrompt = createDefaultPromptRecord({
      id: 'cloze-1',
      prompt_type: 'cloze',
      question: '{{c1::Canberra}} is the capital of {{c2::Australia}}.',
      status: 'adopted',
    });

    const now = new Date('2026-08-21T10:00:00Z');
    const session = createReviewSession([multiClozePrompt], now);

    expect(session.step).toBe('prompt');
    expect(session.queue).toHaveLength(2);
    expect(session.queue[0].clozeIndex).toBe(1);
    expect(session.queue[0].prompt.id).toBe('cloze-1');
    expect(session.queue[1].clozeIndex).toBe(2);
    expect(session.queue[1].prompt.id).toBe('cloze-1');

    // First card targets c1
    expect(session.currentIndex).toBe(0);
    expect(session.current?.clozeIndex).toBe(1);

    // Reveal and rate first card
    const card1Revealed = revealCurrentCard(session);
    const { state: sessionAfterCard1, attempt: attempt1 } = submitCurrentReview(
      card1Revealed,
      'good',
      new Date('2026-08-21T10:00:10Z')
    );

    expect(attempt1?.prompt.id).toBe('cloze-1');
    expect(attempt1?.clozeIndex).toBe(1);
    expect(sessionAfterCard1.step).toBe('prompt');
    expect(sessionAfterCard1.currentIndex).toBe(1);
    expect(sessionAfterCard1.completed).toBe(1);
    expect(sessionAfterCard1.current?.clozeIndex).toBe(2);

    // Reveal and rate second card
    const card2Revealed = revealCurrentCard(sessionAfterCard1);
    const { state: sessionComplete, attempt: attempt2 } = submitCurrentReview(
      card2Revealed,
      'easy',
      new Date('2026-08-21T10:00:20Z')
    );

    expect(attempt2?.prompt.id).toBe('cloze-1');
    expect(attempt2?.clozeIndex).toBe(2);
    expect(sessionComplete.step).toBe('complete');
    expect(sessionComplete.completed).toBe(2);
    expect(sessionComplete.current).toBeNull();
  });

  it('assigns clozeIndex: undefined for non-cloze prompts or clozes with no deletions', () => {
    const qaPrompt = createDefaultPromptRecord({
      id: 'qa-1',
      prompt_type: 'focused_qa',
      question: 'Question?',
      answer: 'Answer.',
      status: 'adopted',
    });
    const session = createReviewSession([qaPrompt]);
    expect(session.queue).toHaveLength(1);
    expect(session.queue[0].clozeIndex).toBeUndefined();
    expect(session.current?.clozeIndex).toBeUndefined();

    const clozeWithoutDeletions = createDefaultPromptRecord({
      id: 'cloze-empty',
      prompt_type: 'cloze',
      question: 'A cloze prompt with no braces',
      status: 'adopted',
    });
    const session2 = createReviewSession([clozeWithoutDeletions]);
    expect(session2.queue).toHaveLength(1);
    expect(session2.queue[0].clozeIndex).toBeUndefined();
    expect(session2.current?.clozeIndex).toBeUndefined();
  });

  it('keeps single review card when multiple blanks share the same cloze index', () => {
    const sameIndexPrompt = createDefaultPromptRecord({
      id: 'cloze-same',
      prompt_type: 'cloze',
      question: '{{c1::Canberra}} is the capital of {{c1::Australia}}.',
      status: 'adopted',
    });
    const session = createReviewSession([sameIndexPrompt]);
    expect(session.queue).toHaveLength(1);
    expect(session.queue[0].clozeIndex).toBe(1);
    expect(session.current?.clozeIndex).toBe(1);
  });

  describe('intra-session relearning with requeueCardForRelearning', () => {
    it('appends card rated again to queue for intra-session retrieval', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const p2 = createDefaultPromptRecord({ id: 'p2', question: 'Q2', answer: 'A2', status: 'adopted' });
      const session = createReviewSession([p1, p2]);

      const revealed = revealCurrentCard(session);
      const { state: afterCard1 } = submitCurrentReview(revealed, 'again');

      const requeued = requeueCardForRelearning(afterCard1, session.current!);
      expect(requeued.queue).toHaveLength(3);
      expect(requeued.queue[2].prompt.id).toBe('p1');
      expect(requeued.queue[2].revealed).toBe(false);
      expect(requeued.queue[2].userResponse).toBe('');
      // User is currently on card 2
      expect(requeued.currentIndex).toBe(1);
      expect(requeued.current?.prompt.id).toBe('p2');
    });

    it('revives completed session if the last card in queue is rated again', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const session = createReviewSession([p1]);

      const revealed = revealCurrentCard(session);
      const { state: completedSession } = submitCurrentReview(revealed, 'again');
      expect(completedSession.step).toBe('complete');

      const requeued = requeueCardForRelearning(completedSession, session.current!);
      expect(requeued.step).toBe('prompt');
      expect(requeued.queue).toHaveLength(2);
      expect(requeued.currentIndex).toBe(1);
      expect(requeued.current?.prompt.id).toBe('p1');
      expect(requeued.current?.revealed).toBe(false);
    });
  });

  describe('in-session review undo with rewindReviewSession', () => {
    it('rewinds session from completed state back to restored card with answer revealed', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const session = createReviewSession([p1]);

      const answered = updateUserResponse(session, 'Recall attempt');
      const revealed = revealCurrentCard(answered);
      const { state: completedSession, attempt } = submitCurrentReview(revealed, 'good');
      expect(completedSession.step).toBe('complete');
      expect(completedSession.completed).toBe(1);

      const restoredCard = {
        prompt: attempt!.prompt,
        userResponse: attempt!.userResponse,
        revealed: true,
        startedAt: new Date().toISOString(),
        clozeIndex: attempt!.clozeIndex,
      };

      const rewound = rewindReviewSession(completedSession, restoredCard);
      expect(rewound.step).toBe('revealed');
      expect(rewound.currentIndex).toBe(0);
      expect(rewound.completed).toBe(0);
      expect(rewound.current?.prompt.id).toBe('p1');
      expect(rewound.current?.userResponse).toBe('Recall attempt');
      expect(rewound.current?.revealed).toBe(true);
    });

    it('removes trailing requeued clone when undoing a card rated again', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const p2 = createDefaultPromptRecord({ id: 'p2', question: 'Q2', answer: 'A2', status: 'adopted' });
      const session = createReviewSession([p1, p2]);

      const revealed = revealCurrentCard(session);
      const { state: afterCard1, attempt } = submitCurrentReview(revealed, 'again');
      const requeued = requeueCardForRelearning(afterCard1, session.current!);
      expect(requeued.queue).toHaveLength(3);

      const restoredCard = {
        prompt: attempt!.prompt,
        userResponse: attempt!.userResponse,
        revealed: true,
        startedAt: new Date().toISOString(),
        clozeIndex: attempt!.clozeIndex,
      };

      const rewound = rewindReviewSession(requeued, restoredCard);
      expect(rewound.queue).toHaveLength(2);
      expect(rewound.currentIndex).toBe(0);
      expect(rewound.current?.prompt.id).toBe('p1');
      expect(rewound.current?.revealed).toBe(true);
    });
  });

  describe('queue cache reconciliation with reconcileReviewSession', () => {
    it('drops paused and retired prompts and updates edited question/answer text', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const p2 = createDefaultPromptRecord({ id: 'p2', question: 'Q2', answer: 'A2', status: 'adopted' });
      const p3 = createDefaultPromptRecord({ id: 'p3', question: 'Q3', answer: 'A3', status: 'adopted' });
      const session = createReviewSession([p1, p2, p3]);

      // Move to card 2 (index 1)
      const afterP1 = submitCurrentReview(revealCurrentCard(session), 'good').state;
      expect(afterP1.currentIndex).toBe(1);
      expect(afterP1.current?.prompt.id).toBe('p2');

      const freshPrompts = new Map([
        ['p1', p1],
        ['p2', { ...p2, paused_at: '2026-09-05T10:00:00Z' }], // Current card was paused
        ['p3', { ...p3, question: 'Q3 updated', answer: 'A3 updated' }], // Edited text
      ]);

      const reconciled = reconcileReviewSession(afterP1, freshPrompts);

      // p2 was dropped; remaining queue is [p1, p3]
      expect(reconciled.queue).toHaveLength(2);
      expect(reconciled.queue[0].prompt.id).toBe('p1');
      expect(reconciled.queue[1].prompt.id).toBe('p3');
      expect(reconciled.queue[1].prompt.question).toBe('Q3 updated');
      expect(reconciled.queue[1].prompt.answer).toBe('A3 updated');

      // Advanced cleanly to p3
      expect(reconciled.step).toBe('prompt');
      expect(reconciled.currentIndex).toBe(1);
      expect(reconciled.current?.prompt.id).toBe('p3');
      expect(reconciled.current?.revealed).toBe(false);
    });

    it('advances to complete when current card was the last card and gets paused or retired', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const session = createReviewSession([p1]);

      const freshPrompts = new Map([
        ['p1', { ...p1, status: 'retired' as const }],
      ]);

      const reconciled = reconcileReviewSession(session, freshPrompts);
      expect(reconciled.step).toBe('empty');
      expect(reconciled.queue).toHaveLength(0);
      expect(reconciled.current).toBeNull();
    });

    it('preserves user interaction state if current card is kept and updated', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const session = createReviewSession([p1]);
      const answered = updateUserResponse(session, 'User thought');
      const revealed = revealCurrentCard(answered);

      const freshPrompts = new Map([
        ['p1', { ...p1, answer: 'A1 improved' }],
      ]);

      const reconciled = reconcileReviewSession(revealed, freshPrompts);
      expect(reconciled.step).toBe('revealed');
      expect(reconciled.current?.prompt.answer).toBe('A1 improved');
      expect(reconciled.current?.userResponse).toBe('User thought');
      expect(reconciled.current?.revealed).toBe(true);
    });
  });

  describe('formatReviewPromptLink', () => {
    it('formats annotation wiki link when annotation_id is present', () => {
      const link = formatReviewPromptLink({
        id: 'p1',
        question: 'What is neuroplasticity?',
        annotation_id: 'ann-99',
        note_id: 'note-42',
      });
      expect(link).toBe('[[mereth:ann/ann-99|What is neuroplasticity?]]');
    });

    it('formats note wiki link when note_id is present and annotation_id is absent', () => {
      const link = formatReviewPromptLink({
        id: 'p2',
        question: 'How do place cells work?',
        annotation_id: null,
        note_id: 'note-42',
      });
      expect(link).toBe('[[mereth:note/note-42|How do place cells work?]]');
    });

    it('formats deep link URL when neither annotation_id nor note_id is present', () => {
      const link = formatReviewPromptLink({
        id: 'p3',
        question: 'What is retrieval practice?',
        annotation_id: null,
        note_id: null,
      });
      expect(link).toBe('[What is retrieval practice?](mereth://review/p3)');
    });
  });

  describe('createReviewSession with DueReviewPromptRecord schedule identity', () => {
    const multiClozePrompt = createDefaultPromptRecord({
      id: 'cloze-multi',
      prompt_type: 'cloze',
      question: 'The {{c1::hippocampus}} is responsible for {{c2::memory formation}}.',
      answer: 'hippocampus, memory formation',
      status: 'adopted',
    });

    it('creates card only for the due cloze index and does not bring back non-due cloze variants', () => {
      const dueRows = [
        {
          prompt: multiClozePrompt,
          schedule: {
            prompt_id: 'cloze-multi',
            cloze_index: 2,
            desired_retention: 0.9,
            state: 'review' as const,
            stability: 5,
            difficulty: 5,
            due_at: '2026-08-20T00:00:00Z',
            fsrs_version: 'FSRS-4.5',
            updated_at: '2026-08-20T00:00:00Z',
            provenance: 'deterministic_transform' as const,
          },
        },
      ];

      const session = createReviewSession(dueRows);
      expect(session.queue).toHaveLength(1);
      expect(session.queue[0].clozeIndex).toBe(2);
    });

    it('creates distinct cards for multiple due schedules without expanding each into duplicates', () => {
      const dueRows = [
        {
          prompt: multiClozePrompt,
          schedule: {
            prompt_id: 'cloze-multi',
            cloze_index: 1,
            desired_retention: 0.9,
            state: 'review' as const,
            stability: 5,
            difficulty: 5,
            due_at: '2026-08-20T00:00:00Z',
            fsrs_version: 'FSRS-4.5',
            updated_at: '2026-08-20T00:00:00Z',
            provenance: 'deterministic_transform' as const,
          },
        },
        {
          prompt: multiClozePrompt,
          schedule: {
            prompt_id: 'cloze-multi',
            cloze_index: 2,
            desired_retention: 0.9,
            state: 'review' as const,
            stability: 5,
            difficulty: 5,
            due_at: '2026-08-20T00:00:00Z',
            fsrs_version: 'FSRS-4.5',
            updated_at: '2026-08-20T00:00:00Z',
            provenance: 'deterministic_transform' as const,
          },
        },
      ];

      const session = createReviewSession(dueRows);
      expect(session.queue).toHaveLength(2);
      expect(session.queue[0].clozeIndex).toBe(1);
      expect(session.queue[1].clozeIndex).toBe(2);
    });

    it('deduplicates cards if two identical schedules are present', () => {
      const schedule = {
        prompt_id: 'cloze-multi',
        cloze_index: 1,
        desired_retention: 0.9,
        state: 'review' as const,
        stability: 5,
        difficulty: 5,
        due_at: '2026-08-20T00:00:00Z',
        fsrs_version: 'FSRS-4.5',
        updated_at: '2026-08-20T00:00:00Z',
        provenance: 'deterministic_transform' as const,
      };
      const session = createReviewSession([
        { prompt: multiClozePrompt, schedule },
        { prompt: multiClozePrompt, schedule },
      ]);
      expect(session.queue).toHaveLength(1);
      expect(session.queue[0].clozeIndex).toBe(1);
    });

    it('expands all cloze variants when schedule is null', () => {
      const session = createReviewSession([
        { prompt: multiClozePrompt, schedule: null },
      ]);
      expect(session.queue).toHaveLength(2);
      expect(session.queue[0].clozeIndex).toBe(1);
      expect(session.queue[1].clozeIndex).toBe(2);
    });
  });

  describe('pruneReviewSessionQueue and relearning card retention', () => {
    it('preserves explicitly queued relearning cards even when absent from database due cards', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const p2 = createDefaultPromptRecord({ id: 'p2', question: 'Q2', answer: 'A2', status: 'adopted' });

      // User starts session with p1 and p2
      const session = createReviewSession([p1, p2]);
      // Rates p1 Again
      const revealed = revealCurrentCard(session);
      const { state: afterP1 } = submitCurrentReview(revealed, 'again');
      const requeued = requeueCardForRelearning(afterP1, session.current!);
      expect(requeued.queue).toHaveLength(3);
      expect(requeued.currentIndex).toBe(1);
      expect(requeued.queue[2].isRelearning).toBe(true);

      // Now user navigates away and returns to Review.
      // Database due query now only returns p2 (p1 is no longer due because its due date was saved as tomorrow)
      const mergedDue = [p2];
      const pruned = pruneReviewSessionQueue(requeued, mergedDue, 10);

      // Queue should preserve:
      // index 0: p1 (already completed earlier in session)
      // index 1: p2 (unreviewed, still due in mergedDue)
      // index 2: p1 (explicitly queued relearning copy, preserved despite being absent from mergedDue)
      expect(pruned).toHaveLength(3);
      expect(pruned[0].prompt.id).toBe('p1');
      expect(pruned[1].prompt.id).toBe('p2');
      expect(pruned[2].prompt.id).toBe('p1');
      expect(pruned[2].isRelearning).toBe(true);
    });

    it('enforces remainingDailyBudget on unreviewed cards without losing completed cards', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const p2 = createDefaultPromptRecord({ id: 'p2', question: 'Q2', answer: 'A2', status: 'adopted' });
      const p3 = createDefaultPromptRecord({ id: 'p3', question: 'Q3', answer: 'A3', status: 'adopted' });

      const session = createReviewSession([p1, p2, p3]);
      // Complete p1
      const afterP1 = submitCurrentReview(revealCurrentCard(session), 'good').state;
      expect(afterP1.currentIndex).toBe(1);

      // Suppose budget allows only 1 more unreviewed card
      const pruned = pruneReviewSessionQueue(afterP1, [p2, p3], 1);
      expect(pruned).toHaveLength(2); // p1 (completed) + p2 (1 card budget)
      expect(pruned[0].prompt.id).toBe('p1');
      expect(pruned[1].prompt.id).toBe('p2');
    });

    it('reconciles and drops relearning cards if their prompt was paused while navigated away', () => {
      const p1 = createDefaultPromptRecord({ id: 'p1', question: 'Q1', answer: 'A1', status: 'adopted' });
      const session = createReviewSession([p1]);
      const { state: afterP1 } = submitCurrentReview(revealCurrentCard(session), 'again');
      const requeued = requeueCardForRelearning(afterP1, session.current!);

      const prunedQueue = pruneReviewSessionQueue(requeued, [], 10);
      const pausedP1 = { ...p1, paused_at: new Date().toISOString() };
      const promptMap = new Map<string, typeof p1 | null>([['p1', pausedP1]]);

      const reconciled = reconcileReviewSession(
        { ...requeued, queue: prunedQueue },
        promptMap
      );
      // Because p1 was paused, it must be removed from queue
      expect(reconciled.queue).toHaveLength(0);
      expect(reconciled.step).toBe('empty');
    });
  });
});

