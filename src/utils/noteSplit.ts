/**
 * Task 4.3 — Split note with link preservation and atomicity check (PRD R3, FR-10.6).
 *
 * When splitting a section into an atomic concept note, the extracted passage is replaced
 * with a forward wiki-link in the original note, and a bidirectional link record is registered.
 */

import { NoteRecord, createDefaultNoteRecord, validateConceptTitleGuidance } from './notesTypes';
import { NoteLinkRecord, formatWikiLink } from './noteLinks';

export interface SplitNoteResult {
  updatedOriginalNote: NoteRecord;
  newConceptNote: NoteRecord;
  forwardLink: NoteLinkRecord;
  atomicityWarning: string | null;
}

export interface SplitNoteOptions {
  originalNote: NoteRecord;
  selectedText: string;
  newTitle: string;
  additionalProse?: string;
}

/**
 * Splits selected text out of an existing note into a new concept note,
 * inserting a wiki-link in place of the extracted text.
 */
export function splitNoteContent(options: SplitNoteOptions): SplitNoteResult {
  const { originalNote, selectedText, newTitle, additionalProse } = options;

  const guidance = validateConceptTitleGuidance(newTitle);
  const atomicityWarning = !guidance.isStrongTitle && guidance.suggestion ? guidance.suggestion : null;

  const newNoteId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `note-${Date.now()}`;

  const linkId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `link-${Date.now()}`;

  const newBody = additionalProse
    ? `${selectedText.trim()}\n\n${additionalProse.trim()}`
    : selectedText.trim();

  const newConceptNote = createDefaultNoteRecord({
    id: newNoteId,
    note_type: 'concept',
    title: newTitle.trim(),
    body_markdown: `# ${newTitle.trim()}\n\n${newBody}\n`,
    document_id: originalNote.document_id,
  });

  const wikiLinkText = formatWikiLink('note', newNoteId, newTitle.trim());

  // Replace the first occurrence of selected text with the forward wiki link
  let updatedBody = originalNote.body_markdown;
  if (selectedText.trim().length > 0 && updatedBody.includes(selectedText.trim())) {
    updatedBody = updatedBody.replace(selectedText.trim(), wikiLinkText);
  } else {
    updatedBody = `${updatedBody.trimEnd()}\n\nSee also: ${wikiLinkText}\n`;
  }

  const updatedOriginalNote: NoteRecord = {
    ...originalNote,
    body_markdown: updatedBody,
    updated_at: new Date().toISOString(),
  };

  const forwardLink: NoteLinkRecord = {
    id: linkId,
    note_id: originalNote.id,
    target_note_id: newNoteId,
    target_document_id: null,
    target_annotation_id: null,
    created_at: new Date().toISOString(),
    provenance: 'user_authored',
    original_provenance: null,
  };

  return {
    updatedOriginalNote,
    newConceptNote,
    forwardLink,
    atomicityWarning,
  };
}
