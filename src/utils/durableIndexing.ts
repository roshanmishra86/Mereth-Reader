/**
 * Durable Application-Level Indexing Service for Mereth Reader.
 *
 * Orchestrates background text extraction independently of individual view lifecycles:
 * - Runs as a persistent application-level singleton across view transitions.
 * - Dynamically reprioritizes extraction as the user scrolls or jumps across pages.
 * - Persists and batches page text writes to avoid per-page React render thrashing.
 * - Pauses extraction cooperatively during rapid user scrolling and navigation.
 * - Broadcasts batch persistence events for progressive search updates.
 * - Persists jobs to SQLite backend via db_add_job / db_update_job.
 * - Strictly typed without `any`.
 */

import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PageTextContent } from './pdfUtils';
import { extractPdfPageTexts, ExtractPagesResult } from './pdfViewer';
import { persistVersionedPageTexts } from './pageTextIo';
import { prioritizePageWindow } from './jobQueue';
import { perfMark } from '../perf/perfMark';

export type IndexingStatus = 'idle' | 'running' | 'paused' | 'done' | 'cancelled' | 'failed';

export interface DurableIndexingState {
  documentId: string;
  versionHash: string;
  jobId: string;
  status: IndexingStatus;
  processedPages: number;
  totalPages: number;
  activePage: number;
  batchVersion: number;
  error?: string;
}

export type DurableIndexingListener = (state: DurableIndexingState) => void;

export interface StartIndexingOptions {
  doc: pdfjsLib.PDFDocumentProxy;
  documentId: string;
  versionHash: string;
  jobId?: string;
  totalPages: number;
  activePage?: number;
  cachedPageNumbers?: ReadonlySet<number>;
  batchSize?: number;
  onJobProgress?: (jobId: string, processed: number) => void;
  onBatchPersist?: (pages: PageTextContent[]) => Promise<void>;
}

export class DurableIndexingService {
  private activeJobs = new Map<string, DurableIndexingState>();
  private runs = new Map<string, {
    id: number;
    controller: AbortController;
    pendingPages: number[];
    visitedPages: Set<number>;
    persistedPages: Set<number>;
  }>();
  private nextRunId = 0;
  private listeners = new Map<string, Set<DurableIndexingListener>>();
  private isUserScrolling = false;
  private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;

  public getState(documentId: string): DurableIndexingState | undefined {
    return this.activeJobs.get(documentId);
  }

  /**
   * Returns true when the service holds state for the document but it was
   * indexed against a different version hash. The caller should cancel and
   * re-index.
   */
  public isStaleVersion(documentId: string, versionHash: string): boolean {
    const state = this.activeJobs.get(documentId);
    return !!state && state.versionHash !== versionHash;
  }

  public subscribe(documentId: string, listener: DurableIndexingListener): () => void {
    let set = this.listeners.get(documentId);
    if (!set) {
      set = new Set();
      this.listeners.set(documentId, set);
    }
    set.add(listener);

    const currentState = this.activeJobs.get(documentId);
    if (currentState) {
      listener(currentState);
    }

    return () => {
      const activeSet = this.listeners.get(documentId);
      if (activeSet) {
        activeSet.delete(listener);
        if (activeSet.size === 0) {
          this.listeners.delete(documentId);
        }
      }
    };
  }

  public notifyScrollActive(timeoutMs = 150): void {
    this.isUserScrolling = true;
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
    }
    this.scrollTimeoutId = setTimeout(() => {
      this.isUserScrolling = false;
      this.scrollTimeoutId = null;
    }, timeoutMs);
  }

  public isScrolling(): boolean {
    return this.isUserScrolling;
  }

  /**
   * Dynamically reorders remaining unextracted pages around the new active reading position.
   */
  public reprioritize(documentId: string, newActivePage: number): void {
    const jobState = this.activeJobs.get(documentId);
    const run = this.runs.get(documentId);
    if (!jobState || jobState.status !== 'running' || !run) return;

    jobState.activePage = newActivePage;
    const totalPages = jobState.totalPages;

    // Exclude every page already handed to pdf.js, including pages buffered for
    // persistence. Persisted-only filtering can enqueue those buffered pages twice.
    run.pendingPages = prioritizePageWindow(totalPages, newActivePage, 3).filter(
      (pageNumber) => !run.visitedPages.has(pageNumber)
    );
  }

  private notify(documentId: string, state: DurableIndexingState): void {
    this.activeJobs.set(documentId, state);
    const set = this.listeners.get(documentId);
    if (set) {
      for (const listener of set) {
        try {
          listener(state);
        } catch {
          // Listeners must not break background worker
        }
      }
    }
  }

  public cancel(documentId: string): void {
    const run = this.runs.get(documentId);
    if (run) {
      run.controller.abort();
      // Removing the run immediately invalidates all late callbacks and cleanup
      // from this generation. A replacement run can now safely use the same id.
      this.runs.delete(documentId);
    }
    const current = this.activeJobs.get(documentId);
    if (current && current.status === 'running') {
      const cancelledState: DurableIndexingState = {
        ...current,
        status: 'cancelled',
      };
      this.notify(documentId, cancelledState);
      void this.persistJobStatus(current.jobId, 'cancelled');
    }
  }

  /**
   * Discards all in-memory job state so a cleared durable cache can be rebuilt
   * even when the previous run had already reached `done`.
   */
  public reset(documentId: string): void {
    // Do not route through cancel(): its fire-and-forget `cancelled` job write
    // could race the replacement run's `running` write for the same job id.
    // Invalidating the generation is enough to make every late callback inert.
    const run = this.runs.get(documentId);
    run?.controller.abort();
    this.runs.delete(documentId);
    this.activeJobs.delete(documentId);
  }

  private async persistJobStatus(
    jobId: string,
    status: 'running' | 'completed' | 'cancelled' | 'failed',
    error?: string,
    payload?: string
  ): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      if (status === 'running' && payload) {
        const now = new Date().toISOString();
        await invoke('db_add_job', {
          job: {
            id: jobId,
            job_type: 'text_extraction',
            status: 'running',
            payload,
            error: null,
            created_at: now,
            updated_at: now,
          },
        });
      } else {
        await invoke('db_update_job', {
          id: jobId,
          status,
          error: error ?? null,
        });
      }
    } catch {
      // Non-Tauri or test environment
    }
  }

  public async startIndexing(options: StartIndexingOptions): Promise<ExtractPagesResult> {
    const {
      doc,
      documentId,
      versionHash,
      jobId = `indexing-${documentId}`,
      totalPages,
      activePage = 1,
      cachedPageNumbers = new Set<number>(),
      batchSize = 16,
      onJobProgress,
      onBatchPersist,
    } = options;

    // Invalidate an older generation before installing this one. Its late
    // completion must never overwrite or clean up the replacement run.
    this.cancel(documentId);
    const runId = ++this.nextRunId;
    const controller = new AbortController();
    const persistedPages = new Set<number>(cachedPageNumbers);
    const visitedPages = new Set<number>(cachedPageNumbers);
    const run = {
      id: runId,
      controller,
      pendingPages: prioritizePageWindow(totalPages, activePage, 3).filter(
        (pageNumber) => !visitedPages.has(pageNumber)
      ),
      visitedPages,
      persistedPages,
    };
    this.runs.set(documentId, run);
    const isCurrentRun = () => this.runs.get(documentId)?.id === runId;

    // If all pages are already cached, mark done immediately.
    if (cachedPageNumbers.size >= totalPages && totalPages > 0) {
      const completedState: DurableIndexingState = {
        documentId,
        versionHash,
        jobId,
        status: 'done',
        processedPages: totalPages,
        totalPages,
        activePage,
        batchVersion: 1,
      };
      this.notify(documentId, completedState);
      this.runs.delete(documentId);
      if (jobId) onJobProgress?.(jobId, totalPages);
      await this.persistJobStatus(jobId, 'completed');
      return { pages: [], completed: true, failedPageNumbers: [] };
    }

    let currentBatchVersion = 0;
    const initialState: DurableIndexingState = {
      documentId,
      versionHash,
      jobId,
      status: 'running',
      processedPages: cachedPageNumbers.size,
      totalPages,
      activePage,
      batchVersion: currentBatchVersion,
    };
    this.notify(documentId, initialState);

    await this.persistJobStatus(
      jobId,
      'running',
      undefined,
      JSON.stringify({ documentId, versionHash, totalPages, activePage })
    );

    const writeBatch: PageTextContent[] = [];
    const failedPersistPages = new Set<number>();
    const flushBatch = async () => {
      if (writeBatch.length === 0) return;
      const pending = writeBatch.splice(0, writeBatch.length);
      try {
        if (onBatchPersist) {
          await onBatchPersist(pending);
        } else {
          await persistVersionedPageTexts(documentId, versionHash, pending);
        }
        // Progress represents durable pages, not merely visited pages.
        for (const page of pending) {
          persistedPages.add(page.pageNumber);
        }
        if (!isCurrentRun()) return;
        currentBatchVersion++;
        const current = this.activeJobs.get(documentId);
        if (current) {
          this.notify(documentId, {
            ...current,
            processedPages: persistedPages.size,
            batchVersion: currentBatchVersion,
          });
        }
      } catch {
        // Track pages whose persistence failed for honest completion reporting
        for (const page of pending) {
          failedPersistPages.add(page.pageNumber);
        }
      }
    };

    try {
      const result = await extractPdfPageTexts(doc, {
        signal: controller.signal,
        // Pages are durably persisted in bounded batches below. Returning a
        // second document-sized array would retain all extracted text until
        // indexing completes and defeats batching for large PDFs.
        retainPages: false,
        cacheExtractedPages: false,
        skipPageNumbers: cachedPageNumbers,
        yieldEveryPages: 2,
        shouldPause: () => this.isUserScrolling,
        getNextPageNumber: () => {
          if (!isCurrentRun()) return null;
          const pageNumber = run.pendingPages.shift() ?? null;
          if (pageNumber !== null) run.visitedPages.add(pageNumber);
          return pageNumber;
        },
        onPage: async (page) => {
          if (!isCurrentRun()) return;
          writeBatch.push(page);
          if (writeBatch.length >= batchSize) {
            await flushBatch();
          }
        },
        onProgress: (processed, total) => {
          perfMark(`extract.progress:${processed}:${total}`);
          if (!isCurrentRun()) return;
          const current = this.activeJobs.get(documentId);
          if (current && current.status === 'running') {
            this.notify(documentId, {
              ...current,
              processedPages: persistedPages.size,
            });
          }
          if (jobId && (processed % 5 === 0 || processed === total)) {
            onJobProgress?.(jobId, persistedPages.size);
          }
        },
      });

      await flushBatch();

      if (!isCurrentRun()) return result;

      const finalStatus: IndexingStatus =
        failedPersistPages.size > 0 ? 'failed' :
        result.completed ? 'done' : 'cancelled';
      const finalState: DurableIndexingState = {
        documentId,
        versionHash,
        jobId,
        status: finalStatus,
        processedPages: persistedPages.size,
        totalPages,
        activePage,
        batchVersion: currentBatchVersion,
        error: failedPersistPages.size > 0
          ? `${failedPersistPages.size} page(s) failed to persist`
          : undefined,
      };
      this.notify(documentId, finalState);
      this.runs.delete(documentId);

      const persistStatus = failedPersistPages.size > 0 ? 'failed' as const
        : result.completed ? 'completed' as const : 'cancelled' as const;
      await this.persistJobStatus(
        jobId,
        persistStatus,
        failedPersistPages.size > 0 ? `${failedPersistPages.size} page(s) failed to persist` : undefined,
      );

      return result;
    } catch (err) {
      await flushBatch();
      if (!isCurrentRun()) {
        return { pages: [], completed: false, failedPageNumbers: [] };
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isAbort = controller.signal.aborted;
      const failedState: DurableIndexingState = {
        documentId,
        versionHash,
        jobId,
        status: isAbort ? 'cancelled' : 'failed',
        processedPages: this.activeJobs.get(documentId)?.processedPages ?? 0,
        totalPages,
        activePage,
        batchVersion: currentBatchVersion,
        error: errorMessage,
      };
      this.notify(documentId, failedState);
      this.runs.delete(documentId);

      await this.persistJobStatus(jobId, isAbort ? 'cancelled' : 'failed', errorMessage);
      return { pages: [], completed: false, failedPageNumbers: [] };
    }
  }
}

export const durableIndexer = new DurableIndexingService();
