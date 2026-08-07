import { describe, it, expect } from 'vitest';
import {
  performAdvancedSearch,
  getNextMatchIndex,
  DEFAULT_SEARCH_OPTIONS,
} from './searchUtils';
import { PageTextContent } from './pdfUtils';

const mockPages: PageTextContent[] = [
  {
    pageNumber: 1,
    text: 'Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention. Students read short prose passages.',
  },
  {
    pageNumber: 2,
    text: 'Educational practice treats assessment as an instrument. Café testing and restudy performance differ under delay.',
  },
  {
    pageNumber: 3,
    text: 'Repeated studying produced immediate fluency, but testing strengthened retrieval routes.',
  },
];

describe('searchUtils', () => {
  it('returns empty results for empty query', () => {
    const results = performAdvancedSearch(mockPages, '');
    expect(results).toEqual([]);
  });

  it('performs default diacritic-tolerant case-insensitive search', () => {
    const results = performAdvancedSearch(mockPages, 'cafe');
    expect(results.length).toBe(1);
    expect(results[0].pageNumber).toBe(2);
    expect(results[0].matchedText).toBe('Café');
    expect(results[0].snippet).toContain('Café');
  });

  it('respects case-sensitive toggle', () => {
    const caseInsensitive = performAdvancedSearch(mockPages, 'learning', {
      caseSensitive: false,
      wholeWord: false,
      diacriticTolerant: true,
    });
    expect(caseInsensitive.length).toBe(1);

    const caseSensitive = performAdvancedSearch(mockPages, 'learning', {
      caseSensitive: true,
      wholeWord: false,
      diacriticTolerant: true,
    });
    expect(caseSensitive.length).toBe(0);

    const caseMatch = performAdvancedSearch(mockPages, 'Learning', {
      caseSensitive: true,
      wholeWord: false,
      diacriticTolerant: true,
    });
    expect(caseMatch.length).toBe(1);
  });

  it('respects whole-word toggle', () => {
    const substringResults = performAdvancedSearch(mockPages, 'test', {
      caseSensitive: false,
      wholeWord: false,
      diacriticTolerant: true,
    });
    // Should match "Test-Enhanced", "Tests", "testing", "test"
    expect(substringResults.length).toBeGreaterThan(1);

    const wholeWordResults = performAdvancedSearch(mockPages, 'test', {
      caseSensitive: false,
      wholeWord: true,
      diacriticTolerant: true,
    });
    // Matches "test" where bounded by non-word chars
    for (const match of wholeWordResults) {
      expect(match.matchedText.toLowerCase()).toBe('test');
    }
  });

  it('calculates snippet match ranges accurately', () => {
    const results = performAdvancedSearch(mockPages, 'Retrieval', DEFAULT_SEARCH_OPTIONS);
    expect(results.length).toBe(1);
    const match = results[0];
    const highlightedSnippet = match.snippet.slice(
      match.snippetMatchRange.start,
      match.snippetMatchRange.end
    );
    expect(highlightedSnippet.toLowerCase()).toBe('retrieval');
  });

  it('cycles match indices forward and backward', () => {
    expect(getNextMatchIndex(0, 5, 'next')).toBe(1);
    expect(getNextMatchIndex(4, 5, 'next')).toBe(0);
    expect(getNextMatchIndex(0, 5, 'prev')).toBe(4);
    expect(getNextMatchIndex(2, 5, 'prev')).toBe(1);
    expect(getNextMatchIndex(0, 0, 'next')).toBe(0);
  });

  it('maps diacritic-tolerant matches back to original-text indices when ligatures shift positions', () => {
    // The ligature ß expands to "ss" in the normalized text, so every index
    // after it shifts by +1 relative to the original. A naive implementation
    // would slice the wrong characters out of the original and produce a
    // mispositioned highlight.
    const pages: PageTextContent[] = [
      { pageNumber: 1, text: 'Die Straße führt nach Köln.' },
    ];

    const results = performAdvancedSearch(pages, 'strasse', DEFAULT_SEARCH_OPTIONS);
    expect(results.length).toBe(1);
    const match = results[0];
    expect(match.matchedText).toBe('Straße');
    expect(match.matchLength).toBe('Straße'.length);
    expect(originalIndex(pages[0].text, 'Straße')).toBe(match.matchIndex);

    const highlighted = match.snippet.slice(match.snippetMatchRange.start, match.snippetMatchRange.end);
    expect(highlighted).toBe('Straße');
  });
});

/** Helper: character index of `needle` in `haystack`, used only by the tests. */
function originalIndex(haystack: string, needle: string): number {
  return haystack.indexOf(needle);
}
