/**
 * Diacritic normalization and tolerant string matching for Mereth Reader.
 * Converts accented characters, umlauts, and common ligatures to base ASCII equivalents.
 * Strict TypeScript without `any`.
 */

const LIGATURE_MAP: Record<string, string> = {
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ß: 'ss',
  þ: 'th',
  Þ: 'TH',
  ð: 'dh',
  Ð: 'DH',
  ø: 'o',
  Ø: 'O',
  å: 'a',
  Å: 'A',
};

export interface NormalizedTextWithMap {
  normalized: string;
  /**
   * For each code-unit index `i` in `normalized`, `normToOrig[i]` is the
   * code-unit index in the original string that produced that normalized char.
   * Ligatures expand one source char into several normalized chars (all mapping
   * back to the same source index); combining marks are dropped (so the source
   * index is preserved on the base char). This lets callers map match positions
   * found in the normalized string back to highlight ranges in the original.
   */
  normToOrig: number[];
}

/**
 * Same transformation as {@link normalizeDiacritics}, but also returns a
 * position map so callers can translate normalized-text indices back to the
 * original string. Required because ligature expansion (æ→ae, ß→ss, …) and
 * combining-mark stripping change the string length and shift all indices after
 * the first affected character.
 */
export function normalizeDiacriticsWithMap(str: string): NormalizedTextWithMap {
  if (!str) return { normalized: '', normToOrig: [] };

  let normalized = '';
  const normToOrig: number[] = [];

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const ligature = LIGATURE_MAP[ch];
    if (ligature !== undefined) {
      // One source char → multiple normalized chars, all rooted at index i.
      for (const r of ligature) {
        normalized += r;
        normToOrig.push(i);
      }
      continue;
    }

    // NFD-decompose the single char and drop combining marks (U+0300–U+036F).
    // The remaining base char(s) keep their source index i.
    const decomp = ch.normalize('NFD');
    for (let j = 0; j < decomp.length; j++) {
      const code = decomp.charCodeAt(j);
      if (code >= 0x0300 && code <= 0x036f) continue;
      normalized += decomp[j];
      normToOrig.push(i);
    }
  }

  return { normalized, normToOrig };
}

/**
 * Normalizes a string by decomposing diacritics (accents) and converting ligatures.
 */
export function normalizeDiacritics(str: string): string {
  if (!str) return '';

  // Replace common ligatures first
  let result = str;
  for (const [lig, replacement] of Object.entries(LIGATURE_MAP)) {
    if (result.includes(lig)) {
      result = result.replaceAll(lig, replacement);
    }
  }

  // Decompose combining diacritical marks using NFD and remove non-spacing marks (U+0300 to U+036F)
  return result
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Checks if a string contains a search query, ignoring diacritics/accents.
 */
export function includesDiacriticTolerant(text: string, query: string, caseSensitive = false): boolean {
  if (!query) return true;
  if (!text) return false;

  const normText = normalizeDiacritics(text);
  const normQuery = normalizeDiacritics(query);

  if (caseSensitive) {
    return normText.includes(normQuery);
  }
  return normText.toLowerCase().includes(normQuery.toLowerCase());
}
