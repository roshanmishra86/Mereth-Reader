import React, { useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  OwnershipMode,
  DocumentRecord,
  ImportCandidate,
  getDefaultOwnershipMode,
  extractFilenameFromPath,
  formatFileSize,
  detectDuplicateDocument,
  createDocumentRecord,
} from '../utils/pdfImport';

import { loadPdfDocument } from '../utils/pdfViewer';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (document: DocumentRecord) => void;
  existingDocuments: DocumentRecord[];
  initialFilePath?: string | null;
}

export function ImportModal({
  isOpen,
  onClose,
  onImportComplete,
  existingDocuments,
  initialFilePath,
}: ImportModalProps) {
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null);
  const [ownershipMode, setOwnershipMode] = useState<OwnershipMode>(getDefaultOwnershipMode());
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [duplicateMatch, setDuplicateMatch] = useState<DocumentRecord | null>(null);

  React.useEffect(() => {
    if (initialFilePath && isOpen) {
      processFilePath(initialFilePath);
    }
  }, [initialFilePath, isOpen]);

  if (!isOpen) return null;

  async function processFilePath(filePath: string) {
    setIsProcessing(true);
    setError(null);
    setDuplicateMatch(null);

    try {
      let metadata: {
        filepath: string;
        filename: string;
        sha256_hash: string;
        file_size_bytes: number;
        page_count: number;
        exists: boolean;
      };

      try {
        metadata = await invoke('import_compute_file_metadata', { filepath: filePath });
      } catch {
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

      // Authoritative PDF.js page count detection for compressed PDFs
      let authoritativePageCount = metadata.page_count;
      try {
        const pdfInfo = await loadPdfDocument(metadata.filepath);
        if (pdfInfo && pdfInfo.numPages > 0) {
          authoritativePageCount = pdfInfo.numPages;
        }
      } catch {
        // Fall back to backend metadata page count
      }

      setCandidate({
        filepath: metadata.filepath,
        filename: metadata.filename,
        sha256_hash: metadata.sha256_hash,
        file_size_bytes: metadata.file_size_bytes,
        page_count: authoritativePageCount,
        exists: metadata.exists,
      });

      // Duplicate check
      const dupResult = detectDuplicateDocument(metadata.sha256_hash, existingDocuments);
      if (dupResult.isDuplicate && dupResult.existingDocument) {
        setDuplicateMatch(dupResult.existingDocument);
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
        await processFilePath(selected);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Native file picker failed: ${msg}`);
    }
  }

  function handleHtmlDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const path = (file as File & { path?: string }).path || file.name;
      if (!path.toLowerCase().endsWith('.pdf')) {
        setError('Only PDF files can be imported.');
        return;
      }
      processFilePath(path);
    }
  }

  async function handleConfirmImport() {
    if (!candidate) return;
    setIsProcessing(true);
    setError(null);

    try {
      let finalFilePath = candidate.filepath;
      let originalFilePath: string | undefined = undefined;
      let effectiveOwnership = ownershipMode;

      if (ownershipMode === 'managed_library') {
        try {
          finalFilePath = await invoke<string>('import_copy_to_managed_library', {
            sourcePath: candidate.filepath,
          });
          originalFilePath = candidate.filepath;
        } catch (copyErr) {
          // Managed copy failed (disk full, permission, etc.). Fall back to
          // open-in-place rather than persisting a "managed" record that points
          // at the un-copied original — that would mislabel ownership and the
          // "managed" copy would be lost if the original is later moved.
          finalFilePath = candidate.filepath;
          originalFilePath = undefined;
          effectiveOwnership = 'open_in_place';
          const msg = copyErr instanceof Error ? copyErr.message : String(copyErr);
          setError(`Could not copy file into managed library (${msg}). Imported in place instead.`);
        }
      }

      const docRecord = createDocumentRecord({
        title: candidate.filename.replace(/\.pdf$/i, ''),
        filepath: finalFilePath,
        original_filepath: originalFilePath,
        sha256_hash: candidate.sha256_hash,
        page_count: candidate.page_count ?? 1,
        ownership_mode: effectiveOwnership,
      });

      await invoke('db_add_document', { doc: docRecord });

      onImportComplete(docRecord);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Import failed: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }

  function handleOpenExisting() {
    if (duplicateMatch) {
      onImportComplete(duplicateMatch);
      onClose();
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet import-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h3>Import PDF Document</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close modal">✕</button>
        </header>

        <div className="sheet-body">
          {error && <div className="banner warning">{error}</div>}

          {!candidate ? (
            <div
              className={`drag-drop-zone ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleHtmlDrop}
            >
              <div className="drop-icon">📄</div>
              <p><strong>Drag and drop a PDF file here</strong></p>
              <p className="dimmed">or browse files from your computer</p>
              <button className="button primary" onClick={handleBrowseNative} disabled={isProcessing}>
                {isProcessing ? 'Inspecting file...' : 'Choose PDF File'}
              </button>
            </div>
          ) : (
            <div className="import-details">
              <div className="candidate-card">
                <span className="file-icon">📄</span>
                <div className="file-info">
                  <strong>{candidate.filename}</strong>
                  <span className="dimmed">{candidate.filepath}</span>
                  <span className="file-size">{formatFileSize(candidate.file_size_bytes)} · SHA-256: {candidate.sha256_hash.substring(0, 12)}...</span>
                </div>
                <button className="button secondary micro" onClick={() => setCandidate(null)}>Change file</button>
              </div>

              {duplicateMatch && (
                <div className="banner info duplicate-banner">
                  <p><strong>Duplicate Document Found</strong></p>
                  <p>A document with matching SHA-256 fingerprint already exists in your library as <em>"{duplicateMatch.title}"</em>.</p>
                  <div className="duplicate-actions">
                    <button className="button secondary compact" onClick={handleOpenExisting}>Open Existing Document</button>
                    <span className="dimmed">or confirm below to re-import</span>
                  </div>
                </div>
              )}

              <fieldset className="ownership-selector">
                <legend>Document Ownership Mode (FR-7.2)</legend>

                <label className={`mode-option ${ownershipMode === 'open_in_place' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="ownership"
                    value="open_in_place"
                    checked={ownershipMode === 'open_in_place'}
                    onChange={() => setOwnershipMode('open_in_place')}
                  />
                  <div className="mode-text">
                    <strong>Open in Place (Recommended Default)</strong>
                    <p>Retain original file location. Best for reading existing folder hierarchies. Original file is never moved or modified.</p>
                    <span className="badge-recommended">Default</span>
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
                    <strong>Add to Managed Library</strong>
                    <p>Copies original PDF into application storage (<code>documents/</code>). Preserves original file and path as metadata.</p>
                  </div>
                </label>
              </fieldset>
            </div>
          )}
        </div>

        <footer className="sheet-footer">
          <button className="button secondary" onClick={onClose} disabled={isProcessing}>Cancel</button>
          {candidate && (
            <button className="button primary" onClick={handleConfirmImport} disabled={isProcessing}>
              {isProcessing ? 'Importing...' : 'Confirm Import'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
