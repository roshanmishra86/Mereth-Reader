/**
 * Task 4.1 — Typed IPC bridge for notes and revisions (PRD §15.3).
 *
 * All note and revision persistence routes pass through these typed functions.
 * No SQL queries or unsafe data strings cross into the webview.
 */

import { invoke } from '@tauri-apps/api/core';
import { NoteRecord, NoteRevisionRecord, NoteType } from './notesTypes';
import type { NoteLinkRecord } from './noteLinks';

export async function createNote(note: NoteRecord): Promise<NoteRecord> {
  return await invoke<NoteRecord>('db_add_note', { note });
}

export async function getNote(id: string): Promise<NoteRecord | null> {
  return await invoke<NoteRecord | null>('db_get_note', { id });
}

export async function listNotes(options?: {
  includeTrash?: boolean;
  noteType?: NoteType;
  documentId?: string;
}): Promise<NoteRecord[]> {
  const rows = await invoke<NoteRecord[]>('db_list_notes', {
    includeTrash: options?.includeTrash ?? false,
    noteType: options?.noteType ?? null,
    documentId: options?.documentId ?? null,
  });
  return rows ?? [];
}

export async function updateNote(
  id: string,
  title: string,
  bodyMarkdown: string,
  createRevision: boolean = true
): Promise<NoteRecord> {
  return await invoke<NoteRecord>('db_update_note', {
    id,
    title,
    bodyMarkdown,
    createRevision,
  });
}

export async function trashNote(id: string): Promise<void> {
  await invoke('db_trash_note', { id });
}

export async function restoreNote(id: string): Promise<void> {
  await invoke('db_restore_note', { id });
}

export async function purgeNote(id: string): Promise<void> {
  await invoke('db_purge_note', { id });
}

export async function getNoteRevisions(noteId: string): Promise<NoteRevisionRecord[]> {
  const rows = await invoke<NoteRevisionRecord[]>('db_get_note_revisions', { noteId });
  return rows ?? [];
}

export async function restoreNoteRevision(
  noteId: string,
  revisionNumber: number
): Promise<NoteRecord> {
  return await invoke<NoteRecord>('db_restore_note_revision', {
    noteId,
    revisionNumber,
  });
}

export async function promoteScratchNote(
  id: string,
  targetType: 'concept' | 'source',
  documentId?: string
): Promise<NoteRecord> {
  return await invoke<NoteRecord>('db_promote_scratch_note', {
    id,
    targetType,
    documentId: documentId ?? null,
  });
}

export async function splitNoteTransaction(input: {
  originalId: string;
  originalTitle: string;
  originalBody: string;
  newNote: NoteRecord;
  link: NoteLinkRecord;
}): Promise<{ original_note: NoteRecord; new_note: NoteRecord }> {
  return invoke('db_split_note_transaction', input);
}
