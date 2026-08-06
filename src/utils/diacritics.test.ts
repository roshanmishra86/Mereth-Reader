import { describe, it, expect } from 'vitest';
import { normalizeDiacritics, includesDiacriticTolerant } from './diacritics';

describe('diacritics utility', () => {
  it('normalizes standard Latin accents correctly', () => {
    expect(normalizeDiacritics('Café')).toBe('Cafe');
    expect(normalizeDiacritics('Rôle')).toBe('Role');
    expect(normalizeDiacritics('naïve')).toBe('naive');
    expect(normalizeDiacritics('Zürcher')).toBe('Zurcher');
    expect(normalizeDiacritics('résumé')).toBe('resume');
  });

  it('normalizes common ligatures and special letters', () => {
    expect(normalizeDiacritics('æther')).toBe('aether');
    expect(normalizeDiacritics('coeur (cœur)')).toBe('coeur (coeur)');
    expect(normalizeDiacritics('Groß')).toBe('Gross');
    expect(normalizeDiacritics('København')).toBe('Kobenhavn');
    expect(normalizeDiacritics('Ångström')).toBe('Angstrom');
  });

  it('handles empty and plain strings', () => {
    expect(normalizeDiacritics('')).toBe('');
    expect(normalizeDiacritics('Hello World')).toBe('Hello World');
  });

  it('performs diacritic-tolerant text matching', () => {
    expect(includesDiacriticTolerant('Café Liegeois', 'cafe')).toBe(true);
    expect(includesDiacriticTolerant('Zürcher Oberland', 'zurcher')).toBe(true);
    expect(includesDiacriticTolerant('Cœur de Lion', 'coeur')).toBe(true);
  });

  it('respects case sensitivity in diacritic-tolerant search when enabled', () => {
    expect(includesDiacriticTolerant('Café', 'cafe', true)).toBe(false);
    expect(includesDiacriticTolerant('Café', 'Cafe', true)).toBe(true);
    expect(includesDiacriticTolerant('café', 'cafe', true)).toBe(true);
  });
});
