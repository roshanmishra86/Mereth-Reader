/**
 * Task 3.5 — in-session undo for annotation actions (PRD FR-9.8).
 *
 * Create, edit (colour/comment/tags), and deletion (trash) are undoable
 * within the current session. This manager records the minimal inverse
 * information per action:
 *
 * - create: inverse is trash (the created row moves to the recoverable
 *   trash — never silent destruction);
 * - edit: inverse restores the previous colour/comment/tags (the quote and
 *   anchors are immutable by design, FR-9.5);
 * - trash: inverse is restore (back to active).
 *
 * The stack is bounded (FIFO eviction) so a long reading session cannot grow
 * memory without limit. The manager is pure — the actual IPC application of
 * an action's inverse lives in the app layer.
 */

export type AnnotationUndoAction =
  | { kind: 'create'; annotationId: string }
  | {
      kind: 'edit';
      annotationId: string;
      previous: { color: string; comment: string; tags: string[] };
    }
  | { kind: 'trash'; annotationId: string };

export interface AnnotationUndoManagerOptions {
  /** Maximum actions kept. Oldest are evicted first. */
  limit?: number;
}

export class AnnotationUndoManager {
  private stack: AnnotationUndoAction[] = [];
  readonly limit: number;

  constructor(options: AnnotationUndoManagerOptions = {}) {
    this.limit = Math.max(1, options.limit ?? 50);
  }

  get canUndo(): boolean {
    return this.stack.length > 0;
  }

  get size(): number {
    return this.stack.length;
  }

  push(action: AnnotationUndoAction): void {
    this.stack.push(action);
    if (this.stack.length > this.limit) {
      this.stack.shift();
    }
  }

  pushCreate(annotationId: string): void {
    this.push({ kind: 'create', annotationId });
  }

  pushEdit(
    annotationId: string,
    previous: { color: string; comment: string; tags: string[] }
  ): void {
    this.push({ kind: 'edit', annotationId, previous });
  }

  pushTrash(annotationId: string): void {
    this.push({ kind: 'trash', annotationId });
  }

  peek(): AnnotationUndoAction | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  pop(): AnnotationUndoAction | null {
    return this.stack.pop() ?? null;
  }

  /** Re-push after a failed inverse application so the action is retryable. */
  replay(action: AnnotationUndoAction): void {
    this.push(action);
  }

  clear(): void {
    this.stack = [];
  }
}
