import { describe, it, expect, vi } from 'vitest';
import { DurableIndexingService, DurableIndexingState } from './durableIndexing';
import type * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function createFakePdfDoc(numPages: number): pdfjsLib.PDFDocumentProxy {
  return {
    numPages,
    getPage: vi.fn().mockImplementation(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: [{ str: `Page ${pageNumber} content with some text` }],
      }),
    })),
  } as unknown as pdfjsLib.PDFDocumentProxy;
}

describe('DurableIndexingService', () => {
  it('marks immediately done when all pages are already cached', async () => {
    const service = new DurableIndexingService();
    const doc = createFakePdfDoc(5);
    const cachedPages = new Set([1, 2, 3, 4, 5]);
    const states: DurableIndexingState[] = [];

    service.subscribe('doc-1', (state) => {
      states.push(state);
    });

    const result = await service.startIndexing({
      doc,
      documentId: 'doc-1',
      versionHash: 'hash-v1',
      totalPages: 5,
      cachedPageNumbers: cachedPages,
    });

    expect(result.completed).toBe(true);
    expect(states.length).toBeGreaterThanOrEqual(1);
    expect(states[states.length - 1].status).toBe('done');
    expect(states[states.length - 1].processedPages).toBe(5);
  });

  it('extracts un-cached pages and batches persistence', async () => {
    const service = new DurableIndexingService();
    const doc = createFakePdfDoc(4);
    const persistedBatches: string[][] = [];

    const result = await service.startIndexing({
      doc,
      documentId: 'doc-2',
      versionHash: 'hash-v1',
      totalPages: 4,
      batchSize: 2,
      onBatchPersist: async (pages) => {
        persistedBatches.push(pages.map((p) => `p${p.pageNumber}`));
      },
    });

    expect(result.completed).toBe(true);
    expect(result.pages).toEqual([]);
    expect(persistedBatches.length).toBeGreaterThanOrEqual(2);
    expect(service.getState('doc-2')?.status).toBe('done');
    expect(service.getState('doc-2')?.processedPages).toBe(4);
  });

  it('persists every page without retaining document text in the result', async () => {
    const service = new DurableIndexingService();
    const doc = createFakePdfDoc(101);
    const persistedPageNumbers: number[] = [];

    const result = await service.startIndexing({
      doc,
      documentId: 'bounded-memory-doc',
      versionHash: 'hash-v1',
      totalPages: 101,
      batchSize: 16,
      onBatchPersist: async (pages) => {
        persistedPageNumbers.push(...pages.map((page) => page.pageNumber));
      },
    });

    expect(result).toMatchObject({ completed: true, pages: [] });
    expect(persistedPageNumbers).toHaveLength(101);
    expect(new Set(persistedPageNumbers).size).toBe(101);
    expect(persistedPageNumbers.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: 101 }, (_, index) => index + 1),
    );
  });

  it('can be cancelled cleanly without throwing', async () => {
    const service = new DurableIndexingService();
    const doc = createFakePdfDoc(100);

    const promise = service.startIndexing({
      doc,
      documentId: 'doc-3',
      versionHash: 'hash-v1',
      totalPages: 100,
    });

    service.cancel('doc-3');
    const result = await promise;

    expect(result.completed).toBe(false);
    expect(service.getState('doc-3')?.status).toBe('cancelled');
  });

  it('tracks scrolling state and pause notifications', () => {
    const service = new DurableIndexingService();
    expect(service.isScrolling()).toBe(false);

    service.notifyScrollActive(100);
    expect(service.isScrolling()).toBe(true);
  });

  it('supports dynamic reprioritization during active extraction', async () => {
    const service = new DurableIndexingService();
    const doc = createFakePdfDoc(50);
    const extractionOrder: number[] = [];

    const promise = service.startIndexing({
      doc,
      documentId: 'doc-reprioritize',
      versionHash: 'hash-v1',
      totalPages: 50,
      activePage: 1,
      batchSize: 2,
      onBatchPersist: async (pages) => {
        for (const p of pages) {
          extractionOrder.push(p.pageNumber);
          if (extractionOrder.length === 2) {
            // User jumped to page 30
            service.reprioritize('doc-reprioritize', 30);
          }
        }
      },
    });

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(extractionOrder.length).toBe(50);
    expect(new Set(extractionOrder).size).toBe(50);
    // Page 30 should be near the front after reprioritization
    expect(extractionOrder.slice(2, 6)).toContain(30);
  });

  it('does not let a cancelled generation overwrite its replacement', async () => {
    let releaseFirstPage: (() => void) | undefined;
    const firstPageBlocked = new Promise<void>((resolve) => {
      releaseFirstPage = resolve;
    });
    const slowDoc = {
      numPages: 3,
      getPage: vi.fn().mockImplementation(async (pageNumber: number) => ({
        getTextContent: async () => {
          if (pageNumber === 1) await firstPageBlocked;
          return { items: [{ str: `old ${pageNumber}` }] };
        },
      })),
    } as unknown as pdfjsLib.PDFDocumentProxy;
    const replacementDoc = createFakePdfDoc(3);
    const service = new DurableIndexingService();

    const oldRun = service.startIndexing({
      doc: slowDoc,
      documentId: 'same-doc',
      versionHash: 'hash-v1',
      totalPages: 3,
      onBatchPersist: async () => {},
    });
    await vi.waitFor(() => expect(slowDoc.getPage).toHaveBeenCalled());

    const newRun = service.startIndexing({
      doc: replacementDoc,
      documentId: 'same-doc',
      versionHash: 'hash-v2',
      totalPages: 3,
      onBatchPersist: async () => {},
    });
    releaseFirstPage?.();
    await Promise.all([oldRun, newRun]);

    expect(service.getState('same-doc')).toMatchObject({
      versionHash: 'hash-v2',
      status: 'done',
      processedPages: 3,
    });
  });

  it('can retry a failed persistence run using the same document id', async () => {
    const service = new DurableIndexingService();
    const doc = createFakePdfDoc(4);

    await service.startIndexing({
      doc,
      documentId: 'retry-doc',
      versionHash: 'hash-v1',
      totalPages: 4,
      batchSize: 2,
      onBatchPersist: async () => { throw new Error('write failed'); },
    });
    expect(service.getState('retry-doc')?.status).toBe('failed');

    await service.startIndexing({
      doc,
      documentId: 'retry-doc',
      versionHash: 'hash-v1',
      totalPages: 4,
      batchSize: 2,
      onBatchPersist: async () => {},
    });
    expect(service.getState('retry-doc')).toMatchObject({ status: 'done', processedPages: 4 });
  });

  it('reset discards completed state so a cleared cache can be rebuilt', async () => {
    const service = new DurableIndexingService();
    const doc = createFakePdfDoc(3);

    await service.startIndexing({
      doc,
      documentId: 'rebuild-doc',
      versionHash: 'hash-v1',
      totalPages: 3,
      onBatchPersist: async () => {},
    });
    expect(service.getState('rebuild-doc')?.status).toBe('done');

    service.reset('rebuild-doc');
    expect(service.getState('rebuild-doc')).toBeUndefined();

    const persisted: number[] = [];
    await service.startIndexing({
      doc,
      documentId: 'rebuild-doc',
      versionHash: 'hash-v1',
      totalPages: 3,
      cachedPageNumbers: new Set(),
      onBatchPersist: async (pages) => {
        persisted.push(...pages.map((page) => page.pageNumber));
      },
    });
    expect(persisted).toHaveLength(3);
    expect(service.getState('rebuild-doc')?.status).toBe('done');
  });
});
