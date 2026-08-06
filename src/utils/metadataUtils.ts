/**
 * Metadata Extraction and Formatting Utilities for Mereth Reader (PRD FR-7.4).
 * Extracts title, author, subject, keywords, creation date, DOI, and ISBN
 * from embedded PDF info dictionary without any network call.
 * Strict TypeScript without `any` types.
 */

export interface PdfMetadataFields {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creation_date?: string;
  doi?: string;
  isbn?: string;
}

/**
 * Extracts DOI from metadata strings or subject/keywords fields using regex (PRD FR-7.4).
 * Matches standard DOI format: 10.xxxx/xxxx
 */
export function extractDoiFromString(text: string): string | undefined {
  if (!text) return undefined;
  const doiRegex = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+\b/;
  const match = text.match(doiRegex);
  if (match) {
    // Clean up trailing punctuation if matched
    return match[0].replace(/[.;,)]$/, '');
  }
  return undefined;
}

/**
 * Extracts ISBN-10 or ISBN-13 from text/keywords/subject using regex (PRD FR-7.4).
 */
export function extractIsbnFromString(text: string): string | undefined {
  if (!text) return undefined;
  // Matches ISBN-13 (978-x or 979-x) or ISBN-10
  const isbn13Regex = /\b(?:ISBN(?:-13)?:?\s*)?(978|979)[- ]?\d{1,5}[- ]?\d{1,7}[- ]?\d{1,7}[- ]?[\dX]\b/i;
  const match13 = text.match(isbn13Regex);
  if (match13) {
    return match13[0].replace(/^(?:ISBN(?:-13|-10)?:?\s*)/i, '').trim();
  }

  const isbn10Regex = /\b(?:ISBN(?:-10)?:?\s*)?\d{1,5}[- ]?\d{1,7}[- ]?\d{1,7}[- ]?[\dX]\b/i;
  const match10 = text.match(isbn10Regex);
  if (match10 && match10[0].replace(/[- ]/g, '').length >= 10) {
    return match10[0].replace(/^(?:ISBN(?:-13|-10)?:?\s*)/i, '').trim();
  }

  return undefined;
}

/**
 * Parses raw PDF Date strings (e.g. "D:20260806053901+00'00'" or "2026-08-06") into ISO date strings.
 */
export function parsePdfDate(rawDate?: string): string | undefined {
  if (!rawDate) return undefined;
  const cleaned = rawDate.trim();

  // If already standard ISO date or simple YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    return cleaned;
  }

  // Handle PDF Date string format: D:YYYYMMDDHHmmSSOHH'mm'
  const pdfDateRegex = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/;
  const match = cleaned.match(pdfDateRegex);
  if (match) {
    const year = match[1];
    const month = match[2] || '01';
    const day = match[3] || '01';
    const hour = match[4] || '00';
    const min = match[5] || '00';
    const sec = match[6] || '00';

    const isoStr = `${year}-${month}-${day}T${hour}:${min}:${sec}.000Z`;
    const d = new Date(isoStr);
    if (!isNaN(d.getTime())) {
      return isoStr;
    }
  }

  // Try standard JS date parse fallback
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }

  return undefined;
}

/**
 * Parses PDF info dictionary object into structured PdfMetadataFields.
 * Extracts embedded Title, Author, Subject, Keywords, CreationDate, DOI, and ISBN.
 */
export function parseEmbeddedPdfInfo(infoDict: Record<string, string | undefined>): PdfMetadataFields {
  const title = infoDict.Title || infoDict.title || undefined;
  const author = infoDict.Author || infoDict.author || undefined;
  const subject = infoDict.Subject || infoDict.subject || undefined;
  const keywords = infoDict.Keywords || infoDict.keywords || undefined;
  const rawCreationDate = infoDict.CreationDate || infoDict.creationDate || infoDict.ModDate || undefined;

  const creation_date = parsePdfDate(rawCreationDate);

  // Check custom fields or search combined text for DOI & ISBN
  const combinedText = [
    subject ?? '',
    keywords ?? '',
    infoDict.doi ?? '',
    infoDict.DOI ?? '',
    infoDict.isbn ?? '',
    infoDict.ISBN ?? '',
  ].join(' ');

  const doi = infoDict.doi || infoDict.DOI || extractDoiFromString(combinedText);
  const isbn = infoDict.isbn || infoDict.ISBN || extractIsbnFromString(combinedText);

  return {
    title: title ? title.trim() : undefined,
    author: author ? author.trim() : undefined,
    subject: subject ? subject.trim() : undefined,
    keywords: keywords ? keywords.trim() : undefined,
    creation_date,
    doi: doi ? doi.trim() : undefined,
    isbn: isbn ? isbn.trim() : undefined,
  };
}
