import React from 'react';
import { DocumentRecord } from '../utils/pdfImport';

interface MalformedDocumentViewProps {
  document: DocumentRecord;
  onReturnToLibrary: () => void;
  onDeleteRecord?: (docId: string) => void;
  errorMessage?: string;
}

export function MalformedDocumentView({
  document,
  onReturnToLibrary,
  onDeleteRecord,
  errorMessage,
}: MalformedDocumentViewProps) {
  return (
    <div
      className="malformed-document-container"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '30px',
        background: '#f3f2f2',
      }}
    >
      <div
        className="malformed-card"
        style={{
          maxWidth: '560px',
          padding: '24px',
          background: '#fff',
          border: '1px solid rgba(32,30,29,0.3)',
          borderTop: '4px solid #ec3013',
          borderRadius: '4px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <span style={{ fontSize: '32px' }}>🚫</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', color: '#ae1800' }}>
              Malformed or Corrupted PDF
            </h3>
            <span className="dimmed micro">Document ID: {document.id}</span>
          </div>
        </div>

        <p style={{ fontSize: '13px', color: '#444141', lineHeight: 1.5, margin: '0 0 12px' }}>
          The PDF document <strong>"{document.title}"</strong> could not be opened or rendered.
        </p>

        <div
          style={{
            padding: '10px 12px',
            background: 'rgba(32, 30, 29, 0.06)',
            borderRadius: '3px',
            fontSize: '11px',
            fontFamily: 'monospace',
            marginBottom: '16px',
            wordBreak: 'break-all',
          }}
        >
          {errorMessage || 'File structure is corrupted, invalid header bytes, or contains unsupported PDF specifications.'}
        </div>

        <p className="dimmed micro" style={{ marginBottom: '18px' }}>
          File path: <code>{document.filepath}</code>
        </p>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          {onDeleteRecord && (
            <button
              className="button danger micro"
              onClick={() => onDeleteRecord(document.id)}
            >
              Remove Record
            </button>
          )}
          <button className="button primary" onClick={onReturnToLibrary}>
            Return to Library
          </button>
        </div>
      </div>
    </div>
  );
}
