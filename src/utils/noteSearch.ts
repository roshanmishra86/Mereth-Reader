/**
 * Task 4.3 — Note full-text search with text role identification (PRD R3, FR-10.9).
 */

import { invoke } from '@tauri-apps/api/core';

export type TextRole = 'title' | 'prose' | 'evidence_quote' | 'evidence_comment' | 'tag';

export interface NoteSearchResult {
  note_id: string;
  note_title: string;
  note_type: string;
  text_role: TextRole;
  matched_text: string;
  snippet: string;
}

export function roleLabel(role: TextRole): string {
  switch (role) {
    case 'title':
      return 'Title';
    case 'prose':
      return 'Prose';
    case 'evidence_quote':
      return 'Source Quote';
    case 'evidence_comment':
      return 'Comment';
    case 'tag':
      return 'Tag';
  }
}

export function roleBadgeClass(role: TextRole): string {
  switch (role) {
    case 'title':
      return 'badge-role-title';
    case 'prose':
      return 'badge-role-prose';
    case 'evidence_quote':
      return 'badge-role-quote';
    case 'evidence_comment':
      return 'badge-role-comment';
    case 'tag':
      return 'badge-role-tag';
  }
}

export function filterSearchResultsByRole(
  results: NoteSearchResult[],
  roles: TextRole[]
): NoteSearchResult[] {
  if (roles.length === 0) return results;
  const roleSet = new Set(roles);
  return results.filter((r) => roleSet.has(r.text_role));
}

export async function searchNotes(
  query: string,
  noteType?: string
): Promise<NoteSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return invoke<NoteSearchResult[]>('db_search_notes', {
    query: trimmed,
    noteType: noteType || null,
  });
}
