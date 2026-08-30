import { Icon } from './icons';
import React, { useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  OwnershipMode,
  DocumentRecord,
  ImportCandidate,
  getDefaultOwnershipMode,
  extractFilenameFromPath,
  formatFileSize,
  detectDuplicateDocument,
  createDocumentRecord,
  validatePdfFilePath,
} from '../utils/pdfImport';

import { useFocusTrap } from '../hooks/useFocusTrap';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (document: DocumentRecord) => void;
  existingDocuments: DocumentRecord[];
  initialFilePath?: string | null;
  mode?: 'open' | 'import';
}

export function ImportModal({
  isOpen,
  onClose,
  onImportComplete,
  existingDocuments,
  initialFilePath,
  mode = 'open',
}: ImportModalProps) {
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null);
  const [ownershipMode, setOwnershipMode] = useState<OwnershipMode>(getDefaultOwnershipMode());
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [duplicateMatch, setDuplicateMatch] = useState<DocumentRecord | null>(null);
  // U11: show the computed fingerprint and the real managed-copy destination.
  const [managedDocsDir, setManagedDocsDir] = useState<string | null>(null);

  const isOpenFlow = mode === 'open';

  React.useEffect(() => {
    if (!isOpen || !isTauri()) return;
    let cancelled = false;
    invoke<string>('import_managed_documents_dir')
      .then((dir) => {
        if (!cancelled) setManagedDocsDir(dir);
      })
      .catch(() => {
        // Destination stays undisclosed if the path cannot be resolved; import still works.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      setCandidate(null);
      setError(null);
      setDuplicateMatch(null);
      setIsDragOver(false);
      return;
    }
    setOwnershipMode(isOpenFlow ? 'open_in_place' : 'managed_library');
  }, [isOpen, isOpenFlow]);

  React.useEffect(() => {
    if (initialFilePath && isOpen) {
      processFilePath(initialFilePath, isOpenFlow);
    }
  }, [initialFilePath, isOpen, isOpenFlow]);

  React.useEffect(() => {
    if (!isOpen || !isTauri()) return;

    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setIsDragOver(true);
          return;
        }
        if (event.payload.type === 'leave') {
          setIsDragOver(false);
          return;
        }

        setIsDragOver(false);
        const [filePath] = event.payload.paths;
        if (!filePath) return;
        if (!filePath.toLowerCase().endsWith('.pdf')) {
          setError('Choose a PDF file to open.');
          return;
        }
        void processFilePath(filePath, isOpenFlow);
      })
      .then((stop) => { unlisten = stop; })
      .catch(() => {
        // The native dialog remains available if desktop drag events cannot be registered.
      });

    return () => unlisten?.();
  }, [isOpen, isOpenFlow]);

  if (!isOpen) return null;

  async function processFilePath(filePath: string, openImmediately = false) {
    setIsProcessing(true);
    setError(null);
    setDuplicateMatch(null);

    try {
      const pathValidation = validatePdfFilePath(filePath);
      if (!pathValidation.valid) {
        setError(pathValidation.error ?? 'Choose a PDF file to open.');
        return;
      }

      let metadata: {
        filepath: string;
        filename: string;
        sha256_hash: string;
        file_size_bytes: number;
        page_count: number;
        exists: boolean;
      };

      if (isTauri()) {
        metadata = await invoke('import_compute_file_metadata', { filepath: filePath });
      } else {
        // Fallback for non-Tauri / dev environment preview
        const filename = extractFilenameFromPath(filePath);
        metadata = {
          filepath: filePath,
          filename,
          sha256_hash: `hash-preview-${filename}`,
          file_size_bytes: 1024 * 500,
          page_count: 1,
          exists: true,
        };
      }

      if (!metadata.exists) {
        setError(`File not found at path: ${filePath}`);
        setIsProcessing(false);
        return;
      }

      setCandidate({
        filepath: metadata.filepath,
        filename: metadata.filename,
        sha256_hash: metadata.sha256_hash,
        file_size_bytes: metadata.file_size_bytes,
        page_count: metadata.page_count,
        exists: metadata.exists,
      });

      // Duplicate check
      const dupResult = detectDuplicateDocument(metadata.sha256_hash, existingDocuments);
      if (dupResult.isDuplicate && dupResult.existingDocument) {
        setDuplicateMatch(dupResult.existingDocument);
        if (openImmediately) {
          onImportComplete(dupResult.existingDocument);
          onClose();
        }
      } else if (openImmediately) {
        await saveCandidate({
          filepath: metadata.filepath,
          filename: metadata.filename,
          sha256_hash: metadata.sha256_hash,
          file_size_bytes: metadata.file_size_bytes,
          page_count: metadata.page_count,
          exists: metadata.exists,
        }, 'open_in_place');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to inspect PDF file: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleBrowseNative() {
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });

      if (selected && typeof selected === 'string') {
        await processFilePath(selected, isOpenFlow);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Native file picker failed: ${msg}`);
    }
  }

  async function saveCandidate(candidateToSave: ImportCandidate, selectedOwnershipMode: OwnershipMode) {
    setIsProcessing(true);
    setError(null);

    try {
      let finalFilePath = candidateToSave.filepath;
      let originalFilePath: string | undefined = undefined;
      const effectiveOwnership = selectedOwnershipMode;

      if (selectedOwnershipMode === 'managed_library') {
        finalFilePath = await invoke<string>('import_copy_to_managed_library', {
          sourcePath: candidateToSave.filepath,
        });
        originalFilePath = candidateToSave.filepath;
      }

      const docRecord = createDocumentRecord({
        title: candidateToSave.filename.replace(/\.pdf$/i, ''),
        filepath: finalFilePath,
        original_filepath: originalFilePath,
        sha256_hash: candidateToSave.sha256_hash,
        page_count: candidateToSave.page_count ?? 1,
        ownership_mode: effectiveOwnership,
      });

      await invoke('db_add_document', { doc: docRecord });

      onImportComplete(docRecord);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not open PDF: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleConfirmImport() {
    if (candidate) await saveCandidate(candidate, ownershipMode);
  }

  function handleOpenExisting() {
    if (duplicateMatch) {
      onImportComplete(duplicateMatch);
      onClose();
    }
  }

  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose });

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={trapRef}
        className="sheet import-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-header">
          <h3 id="import-modal-title">{isOpenFlow ? 'Open PDF' : 'Import PDF copy'}</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close modal"><Icon name="x" /></button>
        </header>

        <div className="sheet-body">
          {error && <div className="banner warning">{error}</div>}

          {!candidate ? (
            <div
              className={`drag-drop-zone ${isDragOver ? 'drag-over' : ''}`}
            >
              <div className="drop-icon">📄</div>
              <p><strong>{isOpenFlow ? 'Choose a PDF and start reading' : 'Choose a PDF to copy into your library'}</strong></p>
              <p className="dimmed">
                {isOpenFlow
                  ? 'It opens in place and is added to your Library automatically.'
                  : 'The original stays where it is; Mereth keeps a separate copy.'}
              </p>
              <button className="button primary" onClick={handleBrowseNative} disabled={isProcessing}>
                {isProcessing ? 'Opening file...' : (isOpenFlow ? 'Open PDF' : 'Choose PDF')}
              </button>
              <p className="dimmed">You can also drag a PDF onto this window.</p>
            </div>
          ) : (
            <div className="import-details">
              <div className="candidate-card">
                <span className="file-icon">📄</span>
                <div className="file-info">
                  <strong>{candidate.filename}</strong>
                  <span className="dimmed">
                    {isOpenFlow || ownershipMode === 'open_in_place'
                      ? `Source (opens in place): ${candidate.filepath}`
                      : `Source: ${candidate.filepath}`}
                  </span>
                  <span className="file-size">{formatFileSize(candidate.file_size_bytes)}</span>
                  <span className="file-fingerprint" title={candidate.sha256_hash}>
                    Fingerprint (SHA-256): <code>{candidate.sha256_hash}</code>
                  </span>
                  {!isOpenFlow && ownershipMode === 'managed_library' && (
                    <span className="dimmed file-destination" title={managedDocsDir ?? undefined}>
                      Destination copy: {managedDocsDir
                        ? `${managedDocsDir.replace(/[\\/]+$/, '')}${candidate.filepath.includes('\\') ? '\\' : '/'}${candidate.filename}`
                        : 'the managed library folder inside application data'}
                    </span>
                  )}
                </div>
                <button className="button secondary micro" onClick={() => setCandidate(null)}>Change file</button>
              </div>

              {duplicateMatch && (
                <div className="banner info duplicate-banner">
                  <p><strong>Duplicate Document Found</strong></p>
                  <p>A document with matching SHA-256 fingerprint already exists in your library as <em>"{duplicateMatch.title}"</em>.</p>
                  <div className="duplicate-actions">
                    <button className="button secondary compact" onClick={handleOpenExisting}>Open Existing Document</button>
                    <span className="dimmed">or import another copy below</span>
                  </div>
                </div>
              )}

              {!isOpenFlow && <fieldset className="ownership-selector">
                <legend>Import option</legend>

                <label className={`mode-option ${ownershipMode === 'open_in_place' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="ownership"
                    value="open_in_place"
                    checked={ownershipMode === 'open_in_place'}
                    onChange={() => setOwnershipMode('open_in_place')}
                  />
                  <div className="mode-text">
                    <strong>Keep original location</strong>
                    <p>Keep reading from this file. The original is never moved or modified.</p>
                  </div>
                </label>

                <label className={`mode-option ${ownershipMode === 'managed_library' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="ownership"
                    value="managed_library"
                    checked={ownershipMode === 'managed_library'}
                    onChange={() => setOwnershipMode('managed_library')}
                  />
                  <div className="mode-text">
                    <strong>Copy into Mereth Library</strong>
                    <p>Keeps a separate managed copy while preserving the original.</p>
                  </div>
                </label>
              </fieldset>}
            </div>
          )}
        </div>

        <footer className="sheet-footer">
          <button className="button secondary" onClick={onClose} disabled={isProcessing}>Cancel</button>
          {candidate && (
            <button className="button primary" onClick={handleConfirmImport} disabled={isProcessing}>
              {isProcessing ? (isOpenFlow ? 'Opening…' : 'Importing…') : (isOpenFlow ? 'Open PDF' : 'Import PDF')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
