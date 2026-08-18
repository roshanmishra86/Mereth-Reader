/**
 * Task 3.7 — annotation search and filters (PRD FR-9.6, §9.3).
 *
 * The sidebar can filter by type, semantic colour label, tag, page range,
 * note status, and Remember status, and search quote and comment text. This
 * module is the pure, single source of truth for the filter semantics so the
 * UI and the 10,000-item benchmark run the exact same code.
 *
 * Performance contract (§9.3): filtering 10,000 annotations stays interactive
 * on reference hardware. The implementation therefore builds the needle /
 * membership sets ONCE per call, short-circuits every criterion in the
 * cheapest order, and never allocates per-annotation closures. The measured
 * benchmark lives in `annotationFilter.test.ts` (median of 25 runs over a
 * synthetic 10k corpus + hardware record) — an assertion, not a claim.
 *
 * "Note status" and "Remember status" belong to R3/R4 linking (notes and
 * review prompts reference annotations). Until those rows exist the sets are
 * empty and the filters honestly match only "not linked" / "not remembered";
 * the semantics and UI arrive now, the data flows later.
 */

import { AnnotationRecord, AnnotationType } from './annotationTypes';

export interface AnnotationFilters {
  /** Text search over quote + comment, case-insensitive substring. */
  searchText: string;
  /** Any-of; empty = every type. */
  types: AnnotationType[];
  /** Palette keys, any-of; empty = every colour label. */
  paletteKeys: string[];
  /** Tags, any-of (case-insensitive); empty = every tag set. */
  tags: string[];
  /** Inclusive 1-based page range; null = unbounded. */
  pageFrom: number | null;
  pageTo: number | null;
  /** 'all' = every note status. */
  noteStatus: 'all' | 'linked' | 'not-linked';
  /** 'all' = every remember status. */
  rememberStatus: 'all' | 'remembered' | 'not-remembered';
}

/** The shipped "no constraints" filter — matches everything. */
export const EMPTY_ANNOTATION_FILTERS: AnnotationFilters = {
  searchText: '',
  types: [],
  paletteKeys: [],
  tags: [],
  pageFrom: null,
  pageTo: null,
  noteStatus: 'all',
  rememberStatus: 'all',
};

/** Annotation-linkage context that arrives with later milestones. */
export interface AnnotationLinkState {
  /** Annotation ids referenced by at least one note/evidence block. */
  linkedIds?: ReadonlySet<string>;
  /** Annotation ids referenced by at least one review prompt ("Remember"). */
  rememberedIds?: ReadonlySet<string>;
}

/** Builds a filter with only the given search text (kitchen-sink helper). */
export function searchFilter(searchText: string): AnnotationFilters {
  return { ...EMPTY_ANNOTATION_FILTERS, searchText };
}

/**
 * Applies every enabled criterion in one pass. An annotation must satisfy
 * ALL enabled criteria; multi-value criteria (types, palette keys, tags) are
 * any-of within themselves. Order of checks is cheapest-first so a 10k list
 * spends as few operations per item as possible.
 */
export function applyAnnotationFilters(
  annotations: readonly AnnotationRecord[],
  filters: AnnotationFilters,
  linkState: AnnotationLinkState = {}
): AnnotationRecord[] {
  const needle = filters.searchText.trim().toLowerCase();
  const types = filters.types;
  const paletteKeys = filters.paletteKeys;
  const tags = filters.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const tagSet = tags.length > 0 ? new Set(tags) : null;
  const pageFrom = filters.pageFrom;
  const pageTo = filters.pageTo;
  const linkedIds = linkState.linkedIds ?? EMPTY_SET;
  const rememberedIds = linkState.rememberedIds ?? EMPTY_SET;

  const out: AnnotationRecord[] = [];
  for (let i = 0; i < annotations.length; i++) {
    const annotation = annotations[i];

    if (types.length > 0 && !types.includes(annotation.annotation_type)) continue;
    if (paletteKeys.length > 0 && !paletteKeys.includes(annotation.color)) continue;
    if (pageFrom !== null && annotation.page_index + 1 < pageFrom) continue;
    if (pageTo !== null && annotation.page_index + 1 > pageTo) continue;
    if (filters.noteStatus !== 'all' && linkedIds.has(annotation.id) === (filters.noteStatus === 'not-linked')) continue;
    if (filters.rememberStatus !== 'all' && rememberedIds.has(annotation.id) === (filters.rememberStatus === 'not-remembered')) continue;
    if (tagSet !== null && !annotation.tags.some((t) => tagSet.has(t.toLowerCase()))) continue;
    if (needle !== '') {
      const quote = annotation.quote;
      const comment = annotation.comment;
      const inQuote = quote.length > 0 && quote.toLowerCase().indexOf(needle) !== -1;
      if (!inQuote && !(comment.length > 0 && comment.toLowerCase().indexOf(needle) !== -1)) continue;
    }

    out.push(annotation);
  }
  return out;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
