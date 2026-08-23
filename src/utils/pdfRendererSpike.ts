/**
 * R0.2 renderer spike — pure helpers.
 *
 * The real pdfjs-dist corpus measurement (cold load, memory, failure modes) lives
 * in `scripts/pdfjs_spike_probe.mjs`, which vitest spawns from
 * `pdfRendererSpike.test.ts`. PRD §8.1 forbids accepting PDF.js blindly; the
 * ADR (`docs/decisions/R0.2-renderer-decision.md`) records the measured numbers.
 * These helpers are reusable viewer math; importing pdfjs-dist here would make
 * Vitest's dependency optimizer stall on the package, so the actual PDF loads
 * run in the plain-Node probe instead.
 */

export interface ColdLoadMetrics {
  loadTimeMs: number;
  isAcceptable: boolean;
}

export interface MemoryCheckResult {
  estimatedMemoryMb: number;
  limitMb: number;
  withinLimit: boolean;
}

export interface OutlineItemNode {
  title: string;
  dest: string | null;
  children: OutlineItemNode[];
}

export interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformedSelection {
  transformedRect: RectBounds;
  cssTransform: string;
}

export interface TransformMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface SecureDocumentLoadOptions {
  data: Uint8Array;
  disableScripting: boolean;
  isEvalSupported: boolean;
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
}

/**
 * Calculates cold load time and checks against target performance budget.
 */
export function calculateColdLoadMetrics(startTimeMs: number, endTimeMs: number, budgetMs = 500): ColdLoadMetrics {
  const loadTimeMs = Math.max(0, endTimeMs - startTimeMs);
  return {
    loadTimeMs,
    isAcceptable: loadTimeMs <= budgetMs
  };
}

/**
 * Validates estimated working set memory against memory limit.
 */
export function checkMemoryWorkingSet(
  activePagesCount: number,
  avgPageMemoryMb = 0.5,
  limitMb = 250
): MemoryCheckResult {
  const estimatedMemoryMb = activePagesCount * avgPageMemoryMb;
  return {
    estimatedMemoryMb,
    limitMb,
    withinLimit: estimatedMemoryMb <= limitMb
  };
}

/**
 * Recursively parses PDF outline nodes into typed outline hierarchy.
 */
export function parseOutlineItems(items: Array<Record<string, unknown>>): OutlineItemNode[] {
  return items.map(item => {
    const title = typeof item.title === 'string' ? item.title : 'Untitled';
    const dest = typeof item.dest === 'string' ? item.dest : null;
    const rawChildren = Array.isArray(item.items) ? (item.items as Array<Record<string, unknown>>) : [];
    return {
      title,
      dest,
      children: parseOutlineItems(rawChildren)
    };
  });
}

/**
 * Computes viewport transform matrix for scale and rotation (0, 90, 180, 270).
 */
export function getViewportTransformMatrix(scale: number, rotationDegrees: number): TransformMatrix {
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Precision rounding to avoid float inaccuracies
  const a = Math.round(scale * cos * 10000) / 10000;
  const b = Math.round(scale * sin * 10000) / 10000;
  const c = Math.round(-scale * sin * 10000) / 10000;
  const d = Math.round(scale * cos * 10000) / 10000;

  return { a, b, c, d, e: 0, f: 0 };
}

/**
 * Computes selection bounds adjusted for zoom and rotation.
 */
export function calculateSelectionTransform(
  rect: RectBounds,
  scale: number,
  rotationDegrees: number
): TransformedSelection {
  const matrix = getViewportTransformMatrix(scale, rotationDegrees);

  const transformedRect: RectBounds = {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale
  };

  const cssTransform = `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${matrix.e}, ${matrix.f})`;

  return {
    transformedRect,
    cssTransform
  };
}

/**
 * Returns security-hardened loading configuration for PDF rendering.
 */
export function getSecureDocumentLoadOptions(pdfBytes: Uint8Array): SecureDocumentLoadOptions {
  return {
    data: pdfBytes,
    disableScripting: true,
    isEvalSupported: false,
    standardFontDataUrl: '/pdfjs/standard_fonts/'
  };
}
