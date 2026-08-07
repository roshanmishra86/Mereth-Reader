import { describe, expect, it } from 'vitest';
import { calculateZoomScale, formatPageLabel, searchPdfText } from './pdfUtils';

describe('pdfUtils', () => {
  describe('calculateZoomScale', () => {
    it('should zoom in by 0.25 up to MAX_SCALE 3.0', () => {
      const result = calculateZoomScale(1.0, 'zoom-in');
      expect(result.scale).toBe(1.25);
      expect(result.mode).toBe('custom');

      const maxResult = calculateZoomScale(2.9, 'zoom-in');
      expect(maxResult.scale).toBe(3.0);
    });

    it('should zoom out by 0.25 down to MIN_SCALE 0.5', () => {
      const result = calculateZoomScale(1.0, 'zoom-out');
      expect(result.scale).toBe(0.75);
      expect(result.mode).toBe('custom');

      const minResult = calculateZoomScale(0.6, 'zoom-out');
      expect(minResult.scale).toBe(0.5);
    });

    it('should reset scale to 1.0', () => {
      const result = calculateZoomScale(1.75, 'reset');
      expect(result.scale).toBe(1.0);
      expect(result.mode).toBe('custom');
    });

    it('should calculate fit-width scale based on container and page width', () => {
      const result = calculateZoomScale(1.0, 'fit-width', 1040, 800);
      // containerWidth 1040 - padding 40 = 1000. 1000 / 800 = 1.25
      expect(result.scale).toBe(1.25);
      expect(result.mode).toBe('fit-width');
    });

    it('should calculate fit-page scale based on container dimensions', () => {
      const result = calculateZoomScale(1.0, 'fit-page', 1040, 800, 860, 1000);
      // scaleW = (1040-40)/800 = 1.25, scaleH = (860-60)/1000 = 0.8
      // min(1.25, 0.8) = 0.8
      expect(result.scale).toBe(0.8);
      expect(result.mode).toBe('fit-page');
    });
  });

  describe('searchPdfText', () => {
    const samplePages = [
      {
        pageNumber: 1,
        text: 'Test-enhanced learning improves long-term retention of factual knowledge in academic settings.',
      },
      {
        pageNumber: 2,
        text: 'The retrieval practice effect demonstrates that testing strengthens retrieval routes.',
      },
    ];

    it('should return empty array for empty or whitespace query', () => {
      expect(searchPdfText(samplePages, '')).toEqual([]);
      expect(searchPdfText(samplePages, '   ')).toEqual([]);
    });

    it('should find matches case-insensitively across pages', () => {
      const matches = searchPdfText(samplePages, 'retrieval');
      expect(matches.length).toBe(2);
      expect(matches[0].pageNumber).toBe(2);
      expect(matches[0].snippet).toContain('retrieval');
    });

    it('should find multiple matches within the same page', () => {
      const pages = [
        { pageNumber: 1, text: 'Retrieval practice helps retrieval routes stay strong.' },
      ];
      const matches = searchPdfText(pages, 'retrieval');
      expect(matches.length).toBe(2);
    });
  });

  describe('formatPageLabel', () => {
    it('should format standard page label', () => {
      expect(formatPageLabel(4, 12)).toBe('4 / 12');
    });

    it('should format page label with custom page title', () => {
      expect(formatPageLabel(4, 12, 'p. 249')).toBe('4 / 12 · p. 249');
    });

    it('should clamp current page within bounds', () => {
      expect(formatPageLabel(0, 10)).toBe('1 / 10');
      expect(formatPageLabel(15, 10)).toBe('10 / 10');
    });
  });
});
