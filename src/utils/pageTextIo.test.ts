import { describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { loadVersionedPageTexts, persistVersionedPageText, persistVersionedPageTexts } from './pageTextIo';

describe('versioned page-text persistence bridge', () => {
  it('hydrates searchable page text for the exact source hash', async () => {
    invokeMock.mockResolvedValueOnce([{ page_number: 2, text_content: 'cached evidence' }]);
    await expect(loadVersionedPageTexts('doc-1', 'sha-v1')).resolves.toEqual([
      { pageNumber: 2, text: 'cached evidence' },
    ]);
    expect(invokeMock).toHaveBeenCalledWith('db_get_pages_for_version', {
      documentId: 'doc-1', versionHash: 'sha-v1',
    });
  });

  it('persists each extracted page with the source hash', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await persistVersionedPageText('doc-1', 'sha-v2', { pageNumber: 3, text: 'new text' });
    expect(invokeMock).toHaveBeenCalledWith('db_upsert_page_for_version', expect.objectContaining({
      versionHash: 'sha-v2',
      page: expect.objectContaining({ document_id: 'doc-1', page_number: 3, text_content: 'new text' }),
    }));
  });

  it('persists a page batch in one desktop-process call', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await persistVersionedPageTexts('doc-1', 'sha-v3', [
      { pageNumber: 1, text: 'one' },
      { pageNumber: 2, text: 'two' },
    ]);
    expect(invokeMock).toHaveBeenCalledWith('db_upsert_pages_for_version', expect.objectContaining({
      versionHash: 'sha-v3',
      pages: [
        expect.objectContaining({ page_number: 1, text_content: 'one' }),
        expect.objectContaining({ page_number: 2, text_content: 'two' }),
      ],
    }));
  });
});
