// Polyfill DOMMatrix for Node / Vitest test environment
if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrixMock {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    multiply() { return this; }
    translate() { return this; }
    scale() { return this; }
  }
  (globalThis as unknown as Record<string, unknown>).DOMMatrix = DOMMatrixMock;
}

import { describe, it, expect } from 'vitest';
import {
  loadPdfDocument,
  renderPdfPageToCanvas,
  buildPdfJsLoadConfig,
  extractPdfPageTexts,
} from './pdfViewer';
import { isSecurePdfOptions } from './pdfUtils';

describe('pdfViewer load path', () => {
  it('loadPdfDocument returns null gracefully when binary IPC is unavailable or missing file', async () => {
    const result = await loadPdfDocument('/nonexistent/file.pdf');
    expect(result).toBeNull();
  });

  it('buildPdfJsLoadConfig enforces the R0.7 security boundary and local font assets', () => {
    const config = buildPdfJsLoadConfig(new Uint8Array([1, 2, 3]), '/');
    expect(isSecurePdfOptions(config)).toBe(true);
    expect(config.disableScripting).toBe(true);
    expect(config.isEvalSupported).toBe(false);
    // cMaps and standard fonts are served locally so CJK and non-embedded
    // fonts render offline (a CDN URL would violate the CSP and the
    // offline-by-default trust boundary).
    expect(config.cMapUrl).toBe('/pdfjs/cmaps/');
    expect(config.cMapPacked).toBe(true);
    expect(config.standardFontDataUrl).toBe('/pdfjs/standard_fonts/');
    expect(config.cMapUrl.startsWith('http')).toBe(false);
  });
});

describe('renderPdfPageToCanvas', () => {
  it('returns a discriminated bitmap failure for invalid page numbers', async () => {
    const dummyCanvas = (typeof document !== 'undefined'
      ? document.createElement('canvas')
      : { getContext: () => null }) as HTMLCanvasElement;
    const mockDoc = {
      numPages: 5,
      getPage: async () => ({}),
    } as unknown as Parameters<typeof renderPdfPageToCanvas>[0]['pdfDoc'];

    const outOfBounds = await renderPdfPageToCanvas({
      pdfDoc: mockDoc,
      pageNumber: 99,
      canvas: dummyCanvas,
      scale: 1.0,
    });

    expect(outOfBounds).toEqual({
      bitmap: 'failed',
      textLayer: 'not_started',
      dimensions: null,
      errorCategory: 'bitmap',
      message: 'Page is outside the document.',
    });
  });
});

function createFakeDoc(totalPages: number, onGetPage?: (page: number) => void) {
  return {
    numPages: totalPages,
    getPage: async (pageNumber: number) => {
      onGetPage?.(pageNumber);
      return {
        getTextContent: async () => ({
          items: [
            {
              str: `text of page ${pageNumber}`,
              transform: [10, 0, 0, 10, 50, 700],
              width: 100,
              height: 10,
            },
          ],
        }),
      };
    },
  } as unknown as Parameters<typeof extractPdfPageTexts>[0];
}

describe('extractPdfPageTexts (background extraction pipeline)', () => {
  it('extracts every page and reports completion with progress', async () => {
    const doc = createFakeDoc(6);
    const progress: number[] = [];
    const result = await extractPdfPageTexts(doc, {
      onProgress: (processed) => progress.push(processed),
    });

    expect(result.completed).toBe(true);
    expect(result.pages).toHaveLength(6);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
    // Results come back sorted by page number regardless of extraction order.
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.pages[2].text).toContain('page 3');
  });

  it('prioritizes the reading position window before the rest of the document', async () => {
    const extractionOrder: number[] = [];
    const doc = createFakeDoc(9, (page) => extractionOrder.push(page));

    await extractPdfPageTexts(doc, { prioritizeFromPage: 5 });

    // Active page first, then the ±3 window alternating outward (FR-7.6).
    expect(extractionOrder[0]).toBe(5);
    expect(extractionOrder.slice(0, 7)).toEqual([5, 4, 6, 3, 7, 2, 8]);
    expect(extractionOrder).toHaveLength(9);
  });

  it('stops cleanly on abort and returns partial results', async () => {
    const doc = createFakeDoc(10);
    const controller = new AbortController();
    let processed = 0;

    const result = await extractPdfPageTexts(doc, {
      signal: controller.signal,
      onProgress: () => {
        processed++;
        if (processed === 3) controller.abort();
      },
    });

    expect(result.completed).toBe(false);
    expect(result.pages.length).toBeLessThan(10);
    expect(result.pages.length).toBeGreaterThanOrEqual(3);
  });

  it('skips version-cached pages and publishes each new page immediately', async () => {
    const extractionOrder: number[] = [];
    const published: number[] = [];
    const doc = createFakeDoc(4, (page) => extractionOrder.push(page));
    const result = await extractPdfPageTexts(doc, {
      skipPageNumbers: new Set([1, 2]),
      onPage: (page) => { published.push(page.pageNumber); },
    });
    expect(result.completed).toBe(true);
    expect(extractionOrder).toEqual([3, 4]);
    expect(published).toEqual([3, 4]);
  });

  it('continues after a page-local extraction failure and reports the page', async () => {
    const failures: number[] = [];
    const doc = {
      numPages: 3,
      getPage: async (pageNumber: number) => ({
        getTextContent: async () => {
          if (pageNumber === 2) throw new Error('bad text stream');
          return { items: [{ str: `page ${pageNumber}` }] };
        },
      }),
    } as unknown as Parameters<typeof extractPdfPageTexts>[0];
    const result = await extractPdfPageTexts(doc, { onPageError: (page) => failures.push(page) });
    expect(result.completed).toBe(true);
    expect(result.pages).toHaveLength(2);
    expect(result.failedPageNumbers).toEqual([2]);
    expect(failures).toEqual([2]);
  });
});
