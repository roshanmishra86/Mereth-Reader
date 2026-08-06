import React from 'react';
import { DocumentRecord } from '../utils/pdfImport';
import { DuplicateConfirmationState, DuplicateResolutionAction } from '../utils/duplicateCheck';

interface DuplicateConfirmModalProps {
  isOpen: boolean;
  duplicateState: DuplicateConfirmationState | null;
  onResolve: (action: DuplicateResolutionAction) => void;
}

export function DuplicateConfirmModal({
  isOpen,
  duplicateState,
  onResolve,
}: DuplicateConfirmModalProps) {
  if (!isOpen || !duplicateState || !duplicateState.hasDuplicate) return null;

  const existingDoc = duplicateState.existingDocument;

  return (
    <div className="sheet-backdrop" onClick={() => onResolve('cancel')}>
      <div className="sheet duplicate-confirm-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header alert-header">
          <h3>⚠️ Duplicate Document Detected (FR-7.7)</h3>
          <button
            className="icon-button"
            onClick={() => onResolve('cancel')}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </header>

        <div className="sheet-body">
          <p>
            The PDF file you are trying to import has an identical SHA-256 fingerprint matching a document already present in your library:
          </p>

          {existingDoc && (
            <div className="existing-doc-card">
              <div className="doc-icon">📄</div>
              <div className="doc-details">
                <strong>{existingDoc.title}</strong>
                <span className="dimmed">{existingDoc.filepath}</span>
                <span className="meta-badge">
                  {existingDoc.page_count} pages · Fingerprint: {existingDoc.sha256_hash.substring(0, 16)}...
                </span>
              </div>
            </div>
          )}

          <p className="dimmed micro">
            Importing file path: <code>{duplicateState.candidateFilePath}</code>
          </p>

          <div className="duplicate-resolution-choices">
            <button
              className="button primary block"
              onClick={() => onResolve('open_existing')}
            >
              📖 Open Existing Library Document Reference
            </button>

            <button
              className="button secondary block"
              onClick={() => onResolve('import_new')}
            >
              ➕ Confirm Import as New Library Item
            </button>
          </div>
        </div>

        <footer className="sheet-footer">
          <button className="button secondary" onClick={() => onResolve('cancel')}>
            Cancel Import
          </button>
        </footer>
      </div>
    </div>
  );
}
