import { describe, expect, it } from 'vitest';
import {
  calculateZoomScale,
  formatPageLabel,
  searchPdfText,
  createSecurePdfOptions,
  calculateVirtualWindow,
  extractOrderedText,
  createNavigationHistory,
  pushNavigationHistory,
  navigateHistoryBack,
  navigateHistoryForward,
  PDFTextItem,
} from './pdfUtils';

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
      expect(result.scale).toBe(1.25);
      expect(result.mode).toBe('fit-width');
    });

    it('should calculate fit-page scale based on container dimensions', () => {
      const result = calculateZoomScale(1.0, 'fit-page', 1040, 800, 860, 1000);
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

  describe('createSecurePdfOptions', () => {
    it('enforces disableScripting: true and isEvalSupported: false for Uint8Array source', () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const options = createSecurePdfOptions(bytes);
      expect(options.data).toEqual(bytes);
      expect(options.disableScripting).toBe(true);
      expect(options.isEvalSupported).toBe(false);
      expect(options.cMapPacked).toBe(true);
    });

    it('enforces disableScripting: true and isEvalSupported: false even if overridden in extraConfig', () => {
      const url = '/sample.pdf';
      const options = createSecurePdfOptions(url, {
        disableScripting: false,
        isEvalSupported: true,
        extraParam: 'value',
      } as Record<string, unknown>);
      expect(options.url).toBe('/sample.pdf');
      expect(options.disableScripting).toBe(true);
      expect(options.isEvalSupported).toBe(false);
      expect((options as unknown as Record<string, unknown>).extraParam).toBe('value');
    });
  });

  describe('calculateVirtualWindow', () => {
    it('returns empty window for zero pages', () => {
      const win = calculateVirtualWindow(0, 800, []);
      expect(win.visibleIndices).toEqual([]);
      expect(win.renderIndices).toEqual([]);
      expect(win.totalHeight).toBe(0);
    });

    it('calculates offsets and visible indices for continuous scroll', () => {
      // 10 pages, each 500px high, 16px gap -> page step 516px
      const heights = new Array(10).fill(500);
      const win = calculateVirtualWindow(1000, 800, heights, 16, 2);

      // Page offsets: 0: 0, 1: 516, 2: 1032, 3: 1548, 4: 2064
      // Viewport: 1000 to 1800 -> intersects Page 1 (516..1016), Page 2 (1032..1532), Page 3 (1548..2048)
      expect(win.visibleIndices).toContain(1);
      expect(win.visibleIndices).toContain(2);
      expect(win.visibleIndices).toContain(3);

      // Prefetch buffer of 2 includes Page 0, 4, 5
      expect(win.renderIndices).toContain(0);
      expect(win.renderIndices).toContain(4);
      expect(win.renderIndices).toContain(5);

      // Page 8, 9 should NOT be in renderIndices to keep memory low
      expect(win.renderIndices).not.toContain(8);
      expect(win.renderIndices).not.toContain(9);
    });
  });

  describe('extractOrderedText (FR-8.4)', () => {
    it('returns empty text and high confidence for empty items', () => {
      const result = extractOrderedText([]);
      expect(result.text).toBe('');
      expect(result.confidence).toBe(1.0);
      expect(result.isLowConfidence).toBe(false);
    });

    it('extracts single-column text in top-to-bottom reading order', () => {
      const items: PDFTextItem[] = [
        { str: 'Second line text', transform: [12, 0, 0, 12, 50, 700], width: 100, height: 12 },
        { str: 'First line title', transform: [16, 0, 0, 16, 50, 750], width: 150, height: 16 },
        { str: 'Third line conclusion', transform: [12, 0, 0, 12, 50, 650], width: 120, height: 12 },
      ];

      const result = extractOrderedText(items);
      expect(result.linesCount).toBe(3);
      expect(result.columnsCount).toBe(1);
      expect(result.text).toBe('First line title\nSecond line text\nThird line conclusion');
      expect(result.isLowConfidence).toBe(false);
    });

    it('preserves column reading order in two-column document layout', () => {
      // Column 1 (X ~ 50): Y=750, Y=730
      // Column 2 (X ~ 300): Y=750, Y=730
      const items: PDFTextItem[] = [
        { str: 'Col 2 top', transform: [10, 0, 0, 10, 300, 750], width: 80, height: 10 },
        { str: 'Col 1 top', transform: [10, 0, 0, 10, 50, 750], width: 80, height: 10 },
        { str: 'Col 1 bottom', transform: [10, 0, 0, 10, 50, 730], width: 80, height: 10 },
        { str: 'Col 2 bottom', transform: [10, 0, 0, 10, 300, 730], width: 80, height: 10 },
      ];

      const result = extractOrderedText(items);
      expect(result.columnsCount).toBe(2);
      expect(result.text).toContain('Col 1 top\nCol 1 bottom');
      expect(result.text).toContain('Col 2 top\nCol 2 bottom');
    });

    it('flags low-confidence warning on overlapping text items', () => {
      const items: PDFTextItem[] = [
        { str: 'Overlapping text A', transform: [10, 0, 0, 10, 50, 700], width: 100, height: 10 },
        { str: 'Overlapping text B', transform: [10, 0, 0, 10, 80, 700], width: 100, height: 10 },
      ];

      const result = extractOrderedText(items);
      expect(result.isLowConfidence).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('Low-confidence');
    });
  });

  describe('navigation history stack', () => {
    it('pushes page transitions and supports back / forward navigation', () => {
      let nav = createNavigationHistory(1);
      expect(nav.stack).toEqual([1]);
      expect(nav.currentIndex).toBe(0);

      nav = pushNavigationHistory(nav, 5);
      nav = pushNavigationHistory(nav, 12);
      expect(nav.stack).toEqual([1, 5, 12]);
      expect(nav.currentIndex).toBe(2);

      // Back navigation
      const back1 = navigateHistoryBack(nav);
      expect(back1.page).toBe(5);
      nav = back1.state;

      const back2 = navigateHistoryBack(nav);
      expect(back2.page).toBe(1);
      nav = back2.state;

      const back3 = navigateHistoryBack(nav);
      expect(back3.page).toBeNull(); // No further back history

      // Forward navigation
      const fwd1 = navigateHistoryForward(nav);
      expect(fwd1.page).toBe(5);
      nav = fwd1.state;

      const fwd2 = navigateHistoryForward(nav);
      expect(fwd2.page).toBe(12);
      nav = fwd2.state;
    });

    it('truncates forward history when pushing a new page from middle of stack', () => {
      let nav = createNavigationHistory(1);
      nav = pushNavigationHistory(nav, 2);
      nav = pushNavigationHistory(nav, 3);
      const back = navigateHistoryBack(nav);
      nav = back.state; // at page 2

      nav = pushNavigationHistory(nav, 10); // replaces page 3 with page 10
      expect(nav.stack).toEqual([1, 2, 10]);
      expect(nav.currentIndex).toBe(2);
    });
  });
});

