/**
 * Task 4.2 — Evidence blocks and in-context return types (PRD R3, FR-10.1, FR-10.2).
 *
 * Evidence blocks are structured, immutable excerpts or area images linked to documents,
 * annotations, and notes, accompanied by document metadata and user comments.
 */

import type { AnnotationRecord } from './annotationTypes';
import type { DocumentRecord } from './pdfImport';

export type Provenance =
  | 'source_extracted'
  | 'source_ocr'
  | 'user_authored'
  | 'ai_draft'
  | 'user_adopted_ai'
  | 'deterministic_transform';

export type EvidenceSourceKind = 'quote' | 'area_image';

export interface EvidenceBlockRecord {
  id: string;
  note_id: string;
  source_kind: EvidenceSourceKind;
  annotation_id?: string | null;
  image_asset_id?: string | null;
  document_id: string;
  page_index: number;
  page_label: string;
  quote: string;
  color: string;
  tags: string[];
  user_comment: string;
  sort_order: number;
  created_at: string;
  provenance: Provenance;
  original_provenance?: Provenance | null;
}

export interface CreateEvidenceBlockInput {
  id?: string;
  noteId: string;
  annotation?: AnnotationRecord | null;
  document: DocumentRecord;
  pageIndex: number;
  pageLabel: string;
  sourceKind: EvidenceSourceKind;
  quote?: string;
  imageAssetId?: string | null;
  color?: string;
  tags?: string[];
  userComment?: string;
  provenance?: Provenance;
}

/**
 * Constructs an EvidenceBlockRecord from an AnnotationRecord and DocumentRecord.
 */
export function createEvidenceBlockFromAnnotation(
  input: CreateEvidenceBlockInput
): EvidenceBlockRecord {
  const ann = input.annotation;
  const quote = input.quote ?? (ann ? ann.quote : '');
  const color = input.color ?? (ann ? ann.color : '');
  const tags = input.tags ?? (ann ? [...ann.tags] : []);
  const provenance: Provenance = input.provenance ?? (ann?.provenance ? (ann.provenance as Provenance) : 'source_extracted');

  return {
    id: input.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `eb-${Date.now()}`),
    note_id: input.noteId,
    source_kind: input.sourceKind,
    annotation_id: ann ? ann.id : null,
    image_asset_id: input.imageAssetId ?? null,
    document_id: input.document.id,
    page_index: input.pageIndex,
    page_label: input.pageLabel || String(input.pageIndex + 1),
    quote,
    color,
    tags,
    user_comment: input.userComment ?? '',
    sort_order: 0,
    created_at: new Date().toISOString(),
    provenance,
    original_provenance: null,
  };
}

/**
 * Builds the canonical deep link URL for in-context return (FR-10.2).
 * Format: mereth://document/{documentId}?page={pageIndex}&annotation={annotationId}
 */
export function buildEvidenceDeepLink(
  documentId: string,
  pageIndex: number,
  annotationId?: string | null
): string {
  const base = `mereth://document/${encodeURIComponent(documentId)}?page=${pageIndex}`;
  if (annotationId) {
    return `${base}&annotation=${encodeURIComponent(annotationId)}`;
  }
  return base;
}

export interface ParsedEvidenceDeepLink {
  documentId: string;
  pageIndex: number;
  annotationId: string | null;
}

/**
 * Parses a mereth:// deep link URL into document, page, and annotation targets.
 */
export function parseEvidenceDeepLink(url: string): ParsedEvidenceDeepLink | null {
  if (!url.startsWith('mereth://document/')) {
    return null;
  }
  try {
    const afterScheme = url.replace('mereth://document/', '');
    const [docPart, queryPart] = afterScheme.split('?');
    const documentId = decodeURIComponent(docPart);
    if (!documentId) return null;

    let pageIndex = 0;
    let annotationId: string | null = null;

    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart);
      const pageParam = searchParams.get('page');
      if (pageParam !== null) {
        const parsed = parseInt(pageParam, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          pageIndex = parsed;
        }
      }
      const annParam = searchParams.get('annotation');
      if (annParam) {
        annotationId = decodeURIComponent(annParam);
      }
    }

    return { documentId, pageIndex, annotationId };
  } catch {
    return null;
  }
}
