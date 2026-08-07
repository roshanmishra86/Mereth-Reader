/**
 * Fingerprint Duplicate Confirmation Utilities for Mereth Reader (PRD FR-7.7).
 * Detects duplicate SHA-256 fingerprints and handles duplicate resolution choices:
 * - Open existing reference
 * - Import as a new library item
 * - Cancel import
 * Strict TypeScript without `any` types.
 */

import { DocumentRecord, DuplicateCheckResult, createDocumentRecord, OwnershipMode } from './pdfImport';

export type DuplicateResolutionAction = 'open_existing' | 'import_new' | 'cancel';

export interface DuplicateConfirmationOptions {
  sha256Hash: string;
  candidateFilePath: string;
  existingDocuments: DocumentRecord[];
}

export interface DuplicateConfirmationState {
  hasDuplicate: boolean;
  existingDocument?: DocumentRecord;
  candidateFilePath: string;
  sha256Hash: string;
}

/**
 * Checks whether an importing file's SHA-256 fingerprint matches any existing document in the library.
 */
export function checkDuplicateFingerprint(
  sha256Hash: string,
  candidateFilePath: string,
  existingDocuments: DocumentRecord[]
): DuplicateConfirmationState {
  if (!sha256Hash) {
    return {
      hasDuplicate: false,
      candidateFilePath,
      sha256Hash: '',
    };
  }

  const match = existingDocuments.find((doc) => doc.sha256_hash === sha256Hash);

  return {
    hasDuplicate: Boolean(match),
    existingDocument: match,
    candidateFilePath,
    sha256Hash,
  };
}

/**
 * Resolves user action upon duplicate confirmation.
 * Returns either the existing document (for 'open_existing'), a newly created document record (for 'import_new'),
 * or null (for 'cancel').
 */
export function resolveDuplicateAction(params: {
  action: DuplicateResolutionAction;
  state: DuplicateConfirmationState;
  pageCount?: number;
  ownershipMode?: OwnershipMode;
  customTitle?: string;
}): DocumentRecord | null {
  const { action, state, pageCount = 1, ownershipMode = 'open_in_place', customTitle } = params;

  if (action === 'cancel') {
    return null;
  }

  if (action === 'open_existing') {
    if (state.existingDocument) {
      return state.existingDocument;
    }
    return null;
  }

  if (action === 'import_new') {
    // Create new document item with unique ID
    return createDocumentRecord({
      title: customTitle,
      filepath: state.candidateFilePath,
      sha256_hash: state.sha256Hash,
      page_count: pageCount,
      ownership_mode: ownershipMode,
    });
  }

  return null;
}
