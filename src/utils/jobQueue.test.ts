import { describe, it, expect } from 'vitest';
import {
  prioritizePageWindow,
  createBackgroundJob,
  updateJobProgress,
  cancelBackgroundJob,
  restartBackgroundJob,
  JobQueueManager,
} from './jobQueue';

describe('jobQueue', () => {
  it('prioritizes page extraction window around active reading position (visible page ± window)', () => {
    // For a 400 page document centered at active page 50 with window size 3:
    // Should prioritize page 50 first, then surrounding window [47..53], then remaining pages up to 400.
    const priorityList = prioritizePageWindow(400, 50, 3);

    expect(priorityList.length).toBe(400);
    expect(priorityList[0]).toBe(50); // Active page first!

    // Surrounding window pages 49, 51, 48, 52, 47, 53 should appear in top 7
    const top7 = priorityList.slice(0, 7);
    expect(top7).toContain(50);
    expect(top7).toContain(49);
    expect(top7).toContain(51);
    expect(top7).toContain(48);
    expect(top7).toContain(52);
    expect(top7).toContain(47);
    expect(top7).toContain(53);

    // Remaining pages fill out up to page 400
    expect(priorityList[399]).toBe(400);
  });

  it('creates background job with initial pending status and payload priority', () => {
    const job = createBackgroundJob({
      document_id: 'doc-400-pages',
      job_type: 'text_extraction',
      total_pages: 400,
      active_page: 25,
    });

    expect(job.status).toBe('pending');
    expect(job.total_pages).toBe(400);
    expect(job.progress_percent).toBe(0);

    const payload = JSON.parse(job.payload);
    expect(payload.active_page).toBe(25);
    expect(payload.page_priority[0]).toBe(25);
  });

  it('updates job progress accurately and completes when all pages are processed', () => {
    let job = createBackgroundJob({
      document_id: 'doc-10',
      job_type: 'thumbnail_generation',
      total_pages: 10,
    });

    job = updateJobProgress(job, 5);
    expect(job.status).toBe('running');
    expect(job.progress_percent).toBe(50);

    job = updateJobProgress(job, 10);
    expect(job.status).toBe('completed');
    expect(job.progress_percent).toBe(100);
  });

  it('cancelling job never corrupts state and transitions to cancelled status', () => {
    const job = createBackgroundJob({
      document_id: 'doc-fts',
      job_type: 'fts_indexing',
      total_pages: 100,
    });

    const cancelledJob = cancelBackgroundJob(job, 'User requested stop during indexing');
    expect(cancelledJob.status).toBe('cancelled');
    expect(cancelledJob.error).toBe('User requested stop during indexing');

    // Updating progress on a cancelled job does nothing
    const noProgressUpdate = updateJobProgress(cancelledJob, 50);
    expect(noProgressUpdate.status).toBe('cancelled');
  });

  it('restarts cancelled job cleanly', () => {
    let job = createBackgroundJob({
      document_id: 'doc-fts',
      job_type: 'fts_indexing',
      total_pages: 100,
    });

    job = cancelBackgroundJob(job);
    expect(job.status).toBe('cancelled');

    const restarted = restartBackgroundJob(job, 10);
    expect(restarted.status).toBe('pending');
    expect(restarted.error).toBeUndefined();
    const payload = JSON.parse(restarted.payload);
    expect(payload.active_page).toBe(10);
  });

  it('JobQueueManager manages enqueuing, progress updates, cancelling, and restarting jobs', () => {
    const queue = new JobQueueManager();
    const job = createBackgroundJob({
      document_id: 'doc-queue',
      job_type: 'text_extraction',
      total_pages: 20,
    });

    const enqueued = queue.enqueueJob(job);
    expect(enqueued.status).toBe('running');

    queue.updateProgress(job.id, 10);
    expect(queue.getJob(job.id)?.progress_percent).toBe(50);

    queue.cancelJob(job.id);
    expect(queue.getJob(job.id)?.status).toBe('cancelled');

    queue.restartJob(job.id);
    expect(queue.getJob(job.id)?.status).toBe('pending');
  });
});
