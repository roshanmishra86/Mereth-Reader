/**
 * Task 3.5 — quote/comment separation helpers (PRD FR-9.5).
 *
 * The extracted source passage and the user's comment are structurally
 * separate: distinct columns, an update path that cannot touch the quote, and
 * — here — formatting helpers that can never present a comment as a
 * quotation. Every future copy/export style (task 4.8 Quick Copy) must build
 * on these instead of concatenating fields, so the distinction cannot be lost
 * accidentally. The separation itself is pinned by tests.
 */

import { AnnotationRecord } from './annotationTypes';

/** The three text roles an annotation can present, kept apart on purpose. */
export interface AnnotationCopyText {
  /** The extracted source passage, when the annotation type carries one. */
  quote: string | null;
  /** The user's own words (comment/caption/editorial text). */
  comment: string;
  /** The primary display/copy text; only the quote role formats as a quote. */
  body: string;
  /** Human-readable page reference for copies (FR-9.4 visible label). */
  pageRef: string;
}

export function annotationCopyText(annotation: AnnotationRecord): AnnotationCopyText {
  const isTextType = annotation.annotation_type === 'highlight' || annotation.annotation_type === 'underline';
  const quote = isTextType && annotation.quote.trim() ? annotation.quote : null;
  const comment = annotation.comment.trim();
  const pageRef = annotation.page_label || String(annotation.page_index + 1);

  let body: string;
  if (quote) {
    body = quote;
  } else if (annotation.annotation_type === 'area') {
    body = comment ? `Area capture: ${comment}` : 'Area capture';
  } else if (annotation.annotation_type === 'comment') {
    body = comment || '(empty comment)';
  } else if (annotation.annotation_type === 'bookmark') {
    body = comment || 'Bookmark';
  } else {
    body = comment || '';
  }
  return { quote, comment, body, pageRef };
}

/**
 * Formats the QUOTATION portion of an annotation: only the extracted source
 * passage may be wrapped in quote marks and attributed to the page. If the
 * annotation has no quote (comments, area captures, bookmarks), the function
 * returns null rather than improvising — the caller decides how to present
 * non-quoted material.
 */
export function formatAnnotationQuotation(annotation: AnnotationRecord): string | null {
  const text = annotationCopyText(annotation);
  if (!text.quote) return null;
  return `“${text.quote}” (p. ${text.pageRef})`;
}

/**
 * Formats the COMMENT portion only — never fuses it with the quote. Export
 * styles that need both must emit them as separate blocks.
 */
export function formatAnnotationComment(annotation: AnnotationRecord): string | null {
  const text = annotationCopyText(annotation);
  if (!text.comment || text.comment === text.quote) return null;
  return text.comment;
}
