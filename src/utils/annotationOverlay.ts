// Pure-JS SHA-256 — no node:crypto dependency. Vite externalizes node:crypto
// for the browser (the production build warned about it), so the checksum
// threw before persistence in the webview. This implementation produces the
// same hex digest as crypto.createHash('sha256').update(msg).digest('hex')
// and works identically in the browser, Node, and the vitest environment.

/** SHA-256 round constants (FIPS 180-4 §4.2.2). */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 of a UTF-8 string, returned as a lowercase hex digest. */
function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  // Padding: 0x80 byte, then zeros, then 64-bit big-endian bit length.
  const minLen = bytes.length + 1 + 8;
  const blockCount = Math.ceil(minLen / 64);
  const totalLen = blockCount * 64;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let block = 0; block < blockCount; block++) {
    const offset = block * 64;
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const hex = (v: number) => v.toString(16).padStart(8, '0');
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

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
  return sha256Hex(payload);
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

  // Handle page rotation transform math.
  // After a 90°/270° rotation the display viewport dimensions swap (display
  // width = original page height, display height = original page width), so the
  // horizontal axis must be computed against scaledHeight for 90° and the
  // vertical axis against scaledWidth for 270°. Using scaledWidth/scaledHeight
  // respectively (as before) is only correct for square pages.
  if (transform.rotationDegrees === 90) {
    const origX = x;
    x = scaledHeight - y - h;
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
    y = scaledWidth - origX - w;
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
      // The checksum binds to documentVersionId, so it must be regenerated
      // when the version changes — otherwise any downstream integrity check
      // will flag the re-anchored annotation as tampered (PRD §9 traceability).
      const newChecksum = calculateAnnotationChecksum(
        currentDocumentVersionId,
        annotation.pageNumber,
        annotation.type,
        annotation.geometry,
        annotation.quoteContext
      );
      return {
        ...annotation,
        documentVersionId: currentDocumentVersionId,
        checksum: newChecksum,
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
