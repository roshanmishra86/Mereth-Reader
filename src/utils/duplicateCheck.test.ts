import { describe, it, expect } from 'vitest';
import {
  checkDuplicateFingerprint,
  resolveDuplicateAction,
} from './duplicateCheck';
import { createDocumentRecord, DocumentRecord } from './pdfImport';

describe('duplicateCheck', () => {
  const existingDoc: DocumentRecord = createDocumentRecord({
    id: 'doc-existing-1',
    title: 'Existing Reference Paper',
    filepath: '/library/paper.pdf',
    sha256_hash: 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
    page_count: 15,
    ownership_mode: 'open_in_place',
  });

  const existingDocs = [existingDoc];

  it('detects duplicate SHA-256 fingerprint correctly', () => {
    const duplicateState = checkDuplicateFingerprint(
      'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
      '/downloads/paper_copy.pdf',
      existingDocs
    );

    expect(duplicateState.hasDuplicate).toBe(true);
    expect(duplicateState.existingDocument).toBeDefined();
    expect(duplicateState.existingDocument?.id).toBe('doc-existing-1');

    const nonDuplicateState = checkDuplicateFingerprint(
      'uniquehash1234567890abcdef1234567890abcdef1234567890abcdef123456789',
      '/downloads/new_paper.pdf',
      existingDocs
    );

    expect(nonDuplicateState.hasDuplicate).toBe(false);
  });

  it('resolves duplicate action open_existing to existing document reference', () => {
    const duplicateState = checkDuplicateFingerprint(
      'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
      '/downloads/paper_copy.pdf',
      existingDocs
    );

    const result = resolveDuplicateAction({
      action: 'open_existing',
      state: duplicateState,
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe('doc-existing-1');
  });

  it('resolves duplicate action import_new to a newly created document record', () => {
    const duplicateState = checkDuplicateFingerprint(
      'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
      '/downloads/paper_copy.pdf',
      existingDocs
    );

    const result = resolveDuplicateAction({
      action: 'import_new',
      state: duplicateState,
      pageCount: 15,
      ownershipMode: 'open_in_place',
      customTitle: 'Second Copy of Paper',
    });

    expect(result).not.toBeNull();
    expect(result?.id).not.toBe('doc-existing-1');
    expect(result?.title).toBe('Second Copy of Paper');
  });

  it('resolves duplicate action cancel to null', () => {
    const duplicateState = checkDuplicateFingerprint(
      'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
      '/downloads/paper_copy.pdf',
      existingDocs
    );

    const result = resolveDuplicateAction({
      action: 'cancel',
      state: duplicateState,
    });

    expect(result).toBeNull();
  });
});
