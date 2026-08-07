import crypto from 'node:crypto';

export interface NormalizedGeometry {
  /** X coordinate ratio (0.0 to 1.0) */
  x: number;
  /** Y coordinate ratio (0.0 to 1.0) */
  y: number;
  /** Width ratio (0.0 to 1.0) */
  width: number;
  /** Height ratio (0.0 to 1.0) */
  height: number;
}

export interface QuoteContext {
  prefix: string;
  exactQuote: string;
  suffix: string;
}

export type AnnotationType = 'highlight' | 'rectangle';
export type AnnotationStatus = 'active' | 'detached';

export interface Annotation {
  id: string;
  documentId: string;
  documentVersionId: string;
  pageNumber: number;
  pageLabel: string;
  type: AnnotationType;
  geometry: NormalizedGeometry;
  quoteContext?: QuoteContext;
  color: string;
  checksum: string;
  status: AnnotationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ViewportTransform {
  pageWidthPx: number;
  pageHeightPx: number;
  scale: number;
  rotationDegrees: 0 | 90 | 180 | 270;
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Computes SHA-256 checksum for annotation content integrity.
 */
export function calculateAnnotationChecksum(
  documentVersionId: string,
  pageNumber: number,
  type: AnnotationType,
  geometry: NormalizedGeometry,
  quoteContext?: QuoteContext
): string {
  const payload = JSON.stringify({
    documentVersionId,
    pageNumber,
    type,
    geometry,
    exactQuote: quoteContext?.exactQuote ?? ''
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Normalizes absolute pixel coordinates to 0..1 scale geometry.
 */
export function normalizeGeometry(
  pixelRect: PixelRect,
  pageWidthPx: number,
  pageHeightPx: number
): NormalizedGeometry {
  const safeW = Math.max(1, pageWidthPx);
  const safeH = Math.max(1, pageHeightPx);

  return {
    x: Math.min(1, Math.max(0, pixelRect.left / safeW)),
    y: Math.min(1, Math.max(0, pixelRect.top / safeH)),
    width: Math.min(1, Math.max(0, pixelRect.width / safeW)),
    height: Math.min(1, Math.max(0, pixelRect.height / safeH))
  };
}

/**
 * Transforms 0..1 normalized geometry back to target screen viewport pixel coordinates.
 */
export function denormalizeGeometry(
  geometry: NormalizedGeometry,
  transform: ViewportTransform
): PixelRect {
  const scaledWidth = transform.pageWidthPx * transform.scale;
  const scaledHeight = transform.pageHeightPx * transform.scale;

  let x = geometry.x * scaledWidth;
  let y = geometry.y * scaledHeight;
  let w = geometry.width * scaledWidth;
  let h = geometry.height * scaledHeight;

  // Handle page rotation transform math
  if (transform.rotationDegrees === 90) {
    const origX = x;
    x = scaledWidth - y - h;
    y = origX;
    const origW = w;
    w = h;
    h = origW;
  } else if (transform.rotationDegrees === 180) {
    x = scaledWidth - x - w;
    y = scaledHeight - y - h;
  } else if (transform.rotationDegrees === 270) {
    const origX = x;
    x = y;
    y = scaledHeight - origX - w;
    const origW = w;
    w = h;
    h = origW;
  }

  return {
    left: Math.round(x * 100) / 100,
    top: Math.round(y * 100) / 100,
    width: Math.round(w * 100) / 100,
    height: Math.round(h * 100) / 100
  };
}

/**
 * Checks document version compatibility. If version mismatched, marks status = 'detached'.
 */
export function syncAnnotationVersion(
  annotation: Annotation,
  currentDocumentVersionId: string,
  pageTextContent?: string
): Annotation {
  if (annotation.documentVersionId === currentDocumentVersionId) {
    return { ...annotation, status: 'active' };
  }

  // Handle version mismatch: attempt quote context re-anchoring if quote context is present
  if (annotation.quoteContext && pageTextContent) {
    if (pageTextContent.includes(annotation.quoteContext.exactQuote)) {
      return {
        ...annotation,
        documentVersionId: currentDocumentVersionId,
        status: 'active',
        updatedAt: new Date().toISOString()
      };
    }
  }

  // Gracefully flag as detached / re-anchor required instead of silent bad positioning
  return {
    ...annotation,
    status: 'detached',
    updatedAt: new Date().toISOString()
  };
}
