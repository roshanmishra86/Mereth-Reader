/**
 * Background Jobs Framework & Page Prioritization for Mereth Reader (PRD FR-7.6).
 * Handles visible, cancellable, and restartable background jobs for:
 * 1. Text extraction ('text_extraction')
 * 2. Thumbnail generation ('thumbnail_generation')
 * 3. Full-text search FTS5 indexing ('fts_indexing')
 *
 * Prioritizes page extraction around active reading position (visible page ± window)
 * so reading remains responsive without eagerly processing an entire 400+ page document.
 * Cancelling indexing never corrupts the document record.
 * Strict TypeScript without `any` types.
 */

export type JobType = 'text_extraction' | 'thumbnail_generation' | 'fts_indexing';
export type JobStatus = 'pending' | 'running' | 'paused' | 'cancelled' | 'completed' | 'failed';

export interface BackgroundJob {
  id: string;
  document_id: string;
  job_type: JobType;
  status: JobStatus;
  payload: string; // JSON payload details, e.g. { page_range: [1, 400], active_page: 5 }
  progress_percent: number; // 0 to 100
  processed_pages: number;
  total_pages: number;
  error?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Calculates page processing priority sequence around active reading position (visible page ± window).
 * For a document with totalPages, centered on activePage with windowSize:
 * Returns an array of page numbers (1-indexed) starting with activePage, followed by
 * alternating pages within the window range [activePage - windowSize, activePage + windowSize],
 * then followed by the remaining pages in order.
 */
export function prioritizePageWindow(
  totalPages: number,
  activePage: number,
  windowSize: number = 3
): number[] {
  if (totalPages <= 0) return [];
  const clampedActive = Math.max(1, Math.min(totalPages, activePage));

  const pageSet = new Set<number>();
  const priorityQueue: number[] = [];

  // Add active page first
  priorityQueue.push(clampedActive);
  pageSet.add(clampedActive);

  // Add surrounding pages in window radius
  for (let offset = 1; offset <= windowSize; offset++) {
    const prev = clampedActive - offset;
    const next = clampedActive + offset;

    if (prev >= 1 && !pageSet.has(prev)) {
      priorityQueue.push(prev);
      pageSet.add(prev);
    }
    if (next <= totalPages && !pageSet.has(next)) {
      priorityQueue.push(next);
      pageSet.add(next);
    }
  }

  // Add remaining pages in order
  for (let p = 1; p <= totalPages; p++) {
    if (!pageSet.has(p)) {
      priorityQueue.push(p);
      pageSet.add(p);
    }
  }

  return priorityQueue;
}

/**
 * Creates a new BackgroundJob record.
 */
export function createBackgroundJob(params: {
  id?: string;
  document_id: string;
  job_type: JobType;
  total_pages: number;
  active_page?: number;
}): BackgroundJob {
  const now = new Date().toISOString();
  const activePage = params.active_page ?? 1;
  const pagePriority = prioritizePageWindow(params.total_pages, activePage, 3);

  return {
    id: params.id ?? `job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    document_id: params.document_id,
    job_type: params.job_type,
    status: 'pending',
    payload: JSON.stringify({
      active_page: activePage,
      page_priority: pagePriority,
    }),
    progress_percent: 0,
    processed_pages: 0,
    total_pages: params.total_pages,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Updates job progress as pages are processed. Returns new job state.
 */
export function updateJobProgress(job: BackgroundJob, processedCount: number): BackgroundJob {
  if (job.status === 'cancelled' || job.status === 'failed') {
    return job; // Do not update cancelled or failed job progress
  }

  const newProcessed = Math.min(job.total_pages, Math.max(0, processedCount));
  const progressPercent = job.total_pages > 0 ? Math.round((newProcessed / job.total_pages) * 100) : 100;
  const isComplete = newProcessed >= job.total_pages;

  return {
    ...job,
    status: isComplete ? 'completed' : 'running',
    processed_pages: newProcessed,
    progress_percent: progressPercent,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Cancels a job cleanly without corrupting the document record (PRD FR-7.6).
 * Sets status to 'cancelled' and records error note if provided.
 */
export function cancelBackgroundJob(job: BackgroundJob, reason?: string): BackgroundJob {
  return {
    ...job,
    status: 'cancelled',
    error: reason ?? 'Job cancelled by user',
    updated_at: new Date().toISOString(),
  };
}

/**
 * Restarts a cancelled or failed job from its prior progress state or clean start (PRD FR-7.6).
 */
export function restartBackgroundJob(job: BackgroundJob, newActivePage?: number): BackgroundJob {
  const activePage = newActivePage ?? 1;
  const newPriority = prioritizePageWindow(job.total_pages, activePage, 3);

  return {
    ...job,
    status: 'pending',
    error: undefined,
    payload: JSON.stringify({
      active_page: activePage,
      page_priority: newPriority,
    }),
    updated_at: new Date().toISOString(),
  };
}

/**
 * In-memory Job Queue Manager state tracker.
 */
export class JobQueueManager {
  private jobs: Map<string, BackgroundJob> = new Map();

  public getJobs(): BackgroundJob[] {
    return Array.from(this.jobs.values());
  }

  public getJob(id: string): BackgroundJob | undefined {
    return this.jobs.get(id);
  }

  public enqueueJob(job: BackgroundJob): BackgroundJob {
    const active = { ...job, status: 'running' as JobStatus, updated_at: new Date().toISOString() };
    this.jobs.set(active.id, active);
    return active;
  }

  public cancelJob(id: string, reason?: string): BackgroundJob | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;
    const cancelled = cancelBackgroundJob(existing, reason);
    this.jobs.set(id, cancelled);
    return cancelled;
  }

  public restartJob(id: string, newActivePage?: number): BackgroundJob | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;
    const restarted = restartBackgroundJob(existing, newActivePage);
    this.jobs.set(id, restarted);
    return restarted;
  }

  public updateProgress(id: string, processedCount: number): BackgroundJob | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;
    const updated = updateJobProgress(existing, processedCount);
    this.jobs.set(id, updated);
    return updated;
  }
}
