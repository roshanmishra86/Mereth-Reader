/**
 * Task 3.3 — document fingerprinting and version handling (PRD FR-7.3, RK-2).
 *
 * "Different bytes at a known path are treated as a new version and offer
 * re-anchoring rather than reusing old coordinates." This module is the pure
 * frontend half of that contract:
 *
 * - `selectReanchorActions` decides, per annotation, whether its exact quote
 *   still exists in the new version's extracted page text. Quote-matched text
 *   annotations are re-anchored to the new version with a recomputed
 *   version-bound checksum (R0.4 `calculateAnnotationChecksum`); everything
 *   else is kept on its old version — "detached" by construction, so old
 *   coordinates are never attached to new bytes blindly. The Rust side
 *   (`db_reanchor_annotation_to_version`) then applies only the re-anchor
 *   actions.
 * - `buildPageGeometry` / `measurePdfPageGeometry` turn pdf.js base viewport
 *   measurements into the per-version page geometry stored on
 *   `document_versions` (validated again server-side).
 * - `computeAnnotationVersionStatus` derives active/detached from the version
 *   id comparison — the same model proven in R0.4's `syncAnnotationVersion`.
 *
 * Checksum policy: the version-bound checksum uses the database's canonical
 * zero-based `page_index` as its page coordinate. Task 3.4 must compute
 * creation-time checksums with the same inputs so re-anchored and freshly
 * created annotations stay comparable.
 */

import { AnnotationType, calculateAnnotationChecksum } from './annotationOverlay';

export interface PageGeometry {
  /** 1-based physical page number as used by the renderer. */
  page: number;
  /** Width in PDF points at scale 1 (pdf.js base viewport). */
  width: number;
  height: number;
}

export type VersionCheckStatus = 'missing' | 'unregistered' | 'unchanged' | 'changed';

export interface VersionCheckResult {
  status: VersionCheckStatus;
  document_sha256_hash: string;
  file_sha256_hash: string | null;
  current_version_id: string | null;
  current_version_number: number;
  file_page_count: number;
}

export interface DocumentVersionRecord {
  id: string;
  document_id: string;
  version_number: number;
  sha256_hash: string;
  page_count: number;
  page_geometry: PageGeometry[];
  created_at: string;
  provenance: string;
}

/**
 * The annotation shape as it crosses IPC from the Rust typed layer
 * (subset needed for re-anchoring decisions).
 */
export interface StoredAnnotation {
  id: string;
  document_version_id: string;
  annotation_type: string;
  /** Zero-based physical page (FR-9.4). */
  page_index: number;
  rects?: Array<{ x: number; y: number; width: number; height: number }>;
  quote: string;
  prefix_text: string;
  suffix_text: string;
}

export interface ReanchorAction {
  annotationId: string;
  newVersionId: string;
  newChecksum: string;
}

export interface ReanchorPlan {
  reanchor: ReanchorAction[];
  /** Annotation ids left on the old version (quote no longer verifiable). */
  detached: string[];
}

export type AnnotationVersionStatus = 'active' | 'detached';

const TEXT_ANNOTATION_TYPES = new Set(['highlight', 'underline']);

/** Filters and validates raw size entries into ordered per-version geometry. */
export function buildPageGeometry(
  entries: Array<{ page: number; width: number; height: number }>,
  pageCount: number
): PageGeometry[] {
  const seen = new Set<number>();
  const out: PageGeometry[] = [];
  for (const entry of entries) {
    if (!Number.isFinite(entry.width) || !Number.isFinite(entry.height)) continue;
    if (entry.width <= 0 || entry.height <= 0) continue;
    if (!Number.isInteger(entry.page) || entry.page < 1 || entry.page > pageCount) continue;
    if (seen.has(entry.page)) continue;
    seen.add(entry.page);
    out.push({ page: entry.page, width: entry.width, height: entry.height });
  }
  return out;
}

/**
 * Measures base page geometry for every page via a size provider (the reader
 * passes pdf.js `getPdfPageBaseSize`, which only reads viewports — no
 * rendering). Yields regularly so the pass never blocks scrolling; aborts on
 * signal, returning the pages measured so far.
 */
export async function measurePdfPageGeometry(
  numPages: number,
  sizeProvider: (pageNumber: number) => Promise<{ width: number; height: number } | null>,
  options: { signal?: AbortSignal; yieldEveryPages?: number } = {}
): Promise<PageGeometry[]> {
  const yieldEvery = Math.max(1, options.yieldEveryPages ?? 16);
  const raw: Array<{ page: number; width: number; height: number }> = [];
  for (let page = 1; page <= numPages; page++) {
    if (options.signal?.aborted) break;
    const size = await sizeProvider(page);
    if (size) {
      raw.push({ page, width: size.width, height: size.height });
    }
    if (page % yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return buildPageGeometry(raw, numPages);
}

/**
 * Decides the re-anchoring plan for one document's annotations when its file
 * bytes changed (FR-7.3).
 *
 * - text annotations (highlight/underline) whose exact quote appears in the
 *   new version's extracted page text are re-anchored, with the checksum
 *   recomputed against the new version id;
 * - everything else (no quote, page text not yet extracted, quote not found)
 *   stays on its old version → detached. Coordinates are never carried over
 *   without a verified quote.
 */
export function selectReanchorActions(params: {
  annotations: StoredAnnotation[];
  newVersionId: string;
  pageTextByNumber: ReadonlyMap<number, string>;
}): ReanchorPlan {
  const reanchor: ReanchorAction[] = [];
  const detached: string[] = [];

  for (const annotation of params.annotations) {
    if (annotation.document_version_id === params.newVersionId) {
      continue; // already on the target version
    }
    if (!TEXT_ANNOTATION_TYPES.has(annotation.annotation_type) || !annotation.quote.trim()) {
      detached.push(annotation.id);
      continue;
    }

    const pageText = params.pageTextByNumber.get(annotation.page_index + 1) ?? '';
    if (pageText.includes(annotation.quote)) {
      const first = annotation.rects?.[0];
      const geometry = first
        ? { x: first.x, y: first.y, width: first.width, height: first.height }
        : { x: 0, y: 0, width: 0, height: 0 };
      // The checksum binds the new version id; without recomputation any
      // integrity check would flag re-anchored annotations as tampered
      // (R0.4). 'underline' reuses the highlight checksum policy — the hash
      // input is the type string, and underlines carry the same anchor data.
      const checksum = calculateAnnotationChecksum(
        params.newVersionId,
        annotation.page_index,
        annotation.annotation_type as AnnotationType,
        geometry,
        {
          prefix: annotation.prefix_text,
          exactQuote: annotation.quote,
          suffix: annotation.suffix_text,
        }
      );
      reanchor.push({
        annotationId: annotation.id,
        newVersionId: params.newVersionId,
        newChecksum: checksum,
      });
    } else {
      detached.push(annotation.id);
    }
  }

  return { reanchor, detached };
}

/** Derives active/detached from the version id comparison (R0.4 parity). */
export function computeAnnotationVersionStatus(
  annotationVersionId: string,
  currentVersionId: string | null | undefined
): AnnotationVersionStatus {
  if (!currentVersionId) return 'detached';
  return annotationVersionId === currentVersionId ? 'active' : 'detached';
}
