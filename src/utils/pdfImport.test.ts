import { describe, it, expect } from 'vitest';
import {
  getDefaultOwnershipMode,
  validatePdfFilePath,
  detectDuplicateDocument,
  createDocumentRecord,
  verifyInPlaceFileStatus,
  validateRelocatedFile,
  extractFilenameFromPath,
  formatFileSize,
  DocumentRecord,
} from './pdfImport';

describe('pdfImport utilities', () => {
  it('getDefaultOwnershipMode returns open_in_place per ADR R0.8', () => {
    expect(getDefaultOwnershipMode()).toBe('open_in_place');
  });

  it('validatePdfFilePath validates extension and non-empty paths', () => {
    expect(validatePdfFilePath('')).toEqual({ valid: false, error: 'File path cannot be empty.' });
    expect(validatePdfFilePath('  ')).toEqual({ valid: false, error: 'File path cannot be empty.' });
    expect(validatePdfFilePath('document.txt')).toEqual({
      valid: false,
      error: "Invalid file format '.txt'. Only PDF documents are supported.",
    });
    expect(validatePdfFilePath('C:\\Users\\Research\\paper.pdf')).toEqual({ valid: true });
    expect(validatePdfFilePath('/home/user/paper.PDF')).toEqual({ valid: true });
    // An extensionless file literally named "pdf" must not be accepted as a PDF.
    expect(validatePdfFilePath('pdf').valid).toBe(false);
    expect(validatePdfFilePath('/home/user/pdf').valid).toBe(false);
  });

  it('detectDuplicateDocument identifies SHA-256 fingerprint matches', () => {
    const existing: DocumentRecord[] = [
      {
        id: 'doc-1',
        title: 'Existing Paper',
        filepath: '/path/paper1.pdf',
        sha256_hash: 'abc123hash',
        page_count: 10,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
        provenance: 'open_in_place',
        ownership_mode: 'open_in_place',
      },
    ];

    const match = detectDuplicateDocument('abc123hash', existing);
    expect(match.isDuplicate).toBe(true);
    expect(match.existingDocument?.title).toBe('Existing Paper');

    const noMatch = detectDuplicateDocument('xyz987hash', existing);
    expect(noMatch.isDuplicate).toBe(false);
    expect(noMatch.existingDocument).toBeUndefined();
  });

  it('createDocumentRecord formats open_in_place and managed_library records correctly', () => {
    const inPlace = createDocumentRecord({
      title: 'In Place Doc',
      filepath: '/docs/in_place.pdf',
      sha256_hash: 'hash1',
      page_count: 5,
      ownership_mode: 'open_in_place',
    });

    expect(inPlace.ownership_mode).toBe('open_in_place');
    expect(inPlace.provenance).toBe('source_extracted');
    expect(inPlace.original_filepath).toBeUndefined();

    const managed = createDocumentRecord({
      title: 'Managed Doc',
      filepath: '/app_data/documents/managed.pdf',
      original_filepath: '/original/user_doc.pdf',
      sha256_hash: 'hash2',
      page_count: 12,
      ownership_mode: 'managed_library',
    });

    expect(managed.ownership_mode).toBe('managed_library');
    expect(managed.provenance).toBe('source_extracted');
    expect(managed.original_filepath).toBe('/original/user_doc.pdf');
  });

  it('createDocumentRecord always sets provenance to a valid database value', () => {
    const VALID_PROVENANCES = [
      'source_extracted', 'source_ocr', 'user_authored',
      'ai_draft', 'user_adopted_ai', 'deterministic_transform',
    ];

    const openInPlace = createDocumentRecord({
      filepath: '/docs/test.pdf',
      sha256_hash: 'testhash',
      page_count: 1,
      ownership_mode: 'open_in_place',
    });
    expect(VALID_PROVENANCES).toContain(openInPlace.provenance);

    const managed = createDocumentRecord({
      filepath: '/docs/managed.pdf',
      sha256_hash: 'managehash',
      page_count: 3,
      ownership_mode: 'managed_library',
    });
    expect(VALID_PROVENANCES).toContain(managed.provenance);
  });

  it('verifyInPlaceFileStatus delegates to file existence function', () => {
    const mockFileExists = (path: string) => path === '/existing/file.pdf';
    expect(verifyInPlaceFileStatus('/existing/file.pdf', mockFileExists)).toEqual({
      exists: true,
      filepath: '/existing/file.pdf',
    });
    expect(verifyInPlaceFileStatus('/missing/file.pdf', mockFileExists)).toEqual({
      exists: false,
      filepath: '/missing/file.pdf',
    });
  });

  it('validateRelocatedFile checks SHA-256 fingerprint equality', () => {
    const matching = validateRelocatedFile('hash123', 'hash123');
    expect(matching.valid).toBe(true);
    expect(matching.hashMatches).toBe(true);
    expect(matching.error).toBeUndefined();

    const mismatched = validateRelocatedFile('hash123', 'hash999');
    expect(mismatched.valid).toBe(true);
    expect(mismatched.hashMatches).toBe(false);
    expect(mismatched.error).toContain('Fingerprint differs');
  });

  it('extractFilenameFromPath handles Windows and POSIX paths', () => {
    expect(extractFilenameFromPath('C:\\Documents\\Research\\thesis.pdf')).toBe('thesis.pdf');
    expect(extractFilenameFromPath('/home/user/downloads/article.pdf')).toBe('article.pdf');
    expect(extractFilenameFromPath('simple.pdf')).toBe('simple.pdf');
  });

  it('formatFileSize formats bytes correctly', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(2500000)).toBe('2.4 MB');
  });
});
