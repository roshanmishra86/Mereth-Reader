/**
 * PDF Utility functions for Mereth Reader
 * Local-first, strict TypeScript (no `any`), pure helper functions.
 */

export interface PageTextContent {
  pageNumber: number;
  text: string;
}

export interface SearchMatch {
  id: string;
  pageNumber: number;
  matchIndex: number;
  matchLength: number;
  snippet: string;
}

export interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  pageNumber?: number;
  items?: OutlineItem[];
}

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

/**
 * Calculates a new zoom scale based on current scale and zoom action.
 */
export function calculateZoomScale(
  currentScale: number,
  action: 'zoom-in' | 'zoom-out' | 'reset' | 'fit-width' | 'fit-page',
  containerWidth?: number,
  pageWidth?: number,
  containerHeight?: number,
  pageHeight?: number
): { scale: number; mode: ZoomMode } {
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3.0;
  const STEP = 0.25;

  switch (action) {
    case 'zoom-in': {
      const newScale = Math.min(MAX_SCALE, Math.round((currentScale + STEP) * 100) / 100);
      return { scale: newScale, mode: 'custom' };
    }
    case 'zoom-out': {
      const newScale = Math.max(MIN_SCALE, Math.round((currentScale - STEP) * 100) / 100);
      return { scale: newScale, mode: 'custom' };
    }
    case 'reset': {
      return { scale: 1.0, mode: 'custom' };
    }
    case 'fit-width': {
      if (containerWidth && pageWidth && pageWidth > 0) {
        const padding = 40; // horizontal padding in px
        const targetWidth = Math.max(200, containerWidth - padding);
        const calculatedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetWidth / pageWidth));
        return { scale: Math.round(calculatedScale * 100) / 100, mode: 'fit-width' };
      }
      return { scale: 1.0, mode: 'fit-width' };
    }
    case 'fit-page': {
      if (containerWidth && pageWidth && containerHeight && pageHeight && pageWidth > 0 && pageHeight > 0) {
        const paddingW = 40;
        const paddingH = 60;
        const scaleW = (containerWidth - paddingW) / pageWidth;
        const scaleH = (containerHeight - paddingH) / pageHeight;
        const calculatedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(scaleW, scaleH)));
        return { scale: Math.round(calculatedScale * 100) / 100, mode: 'fit-page' };
      }
      return { scale: 1.0, mode: 'fit-page' };
    }
  }
}

/**
 * Searches for a text query across cached page texts.
 * Returns array of matches with surrounding snippets.
 */
export function searchPdfText(
  pages: PageTextContent[],
  query: string,
  snippetPadding = 30
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) return matches;

  for (const page of pages) {
    const textLower = page.text.toLowerCase();
    let startIndex = 0;

    while (startIndex < textLower.length) {
      const foundIndex = textLower.indexOf(trimmedQuery, startIndex);
      if (foundIndex === -1) break;

      const snippetStart = Math.max(0, foundIndex - snippetPadding);
      const snippetEnd = Math.min(page.text.length, foundIndex + trimmedQuery.length + snippetPadding);
      const rawSnippet = page.text.slice(snippetStart, snippetEnd).replace(/\s+/g, ' ');
      const prefix = snippetStart > 0 ? '...' : '';
      const suffix = snippetEnd < page.text.length ? '...' : '';

      matches.push({
        id: `p${page.pageNumber}-m${foundIndex}`,
        pageNumber: page.pageNumber,
        matchIndex: foundIndex,
        matchLength: trimmedQuery.length,
        snippet: `${prefix}${rawSnippet}${suffix}`,
      });

      startIndex = foundIndex + Math.max(1, trimmedQuery.length);
    }
  }

  return matches;
}

/**
 * Formats a page label string cleanly for display.
 */
export function formatPageLabel(currentPage: number, totalPages: number, pageTitle?: string): string {
  if (totalPages <= 0) return 'Page 0 of 0';
  const validCurrent = Math.max(1, Math.min(currentPage, totalPages));
  if (pageTitle && pageTitle.trim()) {
    return `${validCurrent} / ${totalPages} · ${pageTitle.trim()}`;
  }
  return `${validCurrent} / ${totalPages}`;
}
