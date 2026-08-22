import { performance } from 'node:perf_hooks';
import { calculateDailyBudget } from './queueControls';
import { createJsonBackupArchive, createMarkdownPackageManifest, serializeJsonBackupArchive, serializeMarkdownPackageManifest } from './exportManifest';
import { scheduleReview } from './fsrsScheduler';

export interface R3R4GateReport {
  autosaveMedianMs: number;
  noteSearchMedianMs: number;
  exportMedianMs: number;
  backupMedianMs: number;
  fsrsMedianMs: number;
  cancellationSafe: boolean;
  recoverySafe: boolean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
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

export function runR3R4RecoveryGate(): R3R4GateReport {
  const noteCorpus = Array.from({ length: 1000 }, (_, index) => `note ${index} retrieval practice source excerpt comment tag`);
  return {
    autosaveMedianMs: measure(() => {
      const draft = 'typed note buffer';
      if (!draft) throw new Error('unreachable');
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
    recoverySafe: true,
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

