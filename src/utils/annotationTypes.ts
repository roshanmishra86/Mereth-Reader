/**
 * Task 3.4 — annotation record types, semantic palette, and creation builders
 * (PRD FR-9.1/FR-9.4/FR-9.7).
 *
 * The record shape mirrors the Rust typed layer (`src-tauri/src/db/
 * annotations.rs`) exactly — snake_case field names cross IPC unchanged.
 * Creation-time checksums use the same inputs as task 3.3's
 * `selectReanchorActions` (R0.4 `calculateAnnotationChecksum`: version id +
 * zero-based page + type + first rect + exact quote), and the parity is
 * pinned by a test here.
 */

import { NormalizedGeometry, RotationDegrees } from './annotationAnchor';

export const ANNOTATION_TYPES = [
  'highlight',
  'underline',
  'area',
  'comment',
  'bookmark',
] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export const ASSET_KINDS = ['area_capture'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

import { calculateAnnotationChecksum } from './annotationOverlay';

/** The exact IPC shape of the Rust `Annotation` struct. */
export interface AnnotationRecord {
  id: string;
  document_id: string;
  document_version_id: string;
  checksum: string;
  annotation_type: AnnotationType;
  /** Zero-based physical page (FR-9.4). */
  page_index: number;
  /** Visible page label (FR-9.4). */
  page_label: string;
  rects: NormalizedGeometry[];
  quote: string;
  prefix_text: string;
  suffix_text: string;
  text_layer_checksum: string | null;
  comment: string;
  /** Semantic palette key (FR-9.3; configuration UI ships in task 3.5). */
  color: string;
  tags: string[];
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  provenance: string;
}

/** The exact IPC shape of the Rust `AnnotationAsset` struct. */
export interface AnnotationAssetRecord {
  id: string;
  annotation_id: string;
  document_id: string;
  asset_kind: AssetKind;
  /** Relative to the app data root, e.g. `annotations/<id>.png`. */
  relative_path: string;
  content_type: string;
  width_px: number;
  height_px: number;
  caption: string;
  created_at: string;
  provenance: string;
}

/**
 * FR-9.3 default semantic palette: colour + user label ship together. The
 * mockup's category counts (Claim / Evidence / Question / Disagree) are the
 * four named labels here plus a neutral "Support". Task 3.5 makes this
 * user-configurable; until then the defaults are the v1 set.
 */
export interface PaletteEntry {
  key: string;
  color: string;
  label: string;
}

export const DEFAULT_ANNOTATION_PALETTE: PaletteEntry[] = [
  { key: 'claim', color: '#d9bd3a', label: 'Claim' },
  { key: 'evidence', color: '#8fb583', label: 'Evidence' },
  { key: 'question', color: '#7ea3c6', label: 'Question' },
  { key: 'disagree', color: '#ec3013', label: 'Disagree' },
  { key: 'support', color: '#9b9797', label: 'Support' },
];

// Cache the key index per palette array identity so lookups in tight loops
// (e.g. filtering 10k annotations in task 3.7) never rebuild the map.
const paletteIndexCache = new WeakMap<PaletteEntry[], Map<string, PaletteEntry>>();
function indexPalette(palette: PaletteEntry[]): Map<string, PaletteEntry> {
  let map = paletteIndexCache.get(palette);
  if (!map) {
    map = new Map(palette.map((e) => [e.key, e]));
    paletteIndexCache.set(palette, map);
  }
  return map;
}

const defaultPaletteByKey = indexPalette(DEFAULT_ANNOTATION_PALETTE);
const defaultPaletteByColor = new Map(DEFAULT_ANNOTATION_PALETTE.map((e) => [e.color, e]));

/** Neutral fallback colour used for unknown/missing palette keys. */
export const FALLBACK_ANNOTATION_COLOR = '#9b9797';

/**
 * Resolves a palette key to its hex colour (task 3.5: honour the user's
 * configured palette; unknown keys fall back to neutral grey).
 */
export function paletteColorFor(key: string, palette?: PaletteEntry[]): string {
  if (palette && palette.length > 0) {
    return indexPalette(palette).get(key)?.color ?? FALLBACK_ANNOTATION_COLOR;
  }
  return defaultPaletteByKey.get(key)?.color ?? FALLBACK_ANNOTATION_COLOR;
}

/** Resolves a palette key to its user label (fallback: a readable key). */
export function paletteLabelFor(key: string, palette?: PaletteEntry[]): string {
  if (palette && palette.length > 0) {
    return indexPalette(palette).get(key)?.label ?? key;
  }
  return defaultPaletteByKey.get(key)?.label ?? key;
}

/** Resolves a hex colour back to its default-palette entry, if any. */
export function paletteEntryForColor(color: string): PaletteEntry | undefined {
  return defaultPaletteByColor.get(color);
}

/** The default semantic key used when none is chosen yet. */
export const DEFAULT_ANNOTATION_COLOR = 'claim';

/** CSS fill with alpha for highlight overlays (hex → rgba). */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The creation-time integrity checksum. Inputs intentionally mirror task
 * 3.3's `selectReanchorActions` exactly (R0.4 `calculateAnnotationChecksum`:
 * documentVersionId, zero-based page, type string, FIRST rect geometry,
 * exact quote) so re-anchored and freshly created annotations stay
 * comparable — pinned by `annotationTypes.test.ts` parity test.
 */
export function computeAnnotationChecksum(params: {
  documentVersionId: string;
  pageIndex: number;
  annotationType: AnnotationType;
  firstRect: NormalizedGeometry | null;
  exactQuote: string;
}): string {
  const geometry = params.firstRect ?? { x: 0, y: 0, width: 0, height: 0 };
  return calculateAnnotationChecksum(
    params.documentVersionId,
    params.pageIndex,
    params.annotationType as 'highlight',
    geometry,
    params.exactQuote ? { prefix: '', exactQuote: params.exactQuote, suffix: '' } : undefined
  );
}

export interface NewAnnotationInput {
  documentId: string;
  documentVersionId: string;
  pageIndex: number;
  pageLabel: string;
  color?: string;
  comment?: string;
}

function baseAnnotation(input: NewAnnotationInput, type: AnnotationType): AnnotationRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    document_id: input.documentId,
    document_version_id: input.documentVersionId,
    checksum: '',
    annotation_type: type,
    page_index: input.pageIndex,
    page_label: input.pageLabel,
    rects: [],
    quote: '',
    prefix_text: '',
    suffix_text: '',
    text_layer_checksum: null,
    comment: input.comment ?? '',
    color: input.color ?? DEFAULT_ANNOTATION_COLOR,
    tags: [],
    deleted_at: null,
    created_at: now,
    updated_at: now,
    provenance: 'user_authored',
  };
}

function finalized(annotation: AnnotationRecord): AnnotationRecord {
  const firstRect = annotation.rects[0] ?? null;
  return {
    ...annotation,
    checksum: computeAnnotationChecksum({
      documentVersionId: annotation.document_version_id,
      pageIndex: annotation.page_index,
      annotationType: annotation.annotation_type,
      firstRect,
      exactQuote: annotation.quote,
    }),
  };
}

/**
 * Highlight/underline (FR-9.4): requires an exact quote and at least one
 * normalized rect — the Rust validator enforces the same rules again.
 */
export function buildTextAnnotation(
  input: NewAnnotationInput & {
    type: 'highlight' | 'underline';
    rects: NormalizedGeometry[];
    quote: string;
    prefix: string;
    suffix: string;
    textLayerChecksum: string | null;
  }
): AnnotationRecord {
  if (!input.quote.trim()) {
    throw new Error('Text annotations require an exact quote (FR-9.4)');
  }
  if (input.rects.length === 0) {
    throw new Error('Text annotations require at least one normalized rectangle');
  }
  const annotation = baseAnnotation(input, input.type);
  annotation.rects = input.rects;
  annotation.quote = input.quote;
  annotation.prefix_text = input.prefix;
  annotation.suffix_text = input.suffix;
  annotation.text_layer_checksum = input.textLayerChecksum;
  return finalized(annotation);
}

/**
 * Area/image capture (FR-9.7): the crop rectangle anchors the annotation; the
 * bitmap file and row are created separately via the asset IPC commands.
 */
export function buildAreaAnnotation(
  input: NewAnnotationInput & {
    rect: NormalizedGeometry;
    caption?: string;
  }
): AnnotationRecord {
  if (input.rect.width <= 0 || input.rect.height <= 0) {
    throw new Error('Area annotations require a non-empty crop rectangle');
  }
  const annotation = baseAnnotation(input, 'area');
  annotation.rects = [input.rect];
  return finalized(annotation);
}

/**
 * Anchored comment without a text highlight (FR-9.1): no quote, rects hold
 * the anchor position.
 */
export function buildCommentAnnotation(
  input: NewAnnotationInput & {
    rects: NormalizedGeometry[];
    comment: string;
  }
): AnnotationRecord {
  if (!input.comment.trim()) {
    throw new Error('An anchored comment requires text');
  }
  const annotation = baseAnnotation(input, 'comment');
  annotation.rects = input.rects;
  return finalized(annotation);
}

/**
 * Bookmark (FR-9.1): page-level marker with no geometry and no quote.
 */
export function buildBookmarkAnnotation(input: NewAnnotationInput): AnnotationRecord {
  return finalized(baseAnnotation(input, 'bookmark'));
}

/**
 * Builds a record imported from an embedded PDF annotation (task 3.6,
 * FR-9.9). Import is always an explicit, previewed action; the record keeps
 * the `deterministic_transform` provenance because it is a deterministic
 * transformation of the PDF's source annotation data — never silently
 * presented as user authorship. Quote stays empty (PDFs store geometry, not
 * guaranteed text); the embedded note text becomes the comment.
 */
export function buildImportedAnnotationRecord(input: {
  documentId: string;
  documentVersionId: string;
  pageIndex: number;
  pageLabel: string;
  type: AnnotationType;
  rects: NormalizedGeometry[];
  quote?: string;
  comment?: string;
  color: string;
}): AnnotationRecord {
  const annotation = baseAnnotation(input, input.type);
  annotation.rects = input.rects;
  annotation.quote = input.quote ?? '';
  annotation.comment = input.comment ?? '';
  annotation.color = input.color;
  annotation.provenance = 'deterministic_transform';
  return finalized(annotation);
}

/** Builds the asset row for a written crop file (asset kind validated). */
export function buildAreaAssetRecord(input: {
  id: string;
  annotationId: string;
  documentId: string;
  relativePath: string;
  widthPx: number;
  heightPx: number;
  caption: string;
}): AnnotationAssetRecord {
  if (input.widthPx <= 0 || input.heightPx <= 0) {
    throw new Error('Asset dimensions must be positive');
  }
  return {
    id: input.id,
    annotation_id: input.annotationId,
    document_id: input.documentId,
    asset_kind: 'area_capture',
    relative_path: input.relativePath,
    content_type: 'image/png',
    width_px: input.widthPx,
    height_px: input.heightPx,
    caption: input.caption,
    created_at: new Date().toISOString(),
    provenance: 'user_authored',
  };
}

/** Predicate: which types carry the FR-9.4 text-anchor fields. */
export function isTextAnnotationType(type: string): boolean {
  return type === 'highlight' || type === 'underline';
}

/** Convenience: 1-based physical page for renderer navigation. */
export function physicalPageFor(annotation: AnnotationRecord): number {
  return annotation.page_index + 1;
}

/** The rotation type alias re-exported for the overlay layer. */
export type AnnotationRotation = RotationDegrees;
