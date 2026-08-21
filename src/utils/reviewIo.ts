import { invoke } from '@tauri-apps/api/core';
import type { ReviewPromptRecord } from './promptTypes';
import type { FsrsScheduleState, ReviewOutcome } from './fsrsScheduler';

export interface ReviewEventRecord {
  id: string;
  prompt_id: string;
  reviewed_at: string;
  outcome: ReviewOutcome;
  duration_ms: number;
  user_response: string;
  provenance: 'user_authored';
}

export interface DueReviewPromptRecord {
  prompt: ReviewPromptRecord;
  schedule?: FsrsScheduleState | null;
}

export interface ReviewQueueStats {
  due_count: number;
  adopted_count: number;
  paused_count: number;
}

export async function getDueReviewPrompts(limit = 20): Promise<DueReviewPromptRecord[]> {
  return invoke<DueReviewPromptRecord[]>('db_get_due_review_prompts', { limit });
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

