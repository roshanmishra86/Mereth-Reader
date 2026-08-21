import type { AnnotationRecord } from './annotationTypes';
import type { EvidenceBlockRecord } from './evidenceTypes';
import type { NoteRecord } from './notesTypes';
import type { ReviewPromptRecord } from './promptTypes';
import { buildMerethDeepLink, formatCitation } from './noteTemplates';

export type QuickCopyFormat = 'markdown' | 'plain';

export interface QuickCopySource {
  documentId?: string | null;
  sourceTitle?: string | null;
  sourceAuthor?: string | null;
  sourceYear?: number | string | null;
  pageIndex?: number | null;
  pageLabel?: string | null;
  annotationId?: string | null;
  noteId?: string | null;
}

export type QuickCopyItem =
  | { kind: 'annotation'; record: AnnotationRecord; source?: QuickCopySource }
  | { kind: 'evidence'; record: EvidenceBlockRecord; source?: QuickCopySource }
  | { kind: 'note'; record: NoteRecord; source?: QuickCopySource }
  | { kind: 'prompt'; record: ReviewPromptRecord; source?: QuickCopySource };

function sourceFor(item: QuickCopyItem): QuickCopySource {
  const source = item.source ?? {};
  if (item.kind === 'annotation') {
    return { ...source, documentId: source.documentId ?? item.record.document_id, pageIndex: source.pageIndex ?? item.record.page_index,
      pageLabel: source.pageLabel ?? item.record.page_label, annotationId: source.annotationId ?? item.record.id };
  }
  if (item.kind === 'evidence') {
    return { ...source, documentId: source.documentId ?? item.record.document_id, pageIndex: source.pageIndex ?? item.record.page_index,
      pageLabel: source.pageLabel ?? item.record.page_label, annotationId: source.annotationId ?? item.record.annotation_id, noteId: source.noteId ?? item.record.note_id };
  }
  if (item.kind === 'note') return { ...source, documentId: source.documentId ?? item.record.document_id, noteId: source.noteId ?? item.record.id };
  return { ...source, annotationId: source.annotationId ?? item.record.annotation_id, noteId: source.noteId ?? item.record.note_id };
}

function reference(source: QuickCopySource): string {
  const citation = formatCitation(source.sourceAuthor ?? undefined, source.sourceYear ?? undefined, source.pageLabel ?? undefined, source.sourceTitle ?? undefined);
  const page = source.pageLabel ? '' : source.pageIndex !== undefined && source.pageIndex !== null ? `Page ${source.pageIndex + 1}` : '';
  return [citation, page].filter(Boolean).join(' · ');
}

function deepLink(source: QuickCopySource): string | null {
  if (source.documentId) return buildMerethDeepLink('document', source.documentId, { page: source.pageIndex ?? undefined, annotation: source.annotationId ?? undefined });
  if (source.noteId) return buildMerethDeepLink('note', source.noteId);
  return null;
}

function quoteAndComment(quote: string, comment: string, format: QuickCopyFormat): string {
  if (format === 'plain') return ['QUOTATION', quote.trim(), comment.trim() ? `USER COMMENT\n${comment.trim()}` : ''].filter(Boolean).join('\n\n');
  const quoted = quote.trim().split('\n').map((line) => `> ${line}`).join('\n');
  return [quoted, comment.trim() ? `**User comment:** ${comment.trim()}` : ''].filter(Boolean).join('\n\n');
}

export function formatQuickCopy(item: QuickCopyItem, format: QuickCopyFormat = 'markdown'): string {
  const source = sourceFor(item);
  const ref = reference(source);
  const link = deepLink(source);
  let title: string;
  let body: string;
  if (item.kind === 'annotation') {
    title = `Annotation — ${item.record.annotation_type}`;
    body = quoteAndComment(item.record.quote || '(No quotation)', item.record.comment, format);
  } else if (item.kind === 'evidence') {
    title = 'Evidence block';
    body = quoteAndComment(item.record.quote || '(Image evidence)', item.record.user_comment, format);
  } else if (item.kind === 'note') {
    title = item.record.title || 'Untitled note';
    body = item.record.body_markdown.trim();
  } else {
    title = 'Review prompt';
    body = format === 'plain' ? `QUESTION\n${item.record.question}\n\nANSWER\n${item.record.answer}` : `**Question:** ${item.record.question}\n\n**Answer:** ${item.record.answer}`;
  }
  if (format === 'plain') return [title, body, ref ? `SOURCE REFERENCE\n${ref}` : '', link ? `OPEN IN MERETH\n${link}` : ''].filter(Boolean).join('\n\n');
  return [`# ${title}`, body, ref ? `**Source reference:** ${ref}` : '', link ? `[Open in Mereth Reader](${link})` : ''].filter(Boolean).join('\n\n');
}

export async function copyQuickCopy(item: QuickCopyItem, format: QuickCopyFormat = 'markdown'): Promise<string> {
  const text = formatQuickCopy(item, format);
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable. Copy the generated text manually.');
  await navigator.clipboard.writeText(text);
  return text;
}
