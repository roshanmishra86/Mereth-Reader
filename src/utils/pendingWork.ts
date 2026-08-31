export type PendingWorkFlusher = () => Promise<void>;

/** Coordinates durable user work that must finish before the updater may exit. */
export class PendingWorkCoordinator {
  private readonly flushers = new Map<string, PendingWorkFlusher>();
  private barrier: Promise<void> | null = null;

  register(id: string, flusher: PendingWorkFlusher): () => void {
    this.flushers.set(id, flusher);
    return () => {
      if (this.flushers.get(id) === flusher) this.flushers.delete(id);
    };
  }

  flushAll(): Promise<void> {
    if (this.barrier) return this.barrier;
    this.barrier = Promise.all([...this.flushers.values()].map((flush) => flush()))
      .then(() => undefined)
      .finally(() => { this.barrier = null; });
    return this.barrier;
  }
}

export const pendingWork = new PendingWorkCoordinator();
