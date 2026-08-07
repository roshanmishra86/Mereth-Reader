import { describe, it, expect } from 'vitest';
import {
  calculateZoom,
  rotateView,
  calculateFacingPagePairs,
  validateLayoutMode,
  MIN_ZOOM_SCALE,
  MAX_ZOOM_SCALE,
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
});
