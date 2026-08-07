import { describe, it, expect } from 'vitest';
import {
  Annotation,
  calculateAnnotationChecksum,
  normalizeGeometry,
  denormalizeGeometry,
  syncAnnotationVersion,
  ViewportTransform
} from './annotationOverlay';

describe('R0.4 Durable Annotation-Overlay Persistence', () => {
  it('normalizes pixel coordinates into 0..1 scale geometry', () => {
    const pixelRect = { left: 100, top: 200, width: 300, height: 150 };
    const geometry = normalizeGeometry(pixelRect, 1000, 2000);

    expect(geometry).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.075
    });
  });

  it('denormalizes geometry correctly across zoom scales', () => {
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 };

    const transform1: ViewportTransform = {
      pageWidthPx: 800,
      pageHeightPx: 1000,
      scale: 1.0,
      rotationDegrees: 0
    };

    const transformZoom: ViewportTransform = {
      pageWidthPx: 800,
      pageHeightPx: 1000,
      scale: 2.5,
      rotationDegrees: 0
    };

    const rect1 = denormalizeGeometry(geometry, transform1);
    expect(rect1).toEqual({ left: 80, top: 200, width: 400, height: 100 });

    const rectZoom = denormalizeGeometry(geometry, transformZoom);
    expect(rectZoom).toEqual({ left: 200, top: 500, width: 1000, height: 250 });
  });

  it('handles page rotation math (0, 90, 180, 270 degrees) without precision loss', () => {
    const geometry = { x: 0.2, y: 0.1, width: 0.4, height: 0.2 };
    const baseTransform: Omit<ViewportTransform, 'rotationDegrees'> = {
      pageWidthPx: 1000,
      pageHeightPx: 1000,
      scale: 1.0
    };

    const rect0 = denormalizeGeometry(geometry, { ...baseTransform, rotationDegrees: 0 });
    expect(rect0).toEqual({ left: 200, top: 100, width: 400, height: 200 });

    const rect90 = denormalizeGeometry(geometry, { ...baseTransform, rotationDegrees: 90 });
    expect(rect90).toEqual({ left: 700, top: 200, width: 200, height: 400 });

    const rect180 = denormalizeGeometry(geometry, { ...baseTransform, rotationDegrees: 180 });
    expect(rect180).toEqual({ left: 400, top: 700, width: 400, height: 200 });

    const rect270 = denormalizeGeometry(geometry, { ...baseTransform, rotationDegrees: 270 });
    expect(rect270).toEqual({ left: 100, top: 400, width: 200, height: 400 });
  });

  it('uses the correct axis dimension for rotation on non-square pages', () => {
    // US-Letter-style 800x1000 page. After 90°/270° rotation the display
    // viewport swaps to 1000 wide x 800 tall, so the horizontal axis must use
    // scaledHeight (1000) for 90° and the vertical axis must use scaledWidth
    // (800) for 270°. The square-page tests above cannot catch this because
    // scaledWidth === scaledHeight there.
    const geometry = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 };
    const baseTransform: Omit<ViewportTransform, 'rotationDegrees'> = {
      pageWidthPx: 800,
      pageHeightPx: 1000,
      scale: 1.0,
    };

    const rect90 = denormalizeGeometry(geometry, { ...baseTransform, rotationDegrees: 90 });
    // newLeft = scaledHeight - y - h = 1000 - 200 - 100 = 700
    // newTop  = x = 80; width = h = 100; height = w = 400
    expect(rect90).toEqual({ left: 700, top: 80, width: 100, height: 400 });

    const rect270 = denormalizeGeometry(geometry, { ...baseTransform, rotationDegrees: 270 });
    // newLeft = y = 200; newTop = scaledWidth - x - w = 800 - 80 - 400 = 320
    expect(rect270).toEqual({ left: 200, top: 320, width: 100, height: 400 });
  });

  it('supports highlight and rectangle annotation types with checksums', () => {
    const geometry = { x: 0.1, y: 0.1, width: 0.2, height: 0.05 };
    const quoteContext = {
      prefix: 'the court held that ',
      exactQuote: 'summary judgment is granted',
      suffix: ' in favor of plaintiff.'
    };

    const checksumHighlight = calculateAnnotationChecksum('v1', 1, 'highlight', geometry, quoteContext);
    const checksumRect = calculateAnnotationChecksum('v1', 1, 'rectangle', geometry);

    expect(checksumHighlight.length).toBe(64);
    expect(checksumRect.length).toBe(64);
    expect(checksumHighlight).not.toEqual(checksumRect);
  });

  it('handles version mismatch gracefully by marking status as detached when text mismatch occurs', () => {
    const baseAnn: Annotation = {
      id: 'ann-1',
      documentId: 'doc-123',
      documentVersionId: 'v1',
      pageNumber: 1,
      pageLabel: '1',
      type: 'highlight',
      geometry: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 },
      quoteContext: {
        prefix: 'section ',
        exactQuote: 'breach of fiduciary duty',
        suffix: ' was alleged'
      },
      color: '#ffeb3b',
      checksum: 'sha-placeholder',
      status: 'active',
      createdAt: '2026-08-04T12:00:00Z',
      updatedAt: '2026-08-04T12:00:00Z'
    };

    // Same version -> active
    const syncedSame = syncAnnotationVersion(baseAnn, 'v1');
    expect(syncedSame.status).toBe('active');

    // New version, text matches -> re-anchors to active on new version and
    // regenerates the checksum so it matches the new documentVersionId.
    const pageTextModified = 'In this matter, breach of fiduciary duty was alleged by plaintiffs.';
    const syncedMatch = syncAnnotationVersion(baseAnn, 'v2', pageTextModified);
    expect(syncedMatch.status).toBe('active');
    expect(syncedMatch.documentVersionId).toBe('v2');
    const expectedChecksum = calculateAnnotationChecksum(
      'v2',
      baseAnn.pageNumber,
      baseAnn.type,
      baseAnn.geometry,
      baseAnn.quoteContext
    );
    expect(syncedMatch.checksum).toBe(expectedChecksum);
    expect(syncedMatch.checksum).not.toBe(baseAnn.checksum);

    // New version, text removed -> detached flag
    const pageTextDiff = 'In this matter, breach of contract was alleged by plaintiffs.';
    const syncedMismatched = syncAnnotationVersion(baseAnn, 'v2', pageTextDiff);
    expect(syncedMismatched.status).toBe('detached');
  });
});
