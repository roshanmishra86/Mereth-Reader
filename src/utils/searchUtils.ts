/**
 * Full-text search depth algorithm for Mereth Reader.
 * Deterministic extracted text search supporting case-sensitive, whole-word,
 * and diacritic-tolerant search options with snippet previews.
 * Strict TypeScript without `any`.
 */

import { PageTextContent } from './pdfUtils';
import { normalizeDiacritics } from './diacritics';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  diacriticTolerant: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  diacriticTolerant: true,
};

export interface MatchHighlightRange {
  start: number;
  end: number;
}

export interface DetailedSearchMatch {
  id: string;
  pageNumber: number;
  matchIndex: number; // Character index in original page text
  matchLength: number;
  matchedText: string;
  snippet: string;
  snippetMatchRange: MatchHighlightRange;
}

/**
 * Checks if a character at index is part of a word boundary.
 */
function isWordChar(char: string | undefined): boolean {
  if (!char) return false;
  return /[\p{L}\p{N}_]/u.test(char);
}

/**
 * Performs deep full-text search over extracted PDF page text contents.
 */
export function performAdvancedSearch(
  pages: PageTextContent[],
  query: string,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS,
  snippetPadding = 35
): DetailedSearchMatch[] {
  const matches: DetailedSearchMatch[] = [];
  const rawQuery = query.trim();
  if (!rawQuery) return matches;

  // Prepare normalized query according to options
  let targetQuery = rawQuery;
  if (options.diacriticTolerant) {
    targetQuery = normalizeDiacritics(targetQuery);
  }
  if (!options.caseSensitive) {
    targetQuery = targetQuery.toLowerCase();
  }

  const queryLen = targetQuery.length;
  if (queryLen === 0) return matches;

  let globalMatchCounter = 0;

  for (const page of pages) {
    const originalText = page.text;
    let searchableText = originalText;

    if (options.diacriticTolerant) {
      searchableText = normalizeDiacritics(searchableText);
    }
    if (!options.caseSensitive) {
      searchableText = searchableText.toLowerCase();
    }

    let searchOffset = 0;

    while (searchOffset < searchableText.length) {
      const foundIdx = searchableText.indexOf(targetQuery, searchOffset);
      if (foundIdx === -1) break;

      // Check whole-word boundary if enabled
      let isValidWordBoundary = true;
      if (options.wholeWord) {
        const charBefore = searchableText[foundIdx - 1];
        const charAfter = searchableText[foundIdx + queryLen];
        if (isWordChar(charBefore) || isWordChar(charAfter)) {
          isValidWordBoundary = false;
        }
      }

      if (isValidWordBoundary) {
        globalMatchCounter++;
        const matchedText = originalText.slice(foundIdx, foundIdx + queryLen);

        // Build snippet
        const snippetStart = Math.max(0, foundIdx - snippetPadding);
        const snippetEnd = Math.min(originalText.length, foundIdx + queryLen + snippetPadding);

        const rawSnippet = originalText.slice(snippetStart, snippetEnd);
        const prefix = snippetStart > 0 ? '…' : '';
        const suffix = snippetEnd < originalText.length ? '…' : '';

        const fullSnippet = `${prefix}${rawSnippet}${suffix}`;
        const matchStartInSnippet = prefix.length + (foundIdx - snippetStart);
        const matchEndInSnippet = matchStartInSnippet + queryLen;

        matches.push({
          id: `match-${page.pageNumber}-${globalMatchCounter}`,
          pageNumber: page.pageNumber,
          matchIndex: foundIdx,
          matchLength: queryLen,
          matchedText,
          snippet: fullSnippet,
          snippetMatchRange: {
            start: matchStartInSnippet,
            end: matchEndInSnippet,
          },
        });
      }

      searchOffset = foundIdx + Math.max(1, queryLen);
    }
  }

  return matches;
}

/**
 * Finds the index of the next search match given the current match index and traversal action.
 */
export function getNextMatchIndex(
  currentIndex: number,
  totalMatches: number,
  direction: 'next' | 'prev'
): number {
  if (totalMatches <= 0) return 0;
  if (direction === 'next') {
    return (currentIndex + 1) % totalMatches;
  } else {
    return (currentIndex - 1 + totalMatches) % totalMatches;
  }
}
