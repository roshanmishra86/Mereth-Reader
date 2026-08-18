/**
 * Task 3.4 — durable-anchor math for annotation creation (PRD FR-9.4).
 *
 * A text annotation stores normalized 0..1 rectangles in the page's
 * UNROTATED space plus exact quote, nearby prefix/suffix, and a text-layer
 * checksum. The DOM selection lives in the rotated, scaled visual space, so
 * creation must convert it back to the stored space; rendering later applies
 * R0.4's `denormalizeGeometry` forward transform. The inverse implemented
 * here is the exact algebraic inverse of that forward transform, verified by
 * round-trip tests at 0°/90°/180°/270°.
 *
 * All functions are pure (no DOM) so the geometry model stays unit-testable
 * in the Node test environment; the thin DOM glue lives in the reader
 * components.
 */

export interface NormalizedGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RotationDegrees = 0 | 90 | 180 | 270;

/** A CSS-pixel rect in viewport coordinates (client rect shape). */
export interface ViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The in-viewport bounding box of a rendered page. */
export interface PageBox extends ViewportRect {
  /** CSS-pixel width of the rotated page wrapper. */
  width: number;
  /** CSS-pixel height of the rotated page wrapper. */
  height: number;
}

const EPS = 1e-6;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts a rect given in the rotated visual space (as a fraction of the
 * rotated page wrapper) into the stored unrotated normalized space — the
 * exact inverse of `denormalizeGeometry` from `annotationOverlay.ts`.
 *
 * Contract: for any rect `r`, unrotated page size (W,H), scale S and rotation
 * R, applying `denormalizeGeometry(r, {W,H,S,R})` then expressing the result
 * as a fraction of the rotated wrapper size (W*S,H*S for R∈{0,180};
 * H*S,W*S for R∈{90,270}) and passing it through this function returns `r`.
 */
export function rotatedRectToNormalized(
  rotated: NormalizedGeometry,
  rotation: RotationDegrees
): NormalizedGeometry {
  let { x, y, width, height } = rotated;
  switch (rotation) {
    case 0:
      break;
    case 90:
      // Forward (denormalize, R=90): x90 = uH − y' − h'; y90 = x'; w90 = h'; h90 = w'.
      // Inverse: h' = w90; w' = h90; x' = y90; y' = 1 − x90 − w90.
      {
        const xPrime = y;
        const yPrime = 1 - x - width;
        const wPrime = height;
        const hPrime = width;
        x = xPrime;
        y = yPrime;
        width = wPrime;
        height = hPrime;
      }
      break;
    case 180:
      // Forward: x180 = uW − x' − w'; y180 = uH − y' − h'.
      x = 1 - x - width;
      y = 1 - y - height;
      break;
    case 270:
      // Forward: x270 = y'; y270 = uW − x' − w'; w270 = h'; h270 = w'.
      {
        const xPrime = 1 - y - height;
        const yPrime = x;
        const wPrime = height;
        const hPrime = width;
        x = xPrime;
        y = yPrime;
        width = wPrime;
        height = hPrime;
      }
      break;
    default:
      break;
  }
  return { x, y, width, height };
}

/**
 * Merges raw client rects (the line fragments of a DOM selection) into
 * normalized 0..1 rects in the stored unrotated page space.
 *
 * `pageBox` must be the ROTATED wrapper's in-viewport box (what
 * `getBoundingClientRect()` returns for the rendered `.pdf-page` element),
 * since selection coordinates live in the rotated visual space.
 *
 * - rects are clipped to the page wrapper's box;
 * - fragments whose top edges are within `lineMergeTolerancePx` belong to the
 *   same visual line and merge into one rect spanning the line's leftmost to
 *   rightmost extent;
 * - each merged line becomes a rotated-space normalized rect, then is
 *   converted to unrotated space via `rotatedRectToNormalized`;
 * - degenerate rects (zero width/height after clamping) are dropped.
 */
export function mergeSelectionRects(
  rects: ViewportRect[],
  pageBox: PageBox,
  rotation: RotationDegrees,
  lineMergeTolerancePx = 2
): NormalizedGeometry[] {
  const clamped: ViewportRect[] = [];
  for (const rect of rects) {
    const left = Math.max(rect.left, pageBox.left);
    const top = Math.max(rect.top, pageBox.top);
    const right = Math.min(rect.right, pageBox.right);
    const bottom = Math.min(rect.bottom, pageBox.bottom);
    if (right - left <= EPS || bottom - top <= EPS) continue;
    clamped.push({ left, top, right, bottom });
  }
  if (clamped.length === 0) return [];

  // Group into visual lines by top edge within tolerance.
  clamped.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: ViewportRect[] = [];
  for (const rect of clamped) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(rect.top - last.top) <= lineMergeTolerancePx) {
      last.left = Math.min(last.left, rect.left);
      last.top = Math.min(last.top, rect.top);
      last.right = Math.max(last.right, rect.right);
      last.bottom = Math.max(last.bottom, rect.bottom);
    } else {
      lines.push({ ...rect });
    }
  }

  const out: NormalizedGeometry[] = [];
  for (const line of lines) {
    const rotated: NormalizedGeometry = {
      x: (line.left - pageBox.left) / pageBox.width,
      y: (line.top - pageBox.top) / pageBox.height,
      width: (line.right - line.left) / pageBox.width,
      height: (line.bottom - line.top) / pageBox.height,
    };
    const normalized = rotatedRectToNormalized(rotated, rotation);
    const rect: NormalizedGeometry = {
      x: clamp01(normalized.x),
      y: clamp01(normalized.y),
      width: clamp01(Math.min(1 - clamp01(normalized.x), normalized.width)),
      height: clamp01(Math.min(1 - clamp01(normalized.y), normalized.height)),
    };
    if (rect.width > 0.001 && rect.height > 0.001) {
      out.push(rect);
    }
  }
  return out;
}

/** Normalizes one drag box (rotated visual space) into stored page space. */
export function dragBoxToNormalized(
  box: ViewportRect,
  pageBox: PageBox,
  rotation: RotationDegrees
): NormalizedGeometry {
  const rects = mergeSelectionRects([box], pageBox, rotation);
  return rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Collapse whitespace runs for quote-search tolerance. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * Builds the FR-9.4 prefix/suffix context around an exact quote within the
 * page's ordered extracted text. Returns empty context when the quote cannot
 * be located (whitespace-tolerant search; falls back to the raw text search
 * so DOM selection quirks like non-breaking spaces still match).
 */
export function buildQuoteContext(
  pageText: string,
  quote: string,
  contextChars = 80
): { prefix: string; suffix: string } {
  if (!quote) return { prefix: '', suffix: '' };
  const mergedPage = collapseWhitespace(pageText);
  const mergedQuote = collapseWhitespace(quote).trim();
  let index = mergedPage.indexOf(mergedQuote);
  if (index < 0 && mergedPage.includes(quote)) {
    index = mergedPage.indexOf(quote);
  }
  if (index < 0) return { prefix: '', suffix: '' };

  const start = Math.max(0, index - contextChars);
  // The prefix must not start mid-word at the slice boundary.
  let prefix = mergedPage.slice(start, index);
  if (start > 0) {
    const spaceAt = prefix.lastIndexOf(' ');
    if (spaceAt > 0) prefix = prefix.slice(spaceAt + 1);
  }
  const quoteEnd = index + mergedQuote.length;
  let suffix = mergedPage.slice(quoteEnd, quoteEnd + contextChars);
  if (quoteEnd + contextChars < mergedPage.length) {
    const spaceAt = suffix.lastIndexOf(' ');
    if (spaceAt > 0) suffix = suffix.slice(0, spaceAt);
  }
  return { prefix, suffix };
}

/**
 * FR-9.4 text-layer checksum: a deterministic SHA-256 of the page's ordered
 * extracted text — the same string re-anchoring (task 3.3) matches exact
 * quotes against. Web Crypto is available in the webview and in Node 24.
 */
export async function computeTextLayerChecksum(pageText: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pageText));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
