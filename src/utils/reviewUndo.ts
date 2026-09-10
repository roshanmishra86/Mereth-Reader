import type { FsrsScheduleState } from './fsrsScheduler';
import type { CompletedReviewAttempt, ReviewSessionState } from './reviewSession';
import { undoReviewEventIpc } from './reviewIo';

export type ReviewScheduleRecord = FsrsScheduleState;

export interface ReviewUndoItem {
  eventId: string;
  promptId: string;
  previousSchedule: ReviewScheduleRecord | null;
  attempt: CompletedReviewAttempt;
  clozeIndex?: number;
  sessionBefore?: ReviewSessionState;
}

export interface ReviewUndoStackOptions {
  /** Maximum number of review actions retained in memory. Defaults to 50. */
  limit?: number;
}

export class ReviewUndoStack {
  private stack: ReviewUndoItem[] = [];
  readonly limit: number;

  constructor(options: ReviewUndoStackOptions = {}) {
    this.limit = Math.max(1, options.limit ?? 50);
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  get size(): number {
    return this.stack.length;
  }

  push(item: ReviewUndoItem): void {
    this.stack.push(item);
    if (this.stack.length > this.limit) {
      this.stack.shift();
    }
  }

  peek(): ReviewUndoItem | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  pop(): ReviewUndoItem | null {
    return this.stack.pop() ?? null;
  }

  replay(item: ReviewUndoItem): void {
    this.push(item);
  }

  clear(): void {
    this.stack = [];
  }
}

export interface ReviewDatabaseClient {
  undoReviewEvent?: (
    eventId: string,
    promptId: string,
    previousSchedule: ReviewScheduleRecord | null,
    clozeIndex?: number
  ) => Promise<void> | void;
  deleteReviewEvent?: (eventId: string) => Promise<void> | void;
  restoreReviewSchedule?: (
    promptId: string,
    schedule: ReviewScheduleRecord | null,
    clozeIndex?: number
  ) => Promise<void> | void;
}
export type ReviewUndoDatabase = ReviewDatabaseClient;

export const defaultReviewDb: ReviewDatabaseClient = {
  undoReviewEvent: async (eventId, promptId, previousSchedule, clozeIndex) => {
    await undoReviewEventIpc(eventId, promptId, previousSchedule, clozeIndex);
  },
};

export async function undoReviewEvent(
  db: ReviewDatabaseClient,
  lastEvent: ReviewUndoItem
): Promise<void> {
  const clozeIndex = lastEvent.clozeIndex ?? lastEvent.attempt.clozeIndex ?? 0;
  if (db.undoReviewEvent) {
    await db.undoReviewEvent(
      lastEvent.eventId,
      lastEvent.promptId,
      lastEvent.previousSchedule,
      clozeIndex
    );
    return;
  }

  if (db.deleteReviewEvent && db.restoreReviewSchedule) {
    await db.deleteReviewEvent(lastEvent.eventId);
    await db.restoreReviewSchedule(lastEvent.promptId, lastEvent.previousSchedule, clozeIndex);
    return;
  }

  throw new Error('Database client does not support review undo operations');
}
