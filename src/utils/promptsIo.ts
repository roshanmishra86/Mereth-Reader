/**
 * Task 4.4 — Tauri IPC Bridge for Review Prompts (PRD R4, FR-11.1 - FR-11.5).
 */

import { invoke } from '@tauri-apps/api/core';
import type { ReviewPromptRecord, PromptStatus } from './promptTypes';

export async function createReviewPrompt(prompt: ReviewPromptRecord): Promise<ReviewPromptRecord> {
  return invoke<ReviewPromptRecord>('db_create_review_prompt', { prompt });
}

export async function getReviewPrompt(id: string): Promise<ReviewPromptRecord | null> {
  return invoke<ReviewPromptRecord | null>('db_get_review_prompt', { id });
}

export async function listReviewPrompts(statusFilter?: PromptStatus): Promise<ReviewPromptRecord[]> {
  return invoke<ReviewPromptRecord[]>('db_list_review_prompts', {
    statusFilter: statusFilter || null,
  });
}

export async function listPromptsForSource(
  annotationId?: string | null,
  noteId?: string | null
): Promise<ReviewPromptRecord[]> {
  return invoke<ReviewPromptRecord[]>('db_list_prompts_for_source', {
    annotationId: annotationId || null,
    noteId: noteId || null,
  });
}

export async function updateReviewPrompt(prompt: ReviewPromptRecord): Promise<ReviewPromptRecord> {
  return invoke<ReviewPromptRecord>('db_update_review_prompt', { prompt });
}

export async function adoptReviewPrompt(id: string): Promise<ReviewPromptRecord> {
  return invoke<ReviewPromptRecord>('db_adopt_review_prompt', { id });
}

export async function retireReviewPrompt(id: string): Promise<ReviewPromptRecord> {
  return invoke<ReviewPromptRecord>('db_retire_review_prompt', { id });
}

export async function deleteReviewPrompt(id: string): Promise<void> {
  return invoke<void>('db_delete_review_prompt', { id });
}
