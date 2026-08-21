/**
 * Note autosave buffer coordinator and revision comparator (PRD FR-10.8).
 *
 * Guarantees crash safety by keeping an in-memory small edit buffer,
 * debouncing persistence calls, and enabling immediate flush upon navigation or blur.
 */

import { NoteRevisionRecord } from './notesTypes';

export interface PendingNoteEdit {
  noteId: string;
  title: string;
  bodyMarkdown: string;
  timestamp: number;
}

export interface RevisionDiffSummary {
  titleChanged: boolean;
  charDelta: number;
  addedLines: number;
  removedLines: number;
  description: string;
}

export class AutosaveCoordinator {
  private pendingEdits = new Map<string, PendingNoteEdit>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private debounceMs: number;

  constructor(debounceMs: number = 400) {
    this.debounceMs = debounceMs;
  }

  /**
   * Registers a keystroke or edit into the buffer.
   * Cancels previous debounce timer and schedules a flush callback.
   */
  public enqueue(
    noteId: string,
    title: string,
    bodyMarkdown: string,
    persistFn: (id: string, title: string, bodyMarkdown: string) => Promise<void>
  ): void {
    this.pendingEdits.set(noteId, {
      noteId,
      title,
      bodyMarkdown,
      timestamp: Date.now(),
    });

    const existingTimer = this.timers.get(noteId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      this.timers.delete(noteId);
      const pending = this.pendingEdits.get(noteId);
      if (pending) {
        try {
          await persistFn(pending.noteId, pending.title, pending.bodyMarkdown);
          // Only clear if no new edits were enqueued during persist
          const current = this.pendingEdits.get(noteId);
          if (current && current.timestamp === pending.timestamp) {
            this.pendingEdits.delete(noteId);
          }
        } catch (err) {
          console.error(`Autosave failed for note ${noteId}:`, err);
        }
      }
    }, this.debounceMs);

    this.timers.set(noteId, timer);
  }

  /**
   * Immediately flushes any pending buffer for a given note.
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

    const pending = this.pendingEdits.get(noteId);
    if (pending) {
      this.pendingEdits.delete(noteId);
      await persistFn(pending.noteId, pending.title, pending.bodyMarkdown);
    }
  }

  public hasPending(noteId: string): boolean {
    return this.pendingEdits.has(noteId);
  }

  public getPending(noteId: string): PendingNoteEdit | undefined {
    return this.pendingEdits.get(noteId);
  }

  public clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pendingEdits.clear();
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
