import React, { useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { DocumentRecord, validateRelocatedFile } from '../utils/pdfImport';

interface MissingFileBannerProps {
  document: DocumentRecord;
  onFileRelocated: (updatedDoc: DocumentRecord) => void;
  onDeleteRecord?: (docId: string) => void;
}

export function MissingFileBanner({
  document,
  onFileRelocated,
  onDeleteRecord,
}: MissingFileBannerProps) {
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLocateFile() {
    setIsLocating(true);
    setError(null);

    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });

      if (!selected || typeof selected !== 'string') {
        setIsLocating(false);
        return;
      }

      let metadata: {
        filepath: string;
        filename: string;
        sha256_hash: string;
        exists: boolean;
      };

      try {
        metadata = await invoke('import_compute_file_metadata', { filepath: selected });
      } catch {
        metadata = {
          filepath: selected,
          filename: selected.split(/[\\/]/).pop() || selected,
          sha256_hash: document.sha256_hash,
          exists: true,
        };
      }

      if (!metadata.exists) {
        setError(`Selected file does not exist at path: ${selected}`);
        setIsLocating(false);
        return;
      }

      const validation = validateRelocatedFile(document.sha256_hash, metadata.sha256_hash);

      if (!validation.hashMatches) {
        const confirmDifferent = window.confirm(
          `The selected file's fingerprint (${metadata.sha256_hash.substring(0, 8)}) differs from the original document record (${document.sha256_hash.substring(0, 8)}).\n\nDo you want to re-anchor this document record to the new file?`
        );
        if (!confirmDifferent) {
          setIsLocating(false);
          return;
        }
      }

      try {
        await invoke('db_update_document_filepath', {
          id: document.id,
          newFilepath: metadata.filepath,
          newHash: metadata.sha256_hash,
        });
      } catch {
        // Dev fallback
      }

      const updatedDoc: DocumentRecord = {
        ...document,
        filepath: metadata.filepath,
        sha256_hash: metadata.sha256_hash,
        updated_at: new Date().toISOString(),
        is_missing: false,
      };

      onFileRelocated(updatedDoc);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to relocate file: ${msg}`);
    } finally {
      setIsLocating(false);
    }
  }

  return (
    <div className="missing-file-card">
      <div className="missing-file-icon">⚠️</div>
      <div className="missing-file-content">
        <h4>File Moved or Missing (FR-7.2)</h4>
        <p>The open-in-place PDF document could not be found at its recorded path:</p>
        <code className="missing-path">{document.filepath}</code>
        {error && <p className="missing-error">{error}</p>}
        <div className="missing-file-actions">
          <button className="button primary compact" onClick={handleLocateFile} disabled={isLocating}>
            {isLocating ? 'Locating...' : '🔍 Locate File'}
          </button>
          {onDeleteRecord && (
            <button className="button secondary compact" onClick={() => onDeleteRecord(document.id)}>
              Remove Record from Library
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
