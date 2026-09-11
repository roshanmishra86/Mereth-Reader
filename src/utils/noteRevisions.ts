/**
 * Note autosave buffer coordinator and revision comparator (PRD FR-10.8).
 *
 * Buffers edits with a write-ahead recovery record (localStorage in the app),
 * debounces persistence, and supports immediate flush on navigation or close.
 */

import { NoteRevisionRecord } from './notesTypes';

export interface PendingNoteEdit {
  noteId: string;
  title: string;
  bodyMarkdown: string;
  timestamp: number;
  generation: number;
}

export interface RevisionDiffSummary {
  titleChanged: boolean;
  charDelta: number;
  addedLines: number;
  removedLines: number;
  description: string;
}

const DRAFT_WAL_PREFIX = 'mereth_draft_wal:';
const inMemoryDraftWal = new Map<string, string>();

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultDraftStorage: DraftStorage = {
  getItem: (key) => typeof localStorage !== 'undefined' ? localStorage.getItem(key) : inMemoryDraftWal.get(key) ?? null,
  setItem: (key, value) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    else inMemoryDraftWal.set(key, value);
  },
  removeItem: (key) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    else inMemoryDraftWal.delete(key);
  },
};

/** Identifies whether WAL survives a process restart in the current runtime. */
export function getRecoverableDraftStorageScope(): 'browser-localStorage' | 'node-process-memory' {
  return typeof localStorage !== 'undefined' ? 'browser-localStorage' : 'node-process-memory';
}

export function saveRecoverableDraft(noteId: string, draft: PendingNoteEdit): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(`${DRAFT_WAL_PREFIX}${noteId}`, JSON.stringify(draft));
    } else {
      inMemoryDraftWal.set(`${DRAFT_WAL_PREFIX}${noteId}`, JSON.stringify(draft));
    }
  } catch (err) {
    console.warn(`Failed to save recoverable draft for note ${noteId}:`, err);
  }
}

export function getRecoverableDraft(noteId: string, storage: DraftStorage = defaultDraftStorage): PendingNoteEdit | null {
  try {
    const raw = storage.getItem(`${DRAFT_WAL_PREFIX}${noteId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingNoteEdit>;
    if (
      parsed &&
      typeof parsed.noteId === 'string' &&
      typeof parsed.title === 'string' &&
      typeof parsed.bodyMarkdown === 'string' &&
      typeof parsed.timestamp === 'number' &&
      typeof parsed.generation === 'number'
    ) {
      return {
        noteId: parsed.noteId,
        title: parsed.title,
        bodyMarkdown: parsed.bodyMarkdown,
        timestamp: parsed.timestamp,
        generation: parsed.generation,
      };
    }
  } catch (err) {
    console.warn(`Failed to read recoverable draft for note ${noteId}:`, err);
  }
  return null;
}

export function clearRecoverableDraft(noteId: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`${DRAFT_WAL_PREFIX}${noteId}`);
    } else {
      inMemoryDraftWal.delete(`${DRAFT_WAL_PREFIX}${noteId}`);
    }
  } catch (err) {
    console.warn(`Failed to clear recoverable draft for note ${noteId}:`, err);
  }
}

type FlushHandler = () => Promise<unknown>;
const pendingSaveHandlers = new Set<FlushHandler>();

export function registerPendingSaveHandler(handler: FlushHandler): () => void {
  pendingSaveHandlers.add(handler);
  return () => {
    pendingSaveHandlers.delete(handler);
  };
}

export async function flushAllPendingSaves(): Promise<void> {
  const handlers = Array.from(pendingSaveHandlers);
  const results = await Promise.allSettled(handlers.map((h) => h()));
  const failures: unknown[] = [];
  for (const r of results) {
    if (r.status === 'rejected') {
      failures.push(r.reason);
      console.error('Failed flushing pending save:', r.reason);
    } else if (r.value === false) {
      const err = new Error('Pending note save failed');
      failures.push(err);
      console.error('Failed flushing pending save:', err);
    }
  }
  if (failures.length > 0) {
    throw failures[0];
  }
}

export class AutosaveCoordinator {
  private pendingEdits = new Map<string, PendingNoteEdit>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private inFlight = new Map<string, Promise<void>>();
  private generations = new Map<string, number>();
  private debounceMs: number;
  private draftStorage: DraftStorage;

  constructor(debounceMs: number = 400, draftStorage: DraftStorage = defaultDraftStorage) {
    this.debounceMs = debounceMs;
    this.draftStorage = draftStorage;
  }

  private saveDraft(draft: PendingNoteEdit): void {
    try { this.draftStorage.setItem(`${DRAFT_WAL_PREFIX}${draft.noteId}`, JSON.stringify(draft)); } catch (err) {
      console.warn(`Failed to save recoverable draft for note ${draft.noteId}:`, err);
    }
  }

  private clearDraft(noteId: string): void {
    try { this.draftStorage.removeItem(`${DRAFT_WAL_PREFIX}${noteId}`); } catch (err) {
      console.warn(`Failed to clear recoverable draft for note ${noteId}:`, err);
    }
  }

  /**
   * Enqueues an operation into the per-note serialization queue.
   * Guarantees that operations for the same note run sequentially in strict FIFO order,
   * preventing concurrent persistence requests from racing or completing out of order.
   */
  public runSerialized<T>(noteId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.inFlight.get(noteId);

    if (!previous) {
      let taskPromise: Promise<T>;
      try {
        taskPromise = task();
      } catch (err) {
        return Promise.reject(err);
      }

      const trackingPromise: Promise<void> = taskPromise
        .catch(() => {})
        .then(() => undefined)
        .finally(() => {
          if (this.inFlight.get(noteId) === trackingPromise) {
            this.inFlight.delete(noteId);
          }
        });

      this.inFlight.set(noteId, trackingPromise);
      return taskPromise;
    }

    let taskResult: T;
    const next = previous
      .catch(() => {})
      .then(async () => {
        taskResult = await task();
      });

    // Track completion without creating a second, unhandled rejection. The
    // promise returned below still reports persistence failures to the caller.
    const trackingPromise = next.catch(() => {}).finally(() => {
      if (this.inFlight.get(noteId) === trackingPromise) {
        this.inFlight.delete(noteId);
      }
    });

    this.inFlight.set(noteId, trackingPromise);

    return next.then(() => taskResult);
  }

  /**
   * Registers a keystroke or edit into the buffer.
   * Cancels previous debounce timer and schedules a serialized flush callback.
   * Returns the new generation counter for this note.
   */
  public enqueue(
    noteId: string,
    title: string,
    bodyMarkdown: string,
    persistFn: (id: string, title: string, bodyMarkdown: string) => Promise<void>
  ): number {
    const nextGen = (this.generations.get(noteId) ?? 0) + 1;
    this.generations.set(noteId, nextGen);

    const edit: PendingNoteEdit = {
      noteId,
      title,
      bodyMarkdown,
      timestamp: Date.now(),
      generation: nextGen,
    };
    this.pendingEdits.set(noteId, edit);
    this.saveDraft(edit);

    const existingTimer = this.timers.get(noteId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.timers.delete(noteId);
      void this.runSerialized(noteId, async () => {
        const pending = this.pendingEdits.get(noteId);
        if (pending) {
          try {
            await persistFn(pending.noteId, pending.title, pending.bodyMarkdown);
            // Only clear if no new edits were enqueued during persist
            const current = this.pendingEdits.get(noteId);
            if (current && current.generation === pending.generation) {
              this.pendingEdits.delete(noteId);
              this.clearDraft(noteId);
            }
          } catch (err) {
            console.error(`Autosave failed for note ${noteId}:`, err);
          }
        }
      });
    }, this.debounceMs);

    this.timers.set(noteId, timer);
    return nextGen;
  }

  /** Persists a replacement immediately while keeping it WAL-recoverable until success. */
  public async replace(
    noteId: string,
    title: string,
    bodyMarkdown: string,
    persistFn: (id: string, title: string, bodyMarkdown: string) => Promise<void>,
  ): Promise<void> {
    const existingTimer = this.timers.get(noteId);
    if (existingTimer) { clearTimeout(existingTimer); this.timers.delete(noteId); }
    const generation = (this.generations.get(noteId) ?? 0) + 1;
    this.generations.set(noteId, generation);
    const edit = { noteId, title, bodyMarkdown, timestamp: Date.now(), generation };
    this.pendingEdits.set(noteId, edit);
    this.saveDraft(edit);
    return this.runSerialized(noteId, async () => {
      await persistFn(noteId, title, bodyMarkdown);
      const current = this.pendingEdits.get(noteId);
      if (current?.generation === generation) { this.pendingEdits.delete(noteId); this.clearDraft(noteId); }
    });
  }

  /**
   * Immediately flushes any pending buffer for a given note through the serialization queue.
   * Awaits any in-flight persistence and then persists the pending buffer.
   * Retains the pending buffer if persistence fails so it can be retried without data loss.
   */
  public async flush(
    noteId: string,
    persistFn: (id: string, title: string, bodyMarkdown: string) => Promise<void>
  ): Promise<void> {
    const existingTimer = this.timers.get(noteId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(noteId);
    }

    return this.runSerialized(noteId, async () => {
      const pending = this.pendingEdits.get(noteId);
      if (pending) {
        // Do not delete pending edit before persistFn succeeds!
        await persistFn(pending.noteId, pending.title, pending.bodyMarkdown);
        const current = this.pendingEdits.get(noteId);
        if (current && current.generation === pending.generation) {
          this.pendingEdits.delete(noteId);
          this.clearDraft(noteId);
        }
      }
    });
  }

  public getGeneration(noteId: string): number {
    return this.generations.get(noteId) ?? 0;
  }

  public hasPending(noteId: string): boolean {
    return this.pendingEdits.has(noteId);
  }

  public hasInFlight(noteId: string): boolean {
    return this.inFlight.has(noteId);
  }

  public isBusy(noteId: string): boolean {
    return this.pendingEdits.has(noteId) || this.inFlight.has(noteId);
  }

  public async waitForInFlight(noteId: string): Promise<void> {
    const current = this.inFlight.get(noteId);
    if (current) {
      await current.catch(() => {});
    }
  }

  public getPending(noteId: string): PendingNoteEdit | undefined {
    return this.pendingEdits.get(noteId);
  }

  public getRecoverableDraft(noteId: string): PendingNoteEdit | null {
    try {
      const raw = this.draftStorage.getItem(`${DRAFT_WAL_PREFIX}${noteId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PendingNoteEdit>;
      if (parsed.noteId === noteId && typeof parsed.title === 'string' && typeof parsed.bodyMarkdown === 'string' &&
          typeof parsed.timestamp === 'number' && typeof parsed.generation === 'number') return parsed as PendingNoteEdit;
    } catch (err) { console.warn(`Failed to read recoverable draft for note ${noteId}:`, err); }
    return null;
  }

  /**
   * Cancels any pending debounced autosave timer and discards buffered edits for a note.
   */
  public cancel(noteId: string, options: { clearRecovery?: boolean } = {}): void {
    const existingTimer = this.timers.get(noteId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(noteId);
    }
    this.pendingEdits.delete(noteId);
    if (options.clearRecovery !== false) {
      this.clearDraft(noteId);
    }
  }

  public clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pendingEdits.clear();
    this.inFlight.clear();
  }
}

/**
 * Compares two note revisions to generate a human-readable diff summary.
 */
export function diffNoteRevisions(
  older: Pick<NoteRevisionRecord, 'title' | 'body_markdown'>,
  newer: Pick<NoteRevisionRecord, 'title' | 'body_markdown'>
): RevisionDiffSummary {
  const titleChanged = older.title !== newer.title;
  const charDelta = newer.body_markdown.length - older.body_markdown.length;

  const oldLines = older.body_markdown.split('\n');
  const newLines = newer.body_markdown.split('\n');

  const oldLineSet = new Set(oldLines);
  const newLineSet = new Set(newLines);

  let addedLines = 0;
  for (const line of newLines) {
    if (!oldLineSet.has(line)) addedLines++;
  }

  let removedLines = 0;
  for (const line of oldLines) {
    if (!newLineSet.has(line)) removedLines++;
  }

  const parts: string[] = [];
  if (titleChanged) parts.push('Title modified');
  if (addedLines > 0) parts.push(`+${addedLines} lines`);
  if (removedLines > 0) parts.push(`-${removedLines} lines`);
  if (parts.length === 0) {
    parts.push(charDelta >= 0 ? `+${charDelta} chars` : `${charDelta} chars`);
  }

  return {
    titleChanged,
    charDelta,
    addedLines,
    removedLines,
    description: parts.join(', '),
  };
}
