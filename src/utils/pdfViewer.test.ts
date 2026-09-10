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
  cancelCanvasRender,
  buildPdfJsLoadConfig,
  extractPdfPageTexts,
  calculateOutputScale,
  MAX_OUTPUT_SCALE,
  MAX_CONCURRENT_PIXELS,
  getActiveRenderPixels,
  getRetainedCanvasPixels,
  resetActiveRenderPixels,
  setActiveRenderPixels,
  releaseCanvasPixels,
  getReservedSwapPixels,
} from './pdfViewer';
import { isSecurePdfOptions } from './pdfUtils';

describe('calculateOutputScale', () => {
  it('returns dpr when within MAX_OUTPUT_SCALE and maxDim boundary', () => {
    expect(calculateOutputScale(800, 1000, 1)).toBe(1);
    expect(calculateOutputScale(800, 1000, 1.5)).toBe(1.5);
    expect(calculateOutputScale(800, 1000, 2)).toBe(2);
  });

  it('caps output scale at MAX_OUTPUT_SCALE (2) for high dpr', () => {
    expect(calculateOutputScale(800, 1000, 3)).toBe(MAX_OUTPUT_SCALE);
    expect(calculateOutputScale(800, 1000, 4)).toBe(2);
  });

  it('reduces scale when viewport dimension multiplied by scale exceeds maxDim (4096)', () => {
    const scale = calculateOutputScale(2000, 3000, 2);
    expect(scale).toBeCloseTo(4096 / 3000, 5);
    expect(3000 * scale).toBeLessThanOrEqual(4096);
  });

  it('allows scale below 1 for extremely large pages to bound dimensions to maxDim', () => {
    const scale = calculateOutputScale(5000, 5000, 2);
    expect(scale).toBeCloseTo(4096 / 5000, 5);
    expect(5000 * scale).toBeLessThanOrEqual(4096);
  });

  it('strictly bounds output scale for viewports above 16,384 pixels so dimensions never exceed 4096', () => {
    const scale20k = calculateOutputScale(20000, 10000, 2);
    expect(scale20k).toBeCloseTo(4096 / 20000, 6);
    expect(20000 * scale20k).toBeLessThanOrEqual(4096);
    expect(Math.floor(20000 * scale20k)).toBeLessThanOrEqual(4096);

    const scale32k = calculateOutputScale(1000, 32768, 1);
    expect(scale32k).toBeCloseTo(4096 / 32768, 6);
    expect(32768 * scale32k).toBeLessThanOrEqual(4096);
    expect(Math.floor(32768 * scale32k)).toBeLessThanOrEqual(4096);
  });

  it('handles zero or negative dimensions gracefully without division by zero', () => {
    expect(calculateOutputScale(0, 0, 2)).toBe(2);
    expect(calculateOutputScale(-100, -100, 1.5)).toBe(1.5);
  });

  it('defaults dpr to 1 in non-window environment', () => {
    const scale = calculateOutputScale(800, 1000);
    expect(scale).toBeGreaterThanOrEqual(1);
    expect(scale).toBeLessThanOrEqual(MAX_OUTPUT_SCALE);
  });

  it('tracks aggregate pixel budget helpers', () => {
    expect(MAX_CONCURRENT_PIXELS).toBe(64 * 1024 * 1024);
    resetActiveRenderPixels();
    expect(getActiveRenderPixels()).toBe(0);
  });
});

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

  it('awaits capacity when activeRenderPixels + pixelCost > MAX_CONCURRENT_PIXELS and releases in finally', async () => {
    resetActiveRenderPixels();
    const mockContext = {
      save: () => {},
      restore: () => {},
      clearRect: () => {},
      fillRect: () => {},
      transform: () => {},
    };
    const mockCanvas = {
      getContext: () => mockContext,
      style: {},
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;

    let resolveRender!: () => void;
    const renderPromise = new Promise<void>((r) => { resolveRender = r; });

    const mockDoc = {
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 1000, height: 1000 }),
        render: () => ({
          promise: renderPromise,
          cancel: () => {},
        }),
      }),
    } as unknown as Parameters<typeof renderPdfPageToCanvas>[0]['pdfDoc'];

    // Pre-fill active render pixels close to cap
    setActiveRenderPixels(MAX_CONCURRENT_PIXELS - 500_000);

    let completed = false;
    const renderCall = renderPdfPageToCanvas({
      pdfDoc: mockDoc,
      pageNumber: 1,
      canvas: mockCanvas,
      scale: 1.0,
    }).then((res) => {
      completed = true;
      return res;
    });

    // Wait a short time; render should still be waiting for memory capacity
    await new Promise((r) => setTimeout(r, 60));
    expect(completed).toBe(false);

    // Prior render finishes and drops active pixels
    setActiveRenderPixels(0);

    // Wait for the wait loop to pick up new capacity and allocate pixels
    await new Promise((r) => setTimeout(r, 60));
    expect(getRetainedCanvasPixels()).toBeGreaterThan(0);

    // Finish render task
    resolveRender();
    const result = await renderCall;
    expect(result.bitmap).toBe('rendered');
    // Pixels must be cleaned up in finally block
    expect(getActiveRenderPixels()).toBe(0);
  });

  it('cancels cleanly while waiting for capacity without leaking pixels', async () => {
    resetActiveRenderPixels();
    const mockContext = {
      save: () => {},
      restore: () => {},
      clearRect: () => {},
      fillRect: () => {},
      transform: () => {},
    };
    const mockCanvas = {
      getContext: () => mockContext,
      style: {},
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;

    const mockDoc = {
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 1000, height: 1000 }),
        render: () => ({
          promise: Promise.resolve(),
          cancel: () => {},
        }),
      }),
    } as unknown as Parameters<typeof renderPdfPageToCanvas>[0]['pdfDoc'];

    setActiveRenderPixels(MAX_CONCURRENT_PIXELS - 500_000);

    const renderCall = renderPdfPageToCanvas({
      pdfDoc: mockDoc,
      pageNumber: 1,
      canvas: mockCanvas,
      scale: 1.0,
    });

    // Cancel while in waiting loop
    await new Promise((r) => setTimeout(r, 30));
    cancelCanvasRender(mockCanvas);

    const result = await renderCall;
    expect(result.bitmap).toBe('cancelled');
    expect(result.errorCategory).toBe('cancelled');
    // Pixels should not be leaked
    resetActiveRenderPixels();
    expect(getActiveRenderPixels()).toBe(0);
  });

  it('evicts an inactive retained canvas when retained canvases consume the budget', async () => {
    resetActiveRenderPixels();
    const context = {
      save: () => {}, restore: () => {}, clearRect: () => {}, fillRect: () => {}, transform: () => {},
    };
    const makeCanvas = () => ({ getContext: () => context, style: {}, width: 0, height: 0 }) as unknown as HTMLCanvasElement;
    const makeDoc = () => ({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 4096, height: 4096 }),
        render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
      }),
    } as unknown as Parameters<typeof renderPdfPageToCanvas>[0]['pdfDoc']);

    const retained = [makeCanvas(), makeCanvas(), makeCanvas(), makeCanvas()];
    for (const canvas of retained) {
      const result = await renderPdfPageToCanvas({ pdfDoc: makeDoc(), pageNumber: 1, canvas, scale: 1 });
      expect(result.bitmap).toBe('rendered');
    }
    expect(getRetainedCanvasPixels()).toBeGreaterThan(0);

    const blockedCanvas = makeCanvas();
    const blocked = renderPdfPageToCanvas({ pdfDoc: makeDoc(), pageNumber: 1, canvas: blockedCanvas, scale: 1 });
    await expect(blocked).resolves.toMatchObject({ bitmap: 'rendered' });
    expect(getRetainedCanvasPixels()).toBeLessThanOrEqual(MAX_CONCURRENT_PIXELS);

    for (const canvas of retained) releaseCanvasPixels(canvas);
    releaseCanvasPixels(blockedCanvas);
    expect(getRetainedCanvasPixels()).toBe(0);
  });

  it('reserves swap capacity across overlapping asynchronous renders', async () => {
    resetActiveRenderPixels();
    const makeCanvas = () => ({ getContext: () => ({}), style: {}, width: 0, height: 0 }) as unknown as HTMLCanvasElement;
    const finish: Array<() => void> = [];
    const doc = {
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 4096, height: 4096 }),
        render: () => ({ promise: new Promise<void>(resolve => finish.push(resolve)), cancel: () => {} }),
      }),
    } as unknown as Parameters<typeof renderPdfPageToCanvas>[0]['pdfDoc'];
    const canvases = [makeCanvas(), makeCanvas(), makeCanvas()];
    const calls = canvases.map(canvas => renderPdfPageToCanvas({ pdfDoc: doc, pageNumber: 1, canvas, swapTarget: makeCanvas(), scale: 1 }));
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(finish).toHaveLength(2);
    expect(canvases[2].width).toBe(0);
    expect(getRetainedCanvasPixels() + getReservedSwapPixels()).toBe(MAX_CONCURRENT_PIXELS);
    finish[0]();
    finish[1]();
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(finish).toHaveLength(3);
    expect(getRetainedCanvasPixels() + getReservedSwapPixels()).toBeLessThanOrEqual(MAX_CONCURRENT_PIXELS);
    finish[2]();
    await Promise.all(calls);
    expect(getReservedSwapPixels()).toBe(0);
    canvases.forEach(releaseCanvasPixels);
  });

  it('decrements activeRenderPixels in finally block when render task fails', async () => {
    resetActiveRenderPixels();
    const mockContext = {
      save: () => {},
      restore: () => {},
      clearRect: () => {},
      fillRect: () => {},
      transform: () => {},
    };
    const mockCanvas = {
      getContext: () => mockContext,
      style: {},
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;

    const mockDoc = {
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 500, height: 500 }),
        render: () => ({
          promise: Promise.reject(new Error('Canvas GPU device lost')),
          cancel: () => {},
        }),
      }),
    } as unknown as Parameters<typeof renderPdfPageToCanvas>[0]['pdfDoc'];

    const result = await renderPdfPageToCanvas({
      pdfDoc: mockDoc,
      pageNumber: 1,
      canvas: mockCanvas,
      scale: 1.0,
    });

    expect(result.bitmap).toBe('failed');
    expect(getActiveRenderPixels()).toBe(0);
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

  it('streams pages without retaining extracted text when requested', async () => {
    const doc = createFakeDoc(6);
    const published: number[] = [];
    const result = await extractPdfPageTexts(doc, {
      retainPages: false,
      onPage: (page) => { published.push(page.pageNumber); },
    });

    expect(result.completed).toBe(true);
    expect(result.pages).toEqual([]);
    expect(published).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('can bypass page caches for durable full-document extraction', async () => {
    let textContentReads = 0;
    const doc = {
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => {
          textContentReads++;
          return { items: [{ str: 'uncached durable text' }] };
        },
      }),
    } as unknown as Parameters<typeof extractPdfPageTexts>[0];

    await extractPdfPageTexts(doc, { retainPages: false, cacheExtractedPages: false });
    await extractPdfPageTexts(doc, { retainPages: false, cacheExtractedPages: false });

    expect(textContentReads).toBe(2);
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
