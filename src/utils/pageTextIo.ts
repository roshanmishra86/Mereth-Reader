import { invoke } from '@tauri-apps/api/core';
import { PageTextContent } from './pdfUtils';

interface StoredPage {
  id: string;
  document_id: string;
  page_number: number;
  width: number;
  height: number;
  text_content: string;
  created_at: string;
  provenance: 'source_extracted';
}

export async function loadVersionedPageTexts(documentId: string, versionHash: string): Promise<PageTextContent[]> {
  const rows = await invoke<StoredPage[]>('db_get_pages_for_version', {
    documentId,
    versionHash,
  });
  return rows.map((row) => ({ pageNumber: row.page_number, text: row.text_content }));
}

export async function persistVersionedPageText(
  documentId: string,
  versionHash: string,
  page: PageTextContent,
): Promise<void> {
  const stored: StoredPage = {
    id: `${documentId}:${versionHash}:${page.pageNumber}`,
    document_id: documentId,
    page_number: page.pageNumber,
    width: 0,
    height: 0,
    text_content: page.text,
    created_at: new Date().toISOString(),
    provenance: 'source_extracted',
  };
  await invoke('db_upsert_page_for_version', { page: stored, versionHash });
}

export async function persistVersionedPageTexts(
  documentId: string,
  versionHash: string,
  pages: PageTextContent[],
): Promise<void> {
  if (pages.length === 0) return;
  const createdAt = new Date().toISOString();
  const stored: StoredPage[] = pages.map((page) => ({
    id: `${documentId}:${versionHash}:${page.pageNumber}`,
    document_id: documentId,
    page_number: page.pageNumber,
    width: 0,
    height: 0,
    text_content: page.text,
    created_at: createdAt,
    provenance: 'source_extracted',
  }));
  await invoke('db_upsert_pages_for_version', { pages: stored, versionHash });
}
