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
