/**
 * Task 4.2 — Typed IPC client for note evidence blocks (PRD R3, FR-10.1, FR-10.2).
 */

import { invoke } from '@tauri-apps/api/core';
import type { EvidenceBlockRecord } from './evidenceTypes';

export async function addEvidenceBlock(
  block: EvidenceBlockRecord
): Promise<EvidenceBlockRecord> {
  return await invoke<EvidenceBlockRecord>('db_add_evidence_block', { block });
}

export async function getNoteEvidenceBlocks(
  noteId: string
): Promise<EvidenceBlockRecord[]> {
  return await invoke<EvidenceBlockRecord[]>('db_get_note_evidence_blocks', { noteId });
}

export async function updateEvidenceBlockOrder(
  noteId: string,
  blockIds: string[]
): Promise<void> {
  await invoke<void>('db_update_evidence_block_order', { noteId, blockIds });
}

export async function updateEvidenceBlockComment(
  id: string,
  userComment: string
): Promise<void> {
  await invoke<void>('db_update_evidence_block_comment', { id, userComment });
}

export async function deleteEvidenceBlock(id: string): Promise<void> {
  await invoke<void>('db_delete_evidence_block', { id });
}
