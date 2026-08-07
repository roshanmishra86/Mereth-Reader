import { describe, it, expect } from 'vitest';
import {
  parseOutlineTree,
  resolveNamedDestination,
  toRomanNumeral,
  formatExtendedPageLabel,
} from './navigationUtils';
import { OutlineItem } from './pdfUtils';

describe('navigationUtils', () => {
  it('resolves named destinations correctly', () => {
    const namedMap = { 'sec-intro': 3, 'abstract': 1 };

    expect(resolveNamedDestination('5')).toBe(5);
    expect(resolveNamedDestination('sec-intro', namedMap)).toBe(3);
    expect(resolveNamedDestination('#page=12')).toBe(12);
    expect(resolveNamedDestination(null)).toBeNull();
    expect(resolveNamedDestination('unknown', namedMap)).toBeNull();
  });

  it('parses hierarchical outline trees recursively', () => {
    const rawItems: OutlineItem[] = [
      {
        title: 'Chapter 1',
        dest: '1',
        items: [
          { title: 'Section 1.1', dest: '2' },
          { title: 'Section 1.2', dest: '3' },
        ],
      },
      {
        title: 'Chapter 2',
        dest: 'abstract',
      },
    ];

    const parsed = parseOutlineTree(rawItems, { abstract: 4 });
    expect(parsed.length).toBe(2);
    expect(parsed[0].title).toBe('Chapter 1');
    expect(parsed[0].pageNumber).toBe(1);
    expect(parsed[0].children.length).toBe(2);
    expect(parsed[0].children[0].pageNumber).toBe(2);
    expect(parsed[1].pageNumber).toBe(4);
  });

  it('converts numbers to Roman numerals', () => {
    expect(toRomanNumeral(1)).toBe('i');
    expect(toRomanNumeral(3)).toBe('iii');
    expect(toRomanNumeral(4)).toBe('iv');
    expect(toRomanNumeral(9)).toBe('ix');
    expect(toRomanNumeral(14)).toBe('xiv');
  });

  it('formats page labels with Roman numeral and custom label support', () => {
    const customLabels = {
      1: { customLabel: 'Cover' },
      2: { style: 'roman-lower' as const },
      3: { style: 'roman-lower' as const },
    };

    const cover = formatExtendedPageLabel(1, 10, customLabels);
    expect(cover.displayLabel).toBe('Cover');
    expect(cover.fullBadge).toBe('Cover (p. 1)');

    const roman = formatExtendedPageLabel(2, 10, customLabels);
    expect(roman.displayLabel).toBe('ii');
    expect(roman.fullBadge).toBe('ii (p. 2)');

    const standard = formatExtendedPageLabel(4, 10, customLabels);
    expect(standard.displayLabel).toBe('4');
    expect(standard.fullBadge).toBe('4 / 10');
  });
});
