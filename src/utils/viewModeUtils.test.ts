import { describe, it, expect } from 'vitest';
import {
  calculateZoom,
  rotateView,
  calculateFacingPagePairs,
  validateLayoutMode,
  calculateFitScale,
  buildReaderRows,
  findRowIndexForPage,
  rotatePageSize,
  MIN_ZOOM_SCALE,
  MAX_ZOOM_SCALE,
  SPREAD_GAP_PX,
  FIT_PADDING_X_PX,
  FIT_PADDING_Y_PX,
  DEFAULT_PAGE_SIZE,
} from './viewModeUtils';

describe('viewModeUtils', () => {
  it('zooms in and out within 25% to 500% bounds', () => {
    expect(calculateZoom(1.0, 'in').scale).toBe(1.25);
    expect(calculateZoom(4.8, 'in').scale).toBe(MAX_ZOOM_SCALE);
    expect(calculateZoom(5.0, 'in').scale).toBe(MAX_ZOOM_SCALE);

    expect(calculateZoom(1.0, 'out').scale).toBe(0.75);
    expect(calculateZoom(0.3, 'out').scale).toBe(MIN_ZOOM_SCALE);
    expect(calculateZoom(0.25, 'out').scale).toBe(MIN_ZOOM_SCALE);
  });

  it('sets custom zoom levels with clamping', () => {
    expect(calculateZoom(1.0, 'set', 2.5).scale).toBe(2.5);
    expect(calculateZoom(1.0, 'set', 0.1).scale).toBe(MIN_ZOOM_SCALE);
    expect(calculateZoom(1.0, 'set', 10.0).scale).toBe(MAX_ZOOM_SCALE);
  });

  it('rotates view clockwise and counter-clockwise', () => {
    expect(rotateView(0, 'cw')).toBe(90);
    expect(rotateView(90, 'cw')).toBe(180);
    expect(rotateView(180, 'cw')).toBe(270);
    expect(rotateView(270, 'cw')).toBe(0);

    expect(rotateView(0, 'ccw')).toBe(270);
    expect(rotateView(270, 'ccw')).toBe(180);
  });

  it('calculates facing page pairs (two-up layout)', () => {
    expect(calculateFacingPagePairs(1)).toEqual([{ leftPage: 1 }]);
    expect(calculateFacingPagePairs(4)).toEqual([
      { leftPage: 1 },
      { leftPage: 2, rightPage: 3 },
      { leftPage: 4 },
    ]);
    expect(calculateFacingPagePairs(5)).toEqual([
      { leftPage: 1 },
      { leftPage: 2, rightPage: 3 },
      { leftPage: 4, rightPage: 5 },
    ]);
  });

  it('validates facing layout requirements', () => {
    expect(validateLayoutMode('facing', 1).isSupported).toBe(false);
    expect(validateLayoutMode('facing', 1).message).toContain('at least 2 pages');
    expect(validateLayoutMode('facing', 10).isSupported).toBe(true);
    expect(validateLayoutMode('single', 1).isSupported).toBe(true);
  });

  it('rotatePageSize swaps axes only for 90/270 degrees', () => {
    const size = { width: 600, height: 800 };
    expect(rotatePageSize(size, 0)).toEqual(size);
    expect(rotatePageSize(size, 180)).toEqual(size);
    expect(rotatePageSize(size, 90)).toEqual({ width: 800, height: 600 });
    expect(rotatePageSize(size, 270)).toEqual({ width: 800, height: 600 });
    // Swapping is an involution — rendered sizes convert back to base sizes.
    expect(rotatePageSize(rotatePageSize(size, 90), 90)).toEqual(size);
  });

  it('calculateFitScale fit-width sizes a single page to the viewport width', () => {
    const scale = calculateFitScale({
      containerWidth: 1000,
      containerHeight: 800,
      pageSize: { width: 600, height: 800 },
      mode: 'fit-width',
      layoutMode: 'single',
      rotation: 0,
    });
    // (1000 - 48) / 600 = 1.5866… → 1.59
    expect(scale).toBe(Math.round(((1000 - FIT_PADDING_X_PX) / 600) * 100) / 100);
  });

  it('calculateFitScale fit-width keeps both pages whole in facing mode', () => {
    const single = calculateFitScale({
      containerWidth: 1000,
      containerHeight: 800,
      pageSize: { width: 600, height: 800 },
      mode: 'fit-width',
      layoutMode: 'continuous',
      rotation: 0,
    });
    const facing = calculateFitScale({
      containerWidth: 1000,
      containerHeight: 800,
      pageSize: { width: 600, height: 800 },
      mode: 'fit-width',
      layoutMode: 'facing',
      rotation: 0,
    });
    // Facing fits the spread (2 * width + gap), so it must be smaller.
    expect(facing).not.toBeNull();
    expect(single).not.toBeNull();
    expect(facing!).toBeLessThan(single!);
    expect(facing).toBe(
      Math.round(((1000 - FIT_PADDING_X_PX) / (600 * 2 + SPREAD_GAP_PX)) * 100) / 100
    );
  });

  it('calculateFitScale fit-page uses the limiting axis', () => {
    // Tall viewport: width limits. Wide short viewport: height limits.
    const widthLimited = calculateFitScale({
      containerWidth: 700,
      containerHeight: 2000,
      pageSize: { width: 600, height: 800 },
      mode: 'fit-page',
      layoutMode: 'single',
      rotation: 0,
    });
    expect(widthLimited).toBe(Math.round(((700 - FIT_PADDING_X_PX) / 600) * 100) / 100);

    const heightLimited = calculateFitScale({
      containerWidth: 2000,
      containerHeight: 900,
      pageSize: { width: 600, height: 800 },
      mode: 'fit-page',
      layoutMode: 'single',
      rotation: 0,
    });
    expect(heightLimited).toBe(Math.round(((900 - FIT_PADDING_Y_PX) / 800) * 100) / 100);
  });

  it('calculateFitScale is rotation-aware and clamped to the zoom range', () => {
    const rotated = calculateFitScale({
      containerWidth: 1000,
      containerHeight: 800,
      pageSize: { width: 600, height: 800 },
      mode: 'fit-width',
      layoutMode: 'single',
      rotation: 90,
    });
    // Rotated page occupies 800 wide: (1000 - 48) / 800
    expect(rotated).toBe(Math.round(((1000 - FIT_PADDING_X_PX) / 800) * 100) / 100);

    const tiny = calculateFitScale({
      containerWidth: 120,
      containerHeight: 120,
      pageSize: { width: 4000, height: 6000 },
      mode: 'fit-page',
      layoutMode: 'single',
      rotation: 0,
    });
    expect(tiny).toBe(MIN_ZOOM_SCALE);

    const huge = calculateFitScale({
      containerWidth: 100000,
      containerHeight: 100000,
      pageSize: { width: 100, height: 100 },
      mode: 'fit-width',
      layoutMode: 'single',
      rotation: 0,
    });
    expect(huge).toBe(MAX_ZOOM_SCALE);
  });

  it('calculateFitScale returns null for an unmeasured container', () => {
    expect(
      calculateFitScale({
        containerWidth: 0,
        containerHeight: 0,
        pageSize: DEFAULT_PAGE_SIZE,
        mode: 'fit-width',
        layoutMode: 'single',
        rotation: 0,
      })
    ).toBeNull();
  });

  it('buildReaderRows makes one row per page in continuous mode', () => {
    const rows = buildReaderRows('continuous', 4);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ rowIndex: 0, leftPage: 1 });
    expect(rows[3]).toEqual({ rowIndex: 3, leftPage: 4 });
  });

  it('buildReaderRows makes cover-plus-pair spreads in facing mode', () => {
    const rows = buildReaderRows('facing', 5);
    expect(rows).toEqual([
      { rowIndex: 0, leftPage: 1, rightPage: undefined },
      { rowIndex: 1, leftPage: 2, rightPage: 3 },
      { rowIndex: 2, leftPage: 4, rightPage: 5 },
    ]);
    expect(buildReaderRows('facing', 1)).toEqual([{ rowIndex: 0, leftPage: 1, rightPage: undefined }]);
  });

  it('findRowIndexForPage locates the row containing a page', () => {
    // 6-page facing doc → spreads: [1], [2,3], [4,5], [6]
    const rows = buildReaderRows('facing', 6);
    expect(rows).toHaveLength(4);
    expect(findRowIndexForPage(rows, 1)).toBe(0);
    expect(findRowIndexForPage(rows, 2)).toBe(1);
    expect(findRowIndexForPage(rows, 3)).toBe(1);
    expect(findRowIndexForPage(rows, 6)).toBe(3);
  });
});
