import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as tauriCore from '@tauri-apps/api/core';
import {
  getDueReviewPrompts,
  getDailyReviewUsage,
  getReviewHistory,
  getReviewQueueStats,
  getReviewSchedule,
  recordReviewEvent,
  undoReviewEventIpc,
} from './reviewIo';
import { scheduleReview } from './fsrsScheduler';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('reviewIo IPC wrappers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads due prompts with a limit', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce([]);
    await getDueReviewPrompts(15);
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_get_due_review_prompts', { limit: 15 });
  });

  it('loads a single review schedule by prompt id and cloze index', async () => {
    const schedule = scheduleReview({ promptId: 'p1', outcome: 'good', reviewedAt: new Date('2026-08-21T00:00:00Z'), clozeIndex: 2 }).schedule;
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce(schedule);
    const result = await getReviewSchedule('p1', 2);
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_get_review_schedule', {
      promptId: 'p1',
      clozeIndex: 2,
    });
    expect(result).toEqual(schedule);
  });

  it('requests an uncapped aggregate over local-day UTC boundaries', async () => {
    const day = new Date(2026, 8, 10, 12);
    await getDailyReviewUsage(day);
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_get_daily_review_usage', {
      start: new Date(2026, 8, 10).toISOString(), end: new Date(2026, 8, 11).toISOString(),
    });
  });

  it('records a review event with the next schedule', async () => {
    const schedule = scheduleReview({ promptId: 'p1', outcome: 'good', reviewedAt: new Date('2026-08-21T00:00:00Z') }).schedule;
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce(schedule);
    await recordReviewEvent({
      id: 'e1',
      prompt_id: 'p1',
      reviewed_at: '2026-08-21T00:00:00Z',
      outcome: 'good',
      duration_ms: 1000,
      user_response: 'Typed answer',
      provenance: 'user_authored',
    }, schedule);
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_record_review_event', expect.objectContaining({ schedule }));
  });

  it('loads history and queue stats', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce([]);
    await getReviewHistory('p1');
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_get_review_history', { promptId: 'p1' });

    vi.mocked(tauriCore.invoke).mockResolvedValueOnce({ due_count: 0, adopted_count: 0, paused_count: 0 });
    await getReviewQueueStats();
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_get_review_queue_stats');
  });

  it('invokes db_undo_review_event with eventId, promptId, clozeIndex, and previousSchedule', async () => {
    vi.mocked(tauriCore.invoke).mockResolvedValueOnce(undefined);
    await undoReviewEventIpc('e1', 'p1', null, 2);
    expect(tauriCore.invoke).toHaveBeenCalledWith('db_undo_review_event', {
      eventId: 'e1',
      promptId: 'p1',
      clozeIndex: 2,
      previousSchedule: null,
    });
  });
});

