import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { denormalizeGeometry } from './annotationOverlay';
import {
  buildQuoteContext,
  computeTextLayerChecksum,
  dragBoxToNormalized,
  mergeSelectionRects,
  rotatedRectToNormalized,
  RotationDegrees,
  ViewportRect,
} from './annotationAnchor';

describe('rotatedRectToNormalized — inverse of R0.4 denormalizeGeometry', () => {
  // Forward-transform a normalized rect through denormalizeGeometry, express
  // the result as a fraction of the rotated wrapper, then run the inverse.
  function roundTrip(rect: { x: number; y: number; width: number; height: number }, rotation: RotationDegrees) {
    const width = 612;
    const height = 792;
    const scale = 1.37;
    const px = denormalizeGeometry(rect, {
      pageWidthPx: width,
      pageHeightPx: height,
      scale,
      rotationDegrees: rotation,
    });
    const rotatedW = rotation === 90 || rotation === 270 ? height : width;
    const rotatedH = rotation === 90 || rotation === 270 ? width : height;
    const rotated: { x: number; y: number; width: number; height: number } = {
      x: px.left / (rotatedW * scale),
      y: px.top / (rotatedH * scale),
      width: px.width / (rotatedW * scale),
      height: px.height / (rotatedH * scale),
    };
    return rotatedRectToNormalized(rotated, rotation);
  }

  const cases = [
    { x: 0.1, y: 0.2, width: 0.6, height: 0.04 },
    { x: 0.05, y: 0.15, width: 0.9, height: 0.01 },
    { x: 0.33, y: 0.5, width: 0.2, height: 0.3 },
    { x: 0.01, y: 0.99, width: 0.02, height: 0.005 }, // bottom edge
    { x: 0, y: 0, width: 1, height: 1 }, // full page
  ];

  for (const rotation of [0, 90, 180, 270] as RotationDegrees[]) {
    it(`round-trips at ${rotation}° for every geometry`, () => {
      for (const rect of cases) {
        const result = roundTrip(rect, rotation);
        expect(result.x).toBeCloseTo(rect.x, 2);
        expect(result.y).toBeCloseTo(rect.y, 2);
        expect(result.width).toBeCloseTo(rect.width, 2);
        expect(result.height).toBeCloseTo(rect.height, 2);
      }
    });
  }

  it('is involution-like: applying 90° twice equals 180°', () => {
    const rect = { x: 0.25, y: 0.6, width: 0.2, height: 0.1 };
    const once = rotatedRectToNormalized(rect, 90);
    const twice = rotatedRectToNormalized(once, 90);
    const direct180 = rotatedRectToNormalized(rect, 180);
    expect(twice.x).toBeCloseTo(direct180.x, 6);
    expect(twice.y).toBeCloseTo(direct180.y, 6);
    expect(twice.width).toBeCloseTo(direct180.width, 6);
    expect(twice.height).toBeCloseTo(direct180.height, 6);
  });
});

describe('mergeSelectionRects', () => {
  const page: { width: number; height: number; left: number; top: number; right: number; bottom: number } = {
    left: 0,
    top: 0,
    right: 100,
    bottom: 200,
    width: 100,
    height: 200,
  };

  it('merges fragments of one visual line, then converts to normalized', () => {
    const rects: ViewportRect[] = [
      { left: 10, top: 20, right: 40, bottom: 24 },
      { left: 45, top: 20.5, right: 80, bottom: 23.8 },
    ];
    const out = mergeSelectionRects(rects, page, 0);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(0.1, 6);
    expect(out[0].y).toBeCloseTo(0.1, 6);
    expect(out[0].width).toBeCloseTo(0.7, 6);
    expect(out[0].height).toBeCloseTo(0.02, 6);
  });

  it('keeps distinct lines as distinct rects', () => {
    const rects: ViewportRect[] = [
      { left: 10, top: 20, right: 40, bottom: 24 },
      { left: 10, top: 50, right: 30, bottom: 52 },
    ];
    const out = mergeSelectionRects(rects, page, 0);
    expect(out).toHaveLength(2);
    expect(out[1].y).toBeCloseTo(0.25, 6);
    expect(out[1].width).toBeCloseTo(0.2, 6);
  });

  it('clips rects to the page box and drops fully-outside fragments', () => {
    const rects: ViewportRect[] = [
      { left: -10, top: 20, right: 50, bottom: 24 },
      { left: 300, top: 20, right: 400, bottom: 24 },
    ];
    const out = mergeSelectionRects(rects, page, 0);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(0, 6);
    expect(out[0].width).toBeCloseTo(0.5, 6);
  });

  it('drops zero-area selections', () => {
    expect(mergeSelectionRects([], page, 0)).toHaveLength(0);
    const degenerate = [{ left: 40, top: 40, right: 40, bottom: 60 }];
    expect(mergeSelectionRects(degenerate, page, 0)).toHaveLength(0);
  });

  it('applies rotation to the stored geometry (90°)', () => {
    // On a 100×200 page displayed 90°, the wrapper is 200×100. A selection of
    // rotated-space x∈[0.3,0.4], y∈[0.25,0.45] must map back to the unrotated
    // normalized rect {x:0.25, y:0.6, width:0.2, height:0.1} (verified against
    // denormalizeGeometry's forward transform in the round-trip tests).
    const rotatedPage = { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 };
    const rects: ViewportRect[] = [{ left: 60, top: 25, right: 80, bottom: 45 }];
    const out = mergeSelectionRects(rects, rotatedPage, 90);
    expect(out).toHaveLength(1);
    expect(out[0].x).toBeCloseTo(0.25, 6);
    expect(out[0].y).toBeCloseTo(0.6, 6);
    expect(out[0].width).toBeCloseTo(0.2, 6);
    expect(out[0].height).toBeCloseTo(0.1, 6);
  });

  it('dragBoxToNormalized produces the same result as a one-rect selection', () => {
    const box = { left: 10, top: 10, right: 60, bottom: 30 };
    const viaDrag = dragBoxToNormalized(box, page, 0);
    const viaMerge = mergeSelectionRects([box], page, 0)[0];
    expect(viaDrag).toEqual(viaMerge);
    expect(viaDrag.width).toBeCloseTo(0.5, 6);
  });
});

describe('buildQuoteContext', () => {
  const pageText =
    'The quick brown fox jumps over the lazy dog. The five boxing wizards jump quickly.';

  it('finds prefix and suffix around a middle quote', () => {
    const { prefix, suffix } = buildQuoteContext(pageText, 'brown fox');
    expect(prefix).toBe('The quick ');
    expect(suffix.startsWith(' jumps over the lazy dog.')).toBe(true);
  });

  it('returns empty prefix at the start of text and empty suffix at the end', () => {
    expect(buildQuoteContext(pageText, 'The quick').prefix).toBe('');
    expect(buildQuoteContext(pageText, 'quickly.').suffix).toBe('');
  });

  it('returns empty context when the quote is not in the page text', () => {
    expect(buildQuoteContext(pageText, 'not present here')).toEqual({ prefix: '', suffix: '' });
    expect(buildQuoteContext(pageText, '')).toEqual({ prefix: '', suffix: '' });
  });

  it('tolerates whitespace differences between DOM selection and ordered text', () => {
    const messy = 'The  quick\nbrown fox jumps';
    const { prefix, suffix } = buildQuoteContext(messy, 'brown fox');
    expect(prefix).toBe('The quick ');
    expect(suffix).toBe(' jumps');
  });

  it('caps context length and does not start mid-word', () => {
    const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega';
    const { prefix, suffix } = buildQuoteContext(long, 'zeta', 20);
    expect(prefix.length).toBeLessThanOrEqual(20);
    expect(prefix.trim().startsWith(' ') || prefix.trim() === '' || /^[A-Za-z]/.test(prefix[0])).toBe(true);
    // Prefix must not start mid-word: it starts after a space or at the start.
    expect(prefix === '' || prefix.startsWith(' ') || long.startsWith(prefix)).toBe(true);
    expect(suffix.length).toBeLessThanOrEqual(20);
  });
});

describe('computeTextLayerChecksum', () => {
  it('is deterministic and matches node crypto SHA-256', async () => {
    const text = '  The quick brown fox jumps over the lazy dog.  ';
    const expected = createHash('sha256').update(text).digest('hex');
    expect(await computeTextLayerChecksum(text)).toBe(expected);
    expect(await computeTextLayerChecksum(text)).toBe(expected); // stable
  });

  it('differs across texts', async () => {
    const a = await computeTextLayerChecksum('first page text');
    const b = await computeTextLayerChecksum('first page textx');
    expect(a).not.toBe(b);
  });
});
