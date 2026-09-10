import { invoke } from '@tauri-apps/api/core';
import type { ReviewPromptRecord } from './promptTypes';
import type { FsrsScheduleState, ReviewOutcome } from './fsrsScheduler';

export interface ReviewEventRecord {
  id: string;
  prompt_id: string;
  cloze_index?: number;
  reviewed_at: string;
  outcome: ReviewOutcome;
  duration_ms: number;
  user_response: string;
  provenance: 'user_authored';
}

export interface DueReviewPromptRecord {
  prompt: ReviewPromptRecord;
  schedule?: FsrsScheduleState | null;
  /** Identity is present even when this variant has never been scheduled. */
  cloze_index?: number;
}

export interface DailyReviewUsage { completed_cards: number; duration_ms: number }

export async function getDailyReviewUsage(now = new Date()): Promise<DailyReviewUsage> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return invoke<DailyReviewUsage>('db_get_daily_review_usage', {
    start: start.toISOString(), end: end.toISOString(),
  });
}

export interface ReviewQueueStats {
  due_count: number;
  adopted_count: number;
  paused_count: number;
}

export async function getDueReviewPrompts(limit = 20): Promise<DueReviewPromptRecord[]> {
  return invoke<DueReviewPromptRecord[]>('db_get_due_review_prompts', { limit });
}

export async function getReviewSchedule(
  promptId: string,
  clozeIndex?: number
): Promise<FsrsScheduleState | null> {
  return invoke<FsrsScheduleState | null>('db_get_review_schedule', {
    promptId,
    clozeIndex: clozeIndex ?? 0,
  });
}

export async function recordReviewEvent(
  event: ReviewEventRecord,
  schedule: FsrsScheduleState
): Promise<FsrsScheduleState> {
  return invoke<FsrsScheduleState>('db_record_review_event', { event, schedule });
}

export async function getReviewHistory(promptId: string): Promise<ReviewEventRecord[]> {
  return invoke<ReviewEventRecord[]>('db_get_review_history', { promptId });
}

export async function getReviewQueueStats(): Promise<ReviewQueueStats> {
  return invoke<ReviewQueueStats>('db_get_review_queue_stats');
}

/** U19: recent review events across all prompts, newest first. */
export interface RecentReviewEventRecord extends ReviewEventRecord {
  prompt_question: string;
}

export async function getRecentReviewEvents(limit = 50): Promise<RecentReviewEventRecord[]> {
  return invoke<RecentReviewEventRecord[]>('db_get_recent_review_events', { limit });
}

export async function undoReviewEventIpc(
  eventId: string,
  promptId: string,
  previousSchedule: FsrsScheduleState | null,
  clozeIndex?: number
): Promise<void> {
  return invoke<void>('db_undo_review_event', {
    eventId,
    promptId,
    clozeIndex: clozeIndex ?? 0,
    previousSchedule,
  });
}

