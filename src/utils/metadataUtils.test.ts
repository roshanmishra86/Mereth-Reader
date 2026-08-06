import { describe, it, expect } from 'vitest';
import {
  extractDoiFromString,
  extractIsbnFromString,
  parsePdfDate,
  parseEmbeddedPdfInfo,
} from './metadataUtils';

describe('metadataUtils', () => {
  it('extracts DOI from subject or keywords text string', () => {
    const textWithDoi = 'Article published in Journal. DOI: 10.1016/j.psychsport.2021.102000. All rights reserved.';
    expect(extractDoiFromString(textWithDoi)).toBe('10.1016/j.psychsport.2021.102000');

    const textWithoutDoi = 'Standard introductory textbook on cognitive science';
    expect(extractDoiFromString(textWithoutDoi)).toBeUndefined();
  });

  it('extracts ISBN-10 or ISBN-13 from metadata string', () => {
    const textWithIsbn13 = 'Published by Academic Press, ISBN-13: 978-0-12-345678-9';
    expect(extractIsbnFromString(textWithIsbn13)).toBe('978-0-12-345678-9');

    const textWithoutIsbn = 'Plain paper description';
    expect(extractIsbnFromString(textWithoutIsbn)).toBeUndefined();
  });

  it('parses raw PDF creation date format D:YYYYMMDDHHmmSS', () => {
    const rawPdfDate = "D:20260806053901+00'00'";
    expect(parsePdfDate(rawPdfDate)).toBe('2026-08-06T05:39:01.000Z');

    const isoDate = '2026-08-06';
    expect(parsePdfDate(isoDate)).toBe('2026-08-06');

    expect(parsePdfDate(undefined)).toBeUndefined();
  });

  it('parses embedded PDF info dictionary without any network call', () => {
    const mockPdfInfoDict = {
      Title: 'Test-Enhanced Learning',
      Author: 'Henry L. Roediger III',
      Subject: 'Retrieval practice and long-term retention. DOI: 10.1037/0033-2909.132.2.181',
      Keywords: 'memory, retrieval practice, testing effect, ISBN: 978-1-59147-300-8',
      CreationDate: "D:20260806120000+00'00'",
    };

    const metadata = parseEmbeddedPdfInfo(mockPdfInfoDict);

    expect(metadata.title).toBe('Test-Enhanced Learning');
    expect(metadata.author).toBe('Henry L. Roediger III');
    expect(metadata.subject).toContain('Retrieval practice');
    expect(metadata.doi).toBe('10.1037/0033-2909.132.2.181');
    expect(metadata.isbn).toBe('978-1-59147-300-8');
    expect(metadata.creation_date).toBe('2026-08-06T12:00:00.000Z');
  });
});
