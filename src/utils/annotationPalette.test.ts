import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_PALETTE_SETTING_KEY,
  isValidPalette,
  isValidPaletteEntry,
  parsePalette,
  serializePalette,
} from './annotationPalette';
import { DEFAULT_ANNOTATION_PALETTE } from './annotationTypes';

const VALID = [
  { key: 'claim', color: '#d9bd3a', label: 'Claim' },
  { key: 'evidence', color: '#123456', label: 'Evidence' },
  { key: 'question', color: '#abcdef', label: 'Question' },
];

describe('isValidPaletteEntry / isValidPalette (FR-9.3 constraints)', () => {
  it('accepts well-formed entries and palettes', () => {
    expect(isValidPaletteEntry({ key: 'a1', color: '#aabbcc', label: 'Thing' })).toBe(true);
    expect(isValidPalette(VALID)).toBe(true);
    expect(isValidPalette(DEFAULT_ANNOTATION_PALETTE)).toBe(true);
  });

  it('rejects bad colours, keys, labels, and shapes', () => {
    expect(isValidPaletteEntry({ key: 'a', color: 'red', label: 'X' })).toBe(false);
    expect(isValidPaletteEntry({ key: 'a', color: '#aabbcc', label: '' })).toBe(false);
    expect(isValidPaletteEntry({ key: 'has space', color: '#aabbcc', label: 'X' })).toBe(false);
    expect(isValidPaletteEntry({ key: 'A', color: '#aabbcc', label: 'X' })).toBe(false);
    expect(isValidPaletteEntry({ key: 'a', color: '#abc', label: 'X' })).toBe(false);
    expect(isValidPaletteEntry(null)).toBe(false);
    expect(isValidPaletteEntry('nope')).toBe(false);
  });

  it('rejects duplicate keys or colours, and out-of-bound sizes', () => {
    const dupKey = [...VALID, { key: 'claim', color: '#ffffff', label: 'Dup' }];
    expect(isValidPalette(dupKey)).toBe(false);
    const dupColor = [...VALID, { key: 'other', color: '#d9bd3a', label: 'Dup' }];
    expect(isValidPalette(dupColor)).toBe(false);
    expect(isValidPalette(VALID.slice(0, 1))).toBe(false); // below MIN 2
    const tooMany = Array.from({ length: 13 }, (_, i) => ({
      key: `k${i}`,
      color: `#${String(i).padStart(6, '0')}`,
      label: `L${i}`,
    }));
    expect(isValidPalette(tooMany)).toBe(false);
  });
});

describe('serialize/parse round-trip', () => {
  it('round-trips a valid palette', () => {
    const raw = serializePalette(VALID);
    expect(parsePalette(raw)).toEqual(VALID);
  });

  it('falls back to defaults on corrupt or absent values', () => {
    expect(parsePalette(null)).toEqual(DEFAULT_ANNOTATION_PALETTE);
    expect(parsePalette(undefined)).toEqual(DEFAULT_ANNOTATION_PALETTE);
    expect(parsePalette('not json')).toEqual(DEFAULT_ANNOTATION_PALETTE);
    expect(parsePalette('"just a string"')).toEqual(DEFAULT_ANNOTATION_PALETTE);
    expect(parsePalette(JSON.stringify([{ key: 'x', color: 'red', label: 'X' }]))).toEqual(
      DEFAULT_ANNOTATION_PALETTE
    );
  });

  it('refuses to serialize an invalid palette', () => {
    expect(() => serializePalette([{ key: 'x', color: 'red', label: 'X' }])).toThrow(/invalid/i);
  });

  it('exposes a stable settings key', () => {
    expect(ANNOTATION_PALETTE_SETTING_KEY).toBe('annotation_palette');
  });
});
