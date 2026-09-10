import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReviewUndoStack,
  undoReviewEvent,
  type ReviewUndoDatabase,
  type ReviewUndoItem,
  type ReviewScheduleRecord,
} from './reviewUndo';
import { createDefaultPromptRecord } from './promptTypes';

describe('reviewUndo', () => {
  const samplePrompt = createDefaultPromptRecord({
    id: 'prompt-1',
    annotation_id: 'ann-1',
    question: 'What is active recall?',
    answer: 'Testing retrieval improves long-term memory retention.',
    status: 'adopted',
  });

  const sampleSchedule: ReviewScheduleRecord = {
    prompt_id: 'prompt-1',
    desired_retention: 0.9,
    state: 'review',
    stability: 3.5,
    difficulty: 4.2,
    due_at: '2026-09-08T12:00:00Z',
    last_reviewed_at: '2026-09-05T12:00:00Z',
    last_outcome: 'good',
    fsrs_version: 'FSRS-4.5-mereth-1',
    updated_at: '2026-09-05T12:00:00Z',
    provenance: 'deterministic_transform',
  };

  const sampleItem: ReviewUndoItem = {
    eventId: 'event-101',
    promptId: 'prompt-1',
    previousSchedule: sampleSchedule,
    attempt: {
      prompt: samplePrompt,
      outcome: 'good',
      userResponse: 'Testing retrieval',
      durationMs: 4200,
      clozeIndex: undefined,
    },
  };

  describe('ReviewUndoStack', () => {
    let stack: ReviewUndoStack;

    beforeEach(() => {
      stack = new ReviewUndoStack();
    });

    it('starts empty with canUndo false', () => {
      expect(stack.canUndo).toBe(false);
      expect(stack.size).toBe(0);
      expect(stack.peek()).toBeNull();
      expect(stack.pop()).toBeNull();
    });

    it('pushes and pops items in LIFO order', () => {
      const item2: ReviewUndoItem = {
        ...sampleItem,
        eventId: 'event-102',
        promptId: 'prompt-2',
      };

      stack.push(sampleItem);
      stack.push(item2);

      expect(stack.canUndo).toBe(true);
      expect(stack.size).toBe(2);
      expect(stack.peek()).toEqual(item2);

      expect(stack.pop()).toEqual(item2);
      expect(stack.size).toBe(1);
      expect(stack.pop()).toEqual(sampleItem);
      expect(stack.size).toBe(0);
      expect(stack.canUndo).toBe(false);
    });

    it('enforces capacity limit by evicting oldest entries', () => {
      const boundedStack = new ReviewUndoStack({ limit: 2 });
      const itemA: ReviewUndoItem = { ...sampleItem, eventId: 'e-1' };
      const itemB: ReviewUndoItem = { ...sampleItem, eventId: 'e-2' };
      const itemC: ReviewUndoItem = { ...sampleItem, eventId: 'e-3' };

      boundedStack.push(itemA);
      boundedStack.push(itemB);
      boundedStack.push(itemC);

      expect(boundedStack.size).toBe(2);
      expect(boundedStack.pop()).toEqual(itemC);
      expect(boundedStack.pop()).toEqual(itemB);
      expect(boundedStack.pop()).toBeNull();
    });

    it('clears all items on clear()', () => {
      stack.push(sampleItem);
      expect(stack.canUndo).toBe(true);
      stack.clear();
      expect(stack.canUndo).toBe(false);
      expect(stack.size).toBe(0);
    });

    it('replays an item by re-pushing after an operation failure', () => {
      stack.push(sampleItem);
      const popped = stack.pop();
      expect(popped).toEqual(sampleItem);
      expect(stack.canUndo).toBe(false);

      if (popped) {
        stack.replay(popped);
      }
      expect(stack.canUndo).toBe(true);
      expect(stack.peek()).toEqual(sampleItem);
    });
  });

  describe('undoReviewEvent', () => {
    it('calls explicit deleteReviewEvent and restoreReviewSchedule if provided', async () => {
      const deleteReviewEvent = vi.fn().mockResolvedValue(undefined);
      const restoreReviewSchedule = vi.fn().mockResolvedValue(undefined);

      const db: ReviewUndoDatabase = {
        deleteReviewEvent,
        restoreReviewSchedule,
      };

      await undoReviewEvent(db, sampleItem);

      expect(deleteReviewEvent).toHaveBeenCalledWith('event-101');
      expect(restoreReviewSchedule).toHaveBeenCalledWith('prompt-1', sampleSchedule, 0);
    });

    it('clears review_schedule when previousSchedule is null', async () => {
      const deleteReviewEvent = vi.fn().mockResolvedValue(undefined);
      const restoreReviewSchedule = vi.fn().mockResolvedValue(undefined);

      const db: ReviewUndoDatabase = {
        deleteReviewEvent,
        restoreReviewSchedule,
      };

      const newItem: ReviewUndoItem = {
        ...sampleItem,
        previousSchedule: null,
      };

      await undoReviewEvent(db, newItem);

      expect(deleteReviewEvent).toHaveBeenCalledWith('event-101');
      expect(restoreReviewSchedule).toHaveBeenCalledWith('prompt-1', null, 0);
    });

    it('calls undoReviewEvent handler directly if provided on db client', async () => {
      const undoFn = vi.fn().mockResolvedValue(undefined);
      const db: ReviewUndoDatabase = {
        undoReviewEvent: undoFn,
      };

      await undoReviewEvent(db, sampleItem);

      expect(undoFn).toHaveBeenCalledWith('event-101', 'prompt-1', sampleSchedule, 0);
    });

    it('throws error when database client provides no undo operations', async () => {
      const emptyDb: ReviewUndoDatabase = {};
      await expect(undoReviewEvent(emptyDb, sampleItem)).rejects.toThrow(
        'Database client does not support review undo operations'
      );
    });

    it('propagates database execution errors', async () => {
      const db: ReviewUndoDatabase = {
        undoReviewEvent: vi.fn().mockRejectedValue(new Error('IPC call failed')),
      };

      await expect(undoReviewEvent(db, sampleItem)).rejects.toThrow('IPC call failed');
    });
  });
});
