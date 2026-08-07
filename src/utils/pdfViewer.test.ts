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
import { loadPdfDocument, renderPdfPageToCanvas } from './pdfViewer';

describe('pdfViewer utility', () => {
  it('loadPdfDocument returns null gracefully when binary IPC is unavailable or missing file', async () => {
    const result = await loadPdfDocument('/nonexistent/file.pdf');
    expect(result).toBeNull();
  });

  it('renderPdfPageToCanvas returns null for invalid page numbers', async () => {
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

    expect(outOfBounds).toBeNull();
  });
});
