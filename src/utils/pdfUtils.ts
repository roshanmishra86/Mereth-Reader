/**
 * PDF Utility functions for Mereth Reader
 * Local-first, strict TypeScript (no `any`), pure helper functions.
 */

export interface PageTextContent {
  pageNumber: number;
  text: string;
}

export function isSecurePdfOptions(options: { disableScripting: boolean; isEvalSupported: boolean }): boolean {
  return options.disableScripting === true && options.isEvalSupported === false;
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

export interface SecureDocumentParams {
  data?: Uint8Array;
  url?: string;
  disableScripting: true;
  isEvalSupported: false;
  cMapPacked?: boolean;
  cMapUrl?: string;
  standardFontDataUrl?: string;
}

/**
 * Creates secure parameters for PDF.js document loading.
 * Enforces disableScripting: true and isEvalSupported: false (Requirement 6).
 */
export function createSecurePdfOptions(
  source: Uint8Array | string,
  extraConfig?: Record<string, unknown>
): SecureDocumentParams {
  const base: SecureDocumentParams = {
    disableScripting: true,
    isEvalSupported: false,
    cMapPacked: true,
  };

  if (typeof source === 'string') {
    base.url = source;
  } else {
    base.data = source;
  }

  if (extraConfig) {
    Object.assign(base, extraConfig, {
      disableScripting: true,
      isEvalSupported: false,
    });
  }

  return base;
}

export interface VirtualWindow {
  visibleIndices: number[];
  prefetchIndices: number[];
  renderIndices: number[];
  totalHeight: number;
  offsets: number[];
}

/**
 * Calculates virtualized page window for long-scroll PDF rendering.
 * Keeps working set memory well below 250 MB cap by rendering only
 * visible pages plus a prefetch buffer.
 */
export function calculateVirtualWindow(
  scrollTop: number,
  viewportHeight: number,
  pageHeights: number[],
  pageGap = 16,
  prefetchBuffer = 2
): VirtualWindow {
  const totalPages = pageHeights.length;
  if (totalPages === 0) {
    return {
      visibleIndices: [],
      prefetchIndices: [],
      renderIndices: [],
      totalHeight: 0,
      offsets: [],
    };
  }

  const offsets: number[] = new Array<number>(totalPages);
  let currentOffset = 0;
  for (let i = 0; i < totalPages; i++) {
    offsets[i] = currentOffset;
    currentOffset += pageHeights[i] + pageGap;
  }
  const totalHeight = Math.max(0, currentOffset - pageGap);

  const scrollBottom = scrollTop + viewportHeight;
  const visibleIndices: number[] = [];

  for (let i = 0; i < totalPages; i++) {
    const pageTop = offsets[i];
    const pageBottom = pageTop + pageHeights[i];

    if (pageBottom >= scrollTop && pageTop <= scrollBottom) {
      visibleIndices.push(i);
    }
  }

  if (visibleIndices.length === 0 && totalPages > 0) {
    if (scrollTop <= 0) {
      visibleIndices.push(0);
    } else {
      visibleIndices.push(totalPages - 1);
    }
  }

  const minVisible = visibleIndices[0];
  const maxVisible = visibleIndices[visibleIndices.length - 1];

  const minPrefetch = Math.max(0, minVisible - prefetchBuffer);
  const maxPrefetch = Math.min(totalPages - 1, maxVisible + prefetchBuffer);

  const renderIndicesSet = new Set<number>();
  for (let i = minPrefetch; i <= maxPrefetch; i++) {
    renderIndicesSet.add(i);
  }

  const renderIndices = Array.from(renderIndicesSet).sort((a, b) => a - b);
  const prefetchIndices = renderIndices.filter(idx => !visibleIndices.includes(idx));

  return {
    visibleIndices,
    prefetchIndices,
    renderIndices,
    totalHeight,
    offsets,
  };
}

export interface PDFTextItem {
  str: string;
  transform: number[]; // [scaleX, skewY, skewX, scaleY, translateX, translateY]
  width: number;
  height: number;
  dir?: string;
  fontName?: string;
}

export interface ExtractedOrderedText {
  text: string;
  confidence: number;
  isLowConfidence: boolean;
  warning?: string;
  linesCount: number;
  columnsCount: number;
}

/**
 * Extracts and sorts PDF text items into reading order (FR-8.4).
 * Preserves column order (left-to-right columns, top-to-bottom within column).
 * Evaluates extraction confidence and returns warnings if multi-column layout is ambiguous
 * or has overlapping / low-confidence text positioning.
 */
export function extractOrderedText(items: PDFTextItem[]): ExtractedOrderedText {
  if (items.length === 0) {
    return {
      text: '',
      confidence: 1.0,
      isLowConfidence: false,
      linesCount: 0,
      columnsCount: 0,
    };
  }

  const validItems = items.filter(it => it.str && it.str.trim().length > 0);

  if (validItems.length === 0) {
    return {
      text: '',
      confidence: 1.0,
      isLowConfidence: false,
      linesCount: 0,
      columnsCount: 0,
    };
  }

  const normalized = validItems.map(it => {
    const x = it.transform[4];
    const y = it.transform[5];
    const fontSize = Math.abs(it.transform[0] || it.transform[3] || 10);
    return {
      str: it.str,
      x,
      y,
      fontSize,
      width: it.width || (it.str.length * fontSize * 0.5),
      height: it.height || fontSize,
    };
  });

  let overlapCount = 0;
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      const sameLine = Math.abs(a.y - b.y) < Math.min(a.fontSize, b.fontSize) * 0.5;
      if (sameLine) {
        if (a.x < b.x + b.width && a.x + a.width > b.x) {
          overlapCount++;
        }
      }
    }
  }

  const xCoords = normalized.map(n => n.x).sort((a, b) => a - b);
  const xGaps: number[] = [];
  for (let i = 1; i < xCoords.length; i++) {
    const gap = xCoords[i] - xCoords[i - 1];
    if (gap > 40) {
      xGaps.push(gap);
    }
  }

  const minX = xCoords[0];
  const maxX = xCoords[xCoords.length - 1];
  const totalWidth = maxX - minX;

  let columns: Array<typeof normalized> = [];

  if (xGaps.length > 0 && totalWidth > 150) {
    const colBands: Array<{ startX: number; endX: number; items: typeof normalized }> = [];

    for (const item of normalized) {
      let placed = false;
      for (const band of colBands) {
        if (item.x >= band.startX - 30 && item.x <= band.endX + 30) {
          band.items.push(item);
          band.startX = Math.min(band.startX, item.x);
          band.endX = Math.max(band.endX, item.x + item.width);
          placed = true;
          break;
        }
      }
      if (!placed) {
        colBands.push({ startX: item.x, endX: item.x + item.width, items: [item] });
      }
    }

    colBands.sort((a, b) => a.startX - b.startX);
    const mergedBands: typeof colBands = [];
    for (const band of colBands) {
      if (mergedBands.length === 0) {
        mergedBands.push(band);
      } else {
        const last = mergedBands[mergedBands.length - 1];
        if (band.startX <= last.endX + 20) {
          last.items.push(...band.items);
          last.endX = Math.max(last.endX, band.endX);
        } else {
          mergedBands.push(band);
        }
      }
    }

    columns = mergedBands.map(b => b.items);
  } else {
    columns = [normalized];
  }

  const sortedLines: string[] = [];
  let totalLines = 0;

  for (const colItems of columns) {
    colItems.sort((a, b) => b.y - a.y);

    const lines: Array<typeof colItems> = [];
    for (const item of colItems) {
      let linePlaced = false;
      for (const line of lines) {
        const avgY = line.reduce((sum, el) => sum + el.y, 0) / line.length;
        const lineFontSize = line[0].fontSize;
        if (Math.abs(item.y - avgY) < lineFontSize * 0.6) {
          line.push(item);
          linePlaced = true;
          break;
        }
      }
      if (!linePlaced) {
        lines.push([item]);
      }
    }

    lines.sort((a, b) => {
      const avgYA = a.reduce((sum, el) => sum + el.y, 0) / a.length;
      const avgYB = b.reduce((sum, el) => sum + el.y, 0) / b.length;
      return avgYB - avgYA;
    });

    totalLines += lines.length;

    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      const lineText = line.map(it => it.str).join(' ').replace(/\s+/g, ' ');
      if (lineText.trim()) {
        sortedLines.push(lineText.trim());
      }
    }
  }

  const columnsCount = columns.length;
  const joinedText = sortedLines.join('\n');

  let confidence = 1.0;
  if (overlapCount > 0) {
    confidence -= Math.min(0.4, overlapCount * 0.05);
  }
  if (columnsCount > 1 && xGaps.length === 0) {
    confidence -= 0.2;
  }

  confidence = Math.max(0.1, Math.min(1.0, Math.round(confidence * 100) / 100));

  const isLowConfidence = confidence < 0.8 || overlapCount > 0;
  let warning: string | undefined;

  if (isLowConfidence) {
    if (columnsCount > 1) {
      warning = `Low-confidence multi-column text layout detected (${columnsCount} columns, confidence ${Math.round(confidence * 100)}%). Reading order may require verification.`;
    } else {
      warning = `Low-confidence text layout detected (confidence ${Math.round(confidence * 100)}%). Text items contain overlapping positioning.`;
    }
  }

  return {
    text: joinedText,
    confidence,
    isLowConfidence,
    warning,
    linesCount: totalLines,
    columnsCount,
  };
}

export interface NavigationHistoryState {
  stack: number[];
  currentIndex: number;
}

/**
 * Pure state manager for Back/Forward reading navigation history stack.
 */
export function createNavigationHistory(initialPage = 1): NavigationHistoryState {
  return {
    stack: [initialPage],
    currentIndex: 0,
  };
}

export function pushNavigationHistory(
  state: NavigationHistoryState,
  newPage: number
): NavigationHistoryState {
  if (state.stack[state.currentIndex] === newPage) {
    return state;
  }
  const newStack = state.stack.slice(0, state.currentIndex + 1);
  newStack.push(newPage);
  return {
    stack: newStack,
    currentIndex: newStack.length - 1,
  };
}

export function navigateHistoryBack(state: NavigationHistoryState): {
  state: NavigationHistoryState;
  page: number | null;
} {
  if (state.currentIndex > 0) {
    const nextIndex = state.currentIndex - 1;
    return {
      state: { ...state, currentIndex: nextIndex },
      page: state.stack[nextIndex],
    };
  }
  return { state, page: null };
}

export function navigateHistoryForward(state: NavigationHistoryState): {
  state: NavigationHistoryState;
  page: number | null;
} {
  if (state.currentIndex < state.stack.length - 1) {
    const nextIndex = state.currentIndex + 1;
    return {
      state: { ...state, currentIndex: nextIndex },
      page: state.stack[nextIndex],
    };
  }
  return { state, page: null };
}
