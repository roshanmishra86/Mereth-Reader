import { performance } from 'node:perf_hooks';
import { calculateDailyBudget } from './queueControls';
import { createJsonBackupArchive, createMarkdownPackageManifest, serializeJsonBackupArchive, serializeMarkdownPackageManifest } from './exportManifest';
import { scheduleReview } from './fsrsScheduler';
import { AutosaveCoordinator, diffNoteRevisions, getRecoverableDraft, getRecoverableDraftStorageScope } from './noteRevisions';

export interface R3R4GateReport {
  autosaveMedianMs: number;
  noteSearchMedianMs: number;
  exportMedianMs: number;
  backupMedianMs: number;
  fsrsMedianMs: number;
  cancellationSafe: boolean;
  recoverySafe: boolean;
  /** The WAL is restart-durable only when browser localStorage is available. */
  recoveryScope: 'browser-localStorage' | 'node-process-memory';
  persistenceScope: 'browser-localStorage' | 'node-process-memory';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const nodeBenchmarkStore = new Map<string, string>();

function writeBenchmarkRecord(key: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, serialized);
  else nodeBenchmarkStore.set(key, serialized);
}

function removeBenchmarkRecord(key: string): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  else nodeBenchmarkStore.delete(key);
}

function readBenchmarkRecord(key: string): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : nodeBenchmarkStore.get(key) ?? null;
}

function measure(fn: () => void, runs = 25): number {
  const values: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    values.push(performance.now() - start);
  }
  return median(values);
}

/**
 * Asserts real WAL recovery behavior via getRecoverableDraft:
 * Enqueues a draft into AutosaveCoordinator, asserts getRecoverableDraft returns the unpersisted draft,
 * and asserts that flushing clears it.
 */
export async function assertWalRecovery(): Promise<boolean> {
  const coordinator = new AutosaveCoordinator(1000);
  const noteId = `wal-recovery-gate-${Date.now()}`;
  const persistedKey = `mereth_gate_persisted:${noteId}`;
  const persist = async (id: string, title: string, bodyMarkdown: string): Promise<void> => {
    writeBenchmarkRecord(persistedKey, { id, title, bodyMarkdown });
  };
  coordinator.enqueue(noteId, 'WAL Benchmark Draft', 'WAL draft content before flush', persist);
  // A fresh coordinator models an app restart. In Node the fallback is process
  // memory, so the scope is reported honestly rather than called durable.
  coordinator.clearAll();
  const unpersisted = getRecoverableDraft(noteId);
  const hasUnpersisted = unpersisted !== null && unpersisted.title === 'WAL Benchmark Draft';
  const restarted = new AutosaveCoordinator(1000);
  if (unpersisted) restarted.enqueue(noteId, unpersisted.title, unpersisted.bodyMarkdown, persist);
  await restarted.flush(noteId, persist);
  const cleared = getRecoverableDraft(noteId) === null;
  const persisted = readBenchmarkRecord(persistedKey);
  const persistedReplacement = persisted !== null && JSON.parse(persisted).bodyMarkdown === 'WAL draft content before flush';
  removeBenchmarkRecord(persistedKey);
  return hasUnpersisted && cleared && persistedReplacement;
}

async function measureAsync(fn: () => Promise<void>, runs = 25): Promise<number> {
  const values: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    await fn();
    values.push(performance.now() - start);
  }
  return median(values);
}

export async function runR3R4RecoveryGate(): Promise<R3R4GateReport> {
  const noteCorpus = Array.from({ length: 1000 }, (_, index) => `note ${index} retrieval practice source excerpt comment tag`);
  const recoverySafe = await assertWalRecovery();
  const persistenceScope = getRecoverableDraftStorageScope();
  return {
    autosaveMedianMs: await measureAsync(async () => {
      const coordinator = new AutosaveCoordinator(1000);
      const key = `mereth_gate_benchmark:${Date.now()}:${Math.random()}`;
      const persist = async (id: string, title: string, bodyMarkdown: string): Promise<void> => {
        writeBenchmarkRecord(key, { id, title, bodyMarkdown });
      };
      // Measure the real persistence operation, not a noop callback.
      coordinator.enqueue('note-gate-1', 'Updated Title', '## Section\nUpdated body content for benchmark', persist);
      await coordinator.flush('note-gate-1', persist);
      diffNoteRevisions(
        { title: 'Original Title', body_markdown: '## Section\nOriginal body content' },
        { title: 'Updated Title', body_markdown: '## Section\nUpdated body content for benchmark' },
      );
      coordinator.clearAll();
      removeBenchmarkRecord(key);
    }),
    noteSearchMedianMs: measure(() => {
      noteCorpus.filter((note) => note.includes('retrieval'));
    }),
    exportMedianMs: measure(() => {
      serializeMarkdownPackageManifest(createMarkdownPackageManifest({ notes: [{ id: 'n1', path: 'notes/n1.md', kind: 'markdown' }] }));
    }),
    backupMedianMs: measure(() => {
      serializeJsonBackupArchive(createJsonBackupArchive({
        documents: [], annotations: [], assets: [], notes: [], note_revisions: [], links: [],
        prompts: [], review_events: [], review_schedules: [], settings: {}, provenance: {},
      }));
    }),
    fsrsMedianMs: measure(() => {
      scheduleReview({ promptId: 'p1', outcome: 'good', reviewedAt: new Date('2026-08-21T00:00:00Z') });
    }),
    cancellationSafe: calculateDailyBudget({ dailyCardLimit: 0, dailyTimeLimitMinutes: 0, queuePaused: false }, { completedCards: 1, elapsedSeconds: 1 }).backlogRemainsDue,
    recoverySafe,
    recoveryScope: getRecoverableDraftStorageScope(),
    persistenceScope,
  };
}

export function assertR3R4RecoveryGate(report: R3R4GateReport): void {
  if (report.autosaveMedianMs > 50) throw new Error('Autosave gate exceeded 50 ms median.');
  if (report.noteSearchMedianMs > 300) throw new Error('Note search gate exceeded 300 ms median.');
  if (report.exportMedianMs > 300) throw new Error('Export gate exceeded 300 ms median.');
  if (report.backupMedianMs > 300) throw new Error('Backup gate exceeded 300 ms median.');
  if (report.fsrsMedianMs > 50) throw new Error('FSRS gate exceeded 50 ms median.');
  if (!report.cancellationSafe || !report.recoverySafe) throw new Error('Recovery/cancellation gate failed.');
}
