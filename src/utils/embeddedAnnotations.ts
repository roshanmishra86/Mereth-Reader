/**
 * Task 3.6 — embedded (PDF-born) annotation handling (PRD FR-9.9).
 *
 * Standards-compliant embedded annotations are read through pdf.js, mapped
 * into the Reader's stored geometry space (normalized 0..1 rects in the
 * baseSize space, i.e. the viewport at user rotation 0 that the overlay
 * denormalizes from), classified against the user's existing records, and
 * OFFERED for import — importing is always an explicit action whose preview
 * shows duplicates and provenance. Imported records carry the
 * `deterministic_transform` provenance of the six-value §16.1 vocabulary: a
 * PDF annotation → Reader record is a deterministic transformation of source
 * data, not user authorship (the user has not authored it yet) and not AI
 * output.
 *
 * Everything in this module is pure (no pdf.js import) so the subtype
 * mapping, the PDF→viewport geometry (including a page's own /Rotate), the
 * duplicate classification, and the import-record builders are fully
 * unit-testable in the Node test environment. The thin pdf.js glue lives in
 * `pdfViewer.ts` (`getPdfPageEmbeddedAnnotations`).
 */

import {
  AnnotationRecord,
  AnnotationType,
  DEFAULT_ANNOTATION_COLOR,
  PaletteEntry,
  buildImportedAnnotationRecord,
  paletteColorFor,
} from './annotationTypes';
import { NormalizedGeometry } from './annotationAnchor';

/** Raw rect as it appears in the PDF (media space, y-up). */
export interface PdfRectBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Embedded annotation after mapping out of pdf.js: enough to render as a
 * source-style overlay and to preview/import. `subtype` keeps the raw PDF
 * name (e.g. "Highlight", "StrikeOut") — the mapping to a Reader type is a
 * separate, explicit step so the preview can show the original.
 */
export interface ParsedEmbeddedAnnotation {
  /** pdf.js annotation id, unique per document (e.g. "5R"). */
  sourceId: string;
  /** Raw PDF subtype name. */
  subtype: string;
  /** Zero-based physical page. */
  pageIndex: number;
  /** One normalized rect per quad (text markup) or one from /Rect. */
  rects: NormalizedGeometry[];
  /** PDF /C colour as [r,g,b], 0..255, when present. */
  colorRgb: [number, number, number] | null;
  /** /Contents text, if any (the embedded note). */
  contents: string;
  /** /T title (author) text, if any. */
  author: string;
  /** True when the annotation should never rotate with the page. */
  noRotate: boolean;
}

export type EmbeddedImportStatus = 'new' | 'duplicate' | 'unsupported';

/** One row of the import preview: item + classification + human reason. */
export interface EmbeddedImportPreview {
  item: ParsedEmbeddedAnnotation;
  /** Reader type the item would become; null when unsupported. */
  mappedType: AnnotationType | null;
  status: EmbeddedImportStatus;
  /** Existing record id when status is 'duplicate'. */
  duplicateOfId?: string;
  /** Why this item got its status — shown verbatim in the preview. */
  reason: string;
}

/**
 * PDF subtypes Reader can turn into editable records, and the Reader type
 * each maps to. Squiggly maps to underline (a wavy under-line), StrikeOut to
 * highlight (a change of the text's visual emphasis). Everything else that
 * pdf.js reports (Link, Widget, Popup, Square, Ink, ...) is listed as
 * unsupported in the preview and left untouched in the PDF.
 */
const MAPPED_SUBTYPES: Record<string, AnnotationType> = {
  Highlight: 'highlight',
  Underline: 'underline',
  Squiggly: 'underline',
  StrikeOut: 'highlight',
  Text: 'comment',
};

/** Subtypes that are never content annotations (noise for the preview). */
const SKIPPED_SUBTYPES = new Set(['Link', 'Widget', 'Popup']);

/** Annotation flags (ISO 32000-1 §12.5.3): invisible/hidden are not shown. */
const FLAG_INVISIBLE = 0x1;
const FLAG_HIDDEN = 0x2;

/** The Reader type an embedded subtype maps to, or null when unsupported. */
export function mappedAnnotationTypeForSubtype(subtype: string): AnnotationType | null {
  return MAPPED_SUBTYPES[subtype] ?? null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts one PDF-space rect (y-up media coordinates) into a normalized
 * 0..1 rect in the Reader's baseSize space — the viewport at user rotation 0.
 * The page's own /Rotate is applied with the exact transform pdf.js's
 * viewport uses for a media box whose origin is (0,0) — verified empirically
 * against `PageViewport.transform` on real corpus bytes
 * (rot0: y'=H−y; rot90: (y,x); rot180: (W−x,y); rot270: (H−y,W−x)) — so the
 * result matches what the overlay's
 * `denormalizeGeometry(rect, { baseSize, rotation: 0 })` expects, including
 * for pages whose /Rotate is non-zero.
 */
export function pdfRectToNormalized(
  box: PdfRectBox,
  media: { width: number; height: number },
  rotate: number
): NormalizedGeometry {
  const rotation = rotate === 90 || rotate === 180 || rotate === 270 ? rotate : 0;
  const { width, height } = media;
  const toViewport = (x: number, y: number): { x: number; y: number } => {
    switch (rotation) {
      case 90:
        return { x: y, y: x };
      case 180:
        return { x: width - x, y: y };
      case 270:
        return { x: height - y, y: width - x };
      default:
        return { x, y: height - y };
    }
  };
  const a = toViewport(box.x0, box.y0);
  const b = toViewport(box.x1, box.y1);
  const viewportW = rotation % 180 === 0 ? width : height;
  const viewportH = rotation % 180 === 0 ? height : width;

  const left = clamp01(Math.min(a.x, b.x) / viewportW);
  const top = clamp01(Math.min(a.y, b.y) / viewportH);
  const right = clamp01(Math.max(a.x, b.x) / viewportW);
  const bottom = clamp01(Math.max(a.y, b.y) / viewportH);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * QuadPoints (ISO 32000-1 §12.5.6.10): one quad per highlighted line, given
 * as flat [x1,y1,...,x8,y8] per quad. Returns one normalized bounding rect
 * per quad so multi-line highlights render as separate boxes, exactly like
 * Reader-created highlights.
 */
export function quadPointsToNormalized(
  flatPoints: ArrayLike<number>,
  media: { width: number; height: number },
  rotate: number,
  origin?: { x: number; y: number }
): NormalizedGeometry[] {
  const out: NormalizedGeometry[] = [];
  const values = Array.from(flatPoints);
  const quadCount = values.length / 8;
  for (let i = 0; i < quadCount; i++) {
    const seg = values.slice(i * 8, i * 8 + 8);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let p = 0; p < 8; p += 2) {
      const px = seg[p] - (origin?.x ?? 0);
      const py = seg[p + 1] - (origin?.y ?? 0);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    const rect = pdfRectToNormalized({ x0: minX, y0: minY, x1: maxX, y1: maxY }, media, rotate);
    if (rect.width > 0 && rect.height > 0) out.push(rect);
  }
  return out;
}

/** The minimal pdf.js annotation-data shape this mapper reads. */
export interface PdfJsAnnotationDataLike {
  id?: string;
  subtype?: string;
  rect?: ArrayLike<number> | null;
  quadPoints?: ArrayLike<number> | null;
  color?: ArrayLike<number> | null;
  contentsObj?: { str?: string } | null;
  titleObj?: { str?: string } | null;
  annotationFlags?: number;
  noRotate?: boolean;
}

export interface EmbeddedPageInfo {
  mediaWidth: number;
  mediaHeight: number;
  /** The page's own /Rotate value (0/90/180/270). */
  rotate: number;
  /** Media-box origin (nonzero MediaBox min corner); defaults to 0. */
  mediaX?: number;
  mediaY?: number;
  pageIndex: number;
}

/** Maps one pdf.js annotation data object to a ParsedEmbeddedAnnotation. */
export function mapPdfJsAnnotationData(
  raw: PdfJsAnnotationDataLike,
  page: EmbeddedPageInfo
): ParsedEmbeddedAnnotation | null {
  const subtype = raw.subtype ?? '';
  if (!subtype || SKIPPED_SUBTYPES.has(subtype)) return null;
  const flags = raw.annotationFlags ?? 0;
  if ((flags & (FLAG_INVISIBLE | FLAG_HIDDEN)) !== 0) return null;

  const media = { width: page.mediaWidth, height: page.mediaHeight };
  const origin = { x: page.mediaX ?? 0, y: page.mediaY ?? 0 };
  let rects: NormalizedGeometry[] = [];
  if (raw.quadPoints && raw.quadPoints.length > 0) {
    rects = quadPointsToNormalized(raw.quadPoints, media, page.rotate, origin);
  }
  if (rects.length === 0 && raw.rect && raw.rect.length >= 4) {
    const r = raw.rect;
    const rect = pdfRectToNormalized(
      { x0: r[0] - origin.x, y0: r[1] - origin.y, x1: r[2] - origin.x, y1: r[3] - origin.y },
      media,
      page.rotate
    );
    if (rect.width > 0 && rect.height > 0) rects = [rect];
  }
  if (rects.length === 0) return null;

  const rgb: [number, number, number] | null =
    raw.color && raw.color.length >= 3
      ? [raw.color[0], raw.color[1], raw.color[2]]
      : null;

  return {
    sourceId: raw.id ?? `${subtype}-page-${page.pageIndex + 1}`,
    subtype,
    pageIndex: page.pageIndex,
    rects,
    colorRgb: rgb,
    contents: raw.contentsObj?.str ?? '',
    author: raw.titleObj?.str ?? '',
    noRotate: raw.noRotate === true,
  };
}

/** Intersection-over-smaller-area between two normalized rects. */
export function overlapRatio(a: NormalizedGeometry, b: NormalizedGeometry): number {
  const ix = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const iy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (ix <= 0 || iy <= 0) return 0;
  const intersection = ix * iy;
  const smaller = Math.min(Math.max(0, a.width * a.height), Math.max(0, b.width * b.height));
  return smaller > 0 ? intersection / smaller : 0;
}

export interface ClassifyOptions {
  /** Overlap ratio above which an embedded item counts as duplicate (0..1). */
  overlapThreshold?: number;
}

/**
 * FR-9.9 duplicate preview: an embedded item is a likely duplicate when an
 * existing record sits on the same page, maps to the same Reader type, and
 * covers (a threshold share of) the same region. Unsupported subtypes are
 * listed with their reason so the preview is honest instead of silently
 * dropping them.
 */
export function classifyEmbeddedAnnotations(
  items: ParsedEmbeddedAnnotation[],
  existing: AnnotationRecord[],
  options: ClassifyOptions = {}
): EmbeddedImportPreview[] {
  const threshold = options.overlapThreshold ?? 0.6;
  const previews: EmbeddedImportPreview[] = [];

  for (const item of items) {
    const mappedType = mappedAnnotationTypeForSubtype(item.subtype);
    if (!mappedType) {
      previews.push({
        item,
        mappedType: null,
        status: 'unsupported',
        reason: `“${item.subtype}” is not one of the editable annotation types — it stays untouched in the PDF.`,
      });
      continue;
    }

    let duplicate: AnnotationRecord | null = null;
    for (const record of existing) {
      if (record.deleted_at !== null) continue;
      if (record.page_index !== item.pageIndex || record.annotation_type !== mappedType) continue;
      const covers = item.rects.some((ir) =>
        record.rects.some((rr) => overlapRatio(ir, rr) >= threshold)
      );
      if (covers) {
        duplicate = record;
        break;
      }
    }

    if (duplicate) {
      previews.push({
        item,
        mappedType,
        status: 'duplicate',
        duplicateOfId: duplicate.id,
        reason: `Overlaps your existing ${mappedType} on this page — likely the same passage. You can still import it.`,
      });
    } else {
      previews.push({
        item,
        mappedType,
        status: 'new',
        reason: `New ${mappedType} on page ${item.pageIndex + 1}.`,
      });
    }
  }

  return previews;
}

export interface ImportCounts {
  newCount: number;
  duplicateCount: number;
  unsupportedCount: number;
}

/** Counts for the modal's summary line. */
export function countImportPreviews(previews: EmbeddedImportPreview[]): ImportCounts {
  const counts: ImportCounts = { newCount: 0, duplicateCount: 0, unsupportedCount: 0 };
  for (const preview of previews) {
    if (preview.status === 'new') counts.newCount++;
    else if (preview.status === 'duplicate') counts.duplicateCount++;
    else counts.unsupportedCount++;
  }
  return counts;
}

/** hex → "#rrggbb" (lowercase, padded). */
export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/**
 * FR-9.3: maps an embedded PDF /C colour to the nearest palette entry (by
 * squared RGB distance) so imported records join the user's semantic palette;
 * ties resolve to the palette order. Null colour → the default new-annotation
 * key.
 */
export function matchPaletteKeyForRgb(
  rgb: [number, number, number] | null,
  palette: PaletteEntry[]
): string {
  if (!rgb) return DEFAULT_ANNOTATION_COLOR;
  let bestKey = DEFAULT_ANNOTATION_COLOR;
  let bestDistance = Infinity;
  for (const entry of palette) {
    const hex = paletteColorFor(entry.key, palette);
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) continue;
    const n = parseInt(m[1], 16);
    const dr = (n >> 16) & 255;
    const dg = (n >> 8) & 255;
    const db = n & 255;
    const distance = (rgb[0] - dr) ** 2 + (rgb[1] - dg) ** 2 + (rgb[2] - db) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKey = entry.key;
    }
  }
  return bestKey;
}

export interface ImportRecordInput {
  documentId: string;
  documentVersionId: string;
  pageLabel: string;
  preview: EmbeddedImportPreview;
  palette: PaletteEntry[];
}

/**
 * Builds the editable Reader record for one embedded item. The quote is
 * deliberately left empty (the PDF stores geometry, not guaranteed text) and
 * the embedded note text becomes the comment; provenance is
 * `deterministic_transform` — the preview states this before the user acts.
 */
export function buildEmbeddedImportRecord(input: ImportRecordInput): AnnotationRecord {
  const preview = input.preview;
  const type = preview.mappedType ?? 'comment';
  return buildImportedAnnotationRecord({
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    pageIndex: preview.item.pageIndex,
    pageLabel: input.pageLabel,
    type,
    rects: preview.item.rects,
    quote: '',
    comment: preview.item.contents,
    color: matchPaletteKeyForRgb(preview.item.colorRgb, input.palette),
  });
}
