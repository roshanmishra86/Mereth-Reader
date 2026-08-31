import { describe, it, expect, vi } from 'vitest';
import { performAdvancedSearch, getNextMatchIndex, DEFAULT_SEARCH_OPTIONS } from '../utils/searchUtils';
import { DurableIndexingService } from '../utils/durableIndexing';
import { PageTextContent } from '../utils/pdfUtils';
import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Creates a mock PDFDocumentProxy with synthetic text content.
 * NOTE: This is NOT a real pdf.js document — it cannot test actual rendering,
 * worker-thread contention, or canvas behaviour. It is useful for testing
 * DurableIndexingService batch/priority/cancel logic.
 */
function createMockPdfDoc(numPages = 1056): pdfjsLib.PDFDocumentProxy {
  return {
    numPages,
    getPage: vi.fn().mockImplementation(async (pageNumber: number) => {
      return {
        getTextContent: async () => ({
          items: [
            { str: `Chapter ${Math.ceil(pageNumber / 25)}: Analysis of distributed cognitive systems.` },
            { str: `Page ${pageNumber} of ${numPages}. Detailed discourse on scalable full-text indexing.` },
            pageNumber === 750
              ? { str: 'Critical unique keyword: QuantumCoherenceVerification present on page 750.' }
              : { str: 'Standard background textual discourse with regular vocabulary.' },
          ],
        }),
        getViewport: () => ({ width: 612, height: 792 }),
      };
    }),
  } as unknown as pdfjsLib.PDFDocumentProxy;
}

describe('DurableIndexingService Integration (mocked pdf.js)', () => {
  it('indexes 1,056 pages with batched persistence and progress callbacks', async () => {
    const doc = createMockPdfDoc(1056);
    const service = new DurableIndexingService();
    const persistedBatches: PageTextContent[][] = [];
    let progressUpdateCount = 0;

    const result = await service.startIndexing({
      doc,
      documentId: 'doc-large-1056-durable',
      versionHash: 'hash-v1',
      totalPages: 1056,
      batchSize: 32,
      onJobProgress: (_jobId, _processed) => {
        progressUpdateCount++;
      },
      onBatchPersist: async (pages) => {
        persistedBatches.push(pages);
      },
    });

    expect(result.completed).toBe(true);
    // Durable indexing streams text into bounded persistence batches instead
    // of retaining an additional 1,056-page result array.
    expect(result.pages).toEqual([]);
    expect(persistedBatches.reduce((total, batch) => total + batch.length, 0)).toBe(1056);
    expect(persistedBatches.length).toBe(33); // 1056 / 32 = 33 batches
    expect(Math.max(...persistedBatches.map((batch) => batch.length))).toBeLessThanOrEqual(32);
    const persistedPageNumbers = persistedBatches.flatMap((batch) =>
      batch.map((page) => page.pageNumber)
    );
    expect(new Set(persistedPageNumbers).size).toBe(1056);
    expect(progressUpdateCount).toBeGreaterThanOrEqual(1);
    expect(service.getState('doc-large-1056-durable')?.status).toBe('done');
    expect(service.getState('doc-large-1056-durable')?.processedPages).toBe(1056);
    expect(service.getState('doc-large-1056-durable')?.batchVersion).toBe(33);
  });

  it('marks status as failed when batch persistence rejects', async () => {
    const doc = createMockPdfDoc(10);
    const service = new DurableIndexingService();
    let persistCallCount = 0;

    const result = await service.startIndexing({
      doc,
      documentId: 'doc-persist-fail',
      versionHash: 'hash-v1',
      totalPages: 10,
      batchSize: 5,
      onBatchPersist: async () => {
        persistCallCount++;
        throw new Error('Simulated DB write failure');
      },
    });

    // Extraction itself completes (pages were visited) but persistence failed
    expect(result.completed).toBe(true);
    const state = service.getState('doc-persist-fail');
    expect(state?.status).toBe('failed');
    // No pages should be counted as persisted
    expect(state?.processedPages).toBe(0);
    expect(state?.error).toContain('failed to persist');
    expect(persistCallCount).toBe(2); // 10 pages / 5 batch = 2 calls
  });

  it('dynamically reprioritizes extraction to active reading position', async () => {
    const doc = createMockPdfDoc(500);
    const service = new DurableIndexingService();
    const extractedOrder: number[] = [];

    const result = await service.startIndexing({
      doc,
      documentId: 'doc-reprioritize-test',
      versionHash: 'hash-v1',
      totalPages: 500,
      activePage: 1,
      batchSize: 4,
      onBatchPersist: async (pages) => {
        for (const p of pages) {
          extractedOrder.push(p.pageNumber);
          if (extractedOrder.length === 4) {
            // Simulate user navigating to page 450
            service.reprioritize('doc-reprioritize-test', 450);
          }
        }
      },
    });

    expect(result.completed).toBe(true);
    expect(extractedOrder).toHaveLength(500);
    expect(new Set(extractedOrder).size).toBe(500);
    // Pages around 450 should appear promptly after the first persisted batch.
    const postReprioritize = extractedOrder.slice(4, 16);
    expect(postReprioritize.some((p) => p >= 445 && p <= 455)).toBe(true);
  });

  it('detects stale version hash and allows re-indexing', async () => {
    const doc = createMockPdfDoc(5);
    const service = new DurableIndexingService();

    await service.startIndexing({
      doc,
      documentId: 'doc-version-test',
      versionHash: 'hash-v1',
      totalPages: 5,
      batchSize: 5,
      onBatchPersist: async () => {},
    });

    expect(service.getState('doc-version-test')?.status).toBe('done');
    expect(service.isStaleVersion('doc-version-test', 'hash-v1')).toBe(false);
    expect(service.isStaleVersion('doc-version-test', 'hash-v2')).toBe(true);
  });
});

describe('In-memory search fallback (not SQLite FTS)', () => {
  it('finds one unique keyword without duplicating or mutating 1,056-page input', () => {
    const largePages: PageTextContent[] = Array.from({ length: 1056 }, (_, i) => ({
      pageNumber: i + 1,
      text: i === 749
        ? 'Special key phrase: QuantumCoherenceVerification occurs on page 750.'
        : `Regular background body text on page ${i + 1}.`,
    }));

    const matches = performAdvancedSearch(largePages, 'QuantumCoherenceVerification', DEFAULT_SEARCH_OPTIONS);

    expect(matches.length).toBe(1);
    expect(matches[0].pageNumber).toBe(750);
    expect(matches[0].matchedText).toBe('QuantumCoherenceVerification');
    expect(matches[0].snippet).toContain('QuantumCoherenceVerification');
    expect(largePages).toHaveLength(1056);
    expect(largePages[749].pageNumber).toBe(750);
  });

  it('cycles search match indices correctly', () => {
    expect(getNextMatchIndex(0, 50, 'next')).toBe(1);
    expect(getNextMatchIndex(49, 50, 'next')).toBe(0);
    expect(getNextMatchIndex(0, 50, 'prev')).toBe(49);
    expect(getNextMatchIndex(25, 50, 'prev')).toBe(24);
  });
});
