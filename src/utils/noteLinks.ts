/**
 * Task 4.3 — Note links, backlinks, and wiki-link resolution (PRD R3, FR-10.5, FR-10.10).
 *
 * Links are keyed on stable UUIDs rather than mutable titles so renaming notes
 * preserves every link without broken references.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Provenance } from './evidenceTypes';

export interface NoteLinkRecord {
  id: string;
  note_id: string;
  target_note_id?: string | null;
  target_document_id?: string | null;
  target_annotation_id?: string | null;
  created_at: string;
  provenance: Provenance;
  original_provenance?: string | null;
}

export interface BacklinkRecord {
  link_id: string;
  source_note_id: string;
  source_note_title: string;
  source_note_type: string;
  created_at: string;
}

export interface ParsedWikiLinks {
  targetNoteIds: string[];
  targetDocIds: string[];
  targetAnnIds: string[];
}

/**
 * Regex for Mereth wiki-links:
 * Format 1: [[mereth:note/<id>|<display>]] or [[mereth:note/<id>]]
 * Format 2: [[mereth:doc/<id>|<display>]] or [[mereth:doc/<id>]]
 * Format 3: [[mereth:ann/<id>|<display>]] or [[mereth:ann/<id>]]
 */
const WIKI_LINK_REGEX = /\[\[mereth:(note|doc|ann)\/([a-zA-Z0-9_-]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Extracts target IDs from Markdown body.
 */
export function extractWikiLinks(markdown: string): ParsedWikiLinks {
  const targetNoteIds = new Set<string>();
  const targetDocIds = new Set<string>();
  const targetAnnIds = new Set<string>();

  let match: RegExpExecArray | null;
  const regex = new RegExp(WIKI_LINK_REGEX);
  while ((match = regex.exec(markdown)) !== null) {
    const kind = match[1];
    const id = match[2];
    if (kind === 'note') {
      targetNoteIds.add(id);
    } else if (kind === 'doc') {
      targetDocIds.add(id);
    } else if (kind === 'ann') {
      targetAnnIds.add(id);
    }
  }

  return {
    targetNoteIds: Array.from(targetNoteIds),
    targetDocIds: Array.from(targetDocIds),
    targetAnnIds: Array.from(targetAnnIds),
  };
}

/**
 * Formats a wiki-link string with an optional custom label.
 */
export function formatWikiLink(kind: 'note' | 'doc' | 'ann', id: string, label?: string): string {
  if (label && label.trim().length > 0) {
    return `[[mereth:${kind}/${id}|${label.trim()}]]`;
  }
  return `[[mereth:${kind}/${id}]]`;
}

/**
 * Replaces raw UUID links with readable display titles for presentation.
 */
export function renderWikiLinks(
  markdown: string,
  resolveTitle: (kind: 'note' | 'doc' | 'ann', id: string) => string | null
): string {
  return markdown.replace(WIKI_LINK_REGEX, (_match, kind, id, customLabel) => {
    if (customLabel) return customLabel;
    const resolved = resolveTitle(kind as 'note' | 'doc' | 'ann', id);
    return resolved ?? `[${kind}:${id}]`;
  });
}

// ---------------- IPC Wrappers ----------------

export async function addNoteLink(link: NoteLinkRecord): Promise<NoteLinkRecord> {
  return invoke<NoteLinkRecord>('db_add_note_link', { link });
}

export async function getForwardLinks(noteId: string): Promise<NoteLinkRecord[]> {
  return invoke<NoteLinkRecord[]>('db_get_forward_links', { noteId });
}

export async function getNoteBacklinks(targetNoteId: string): Promise<BacklinkRecord[]> {
  return invoke<BacklinkRecord[]>('db_get_note_backlinks', { targetNoteId });
}

export async function syncNoteLinks(
  noteId: string,
  targets: { noteIds: string[]; docIds: string[]; annIds: string[] }
): Promise<void> {
  return invoke<void>('db_sync_note_links', {
    noteId,
    targetNoteIds: targets.noteIds,
    targetDocIds: targets.docIds,
    targetAnnIds: targets.annIds,
  });
}

export async function deleteNoteLink(id: string): Promise<void> {
  return invoke<void>('db_delete_note_link', { id });
}
