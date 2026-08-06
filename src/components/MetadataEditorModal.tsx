import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DocumentRecord } from '../utils/pdfImport';
import { CollectionItem } from '../utils/libraryUtils';
import { parseEmbeddedPdfInfo } from '../utils/metadataUtils';

interface MetadataEditorModalProps {
  isOpen: boolean;
  document: DocumentRecord | null;
  collectionsList: CollectionItem[];
  onClose: () => void;
  onSave: (updatedDocument: DocumentRecord) => void;
}

export function MetadataEditorModal({
  isOpen,
  document: doc,
  collectionsList,
  onClose,
  onSave,
}: MetadataEditorModalProps) {
  if (!isOpen || !doc) return null;

  const [title, setTitle] = useState(doc.title || '');
  const [author, setAuthor] = useState(doc.author || '');
  const [subject, setSubject] = useState(doc.subject || '');
  const [keywords, setKeywords] = useState(doc.keywords || '');
  const [creationDate, setCreationDate] = useState(doc.creation_date || '');
  const [doi, setDoi] = useState(doc.doi || '');
  const [isbn, setIsbn] = useState(doc.isbn || '');
  const [isFavourite, setIsFavourite] = useState(Boolean(doc.is_favourite));
  const [isArchived, setIsArchived] = useState(Boolean(doc.is_archived));
  const [tagsInput, setTagsInput] = useState((doc.tags || []).join(', '));
  const [selectedCollections, setSelectedCollections] = useState<string[]>(doc.collections || []);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCollectionToggle = (colName: string) => {
    if (selectedCollections.includes(colName)) {
      setSelectedCollections(selectedCollections.filter((c) => c !== colName));
    } else {
      setSelectedCollections([...selectedCollections, colName]);
    }
  };

  const handleExtractEmbeddedMetadata = () => {
    // Extract metadata from document info dictionary fields
    const extracted = parseEmbeddedPdfInfo({
      Title: doc.title,
      Author: doc.author,
      Subject: doc.subject,
      Keywords: doc.keywords,
      CreationDate: doc.creation_date,
      doi: doc.doi,
      isbn: doc.isbn,
    });

    if (extracted.title) setTitle(extracted.title);
    if (extracted.author) setAuthor(extracted.author);
    if (extracted.subject) setSubject(extracted.subject);
    if (extracted.keywords) setKeywords(extracted.keywords);
    if (extracted.creation_date) setCreationDate(extracted.creation_date);
    if (extracted.doi) setDoi(extracted.doi);
    if (extracted.isbn) setIsbn(extracted.isbn);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    const parsedTags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const updatedDoc: DocumentRecord = {
      ...doc,
      title: title.trim() || doc.title,
      author: author.trim() || undefined,
      subject: subject.trim() || undefined,
      keywords: keywords.trim() || undefined,
      creation_date: creationDate.trim() || undefined,
      doi: doi.trim() || undefined,
      isbn: isbn.trim() || undefined,
      is_favourite: isFavourite,
      is_archived: isArchived,
      tags: parsedTags,
      collections: selectedCollections,
      updated_at: new Date().toISOString(),
    };

    try {
      await invoke('db_update_document_metadata', { doc: updatedDoc });
    } catch {
      // Dev mode fallback
    }

    onSave(updatedDoc);
    setIsSaving(false);
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet metadata-editor-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h3>Edit Document Metadata (FR-7.4)</h3>
          <button className="icon-button" onClick={onClose} aria-label="Close editor">✕</button>
        </header>

        <form onSubmit={handleSave} className="sheet-body form-grid">
          {error && <div className="banner warning">{error}</div>}

          <div className="metadata-actions-top">
            <button
              type="button"
              className="button secondary compact"
              onClick={handleExtractEmbeddedMetadata}
            >
              📥 Extract Embedded Metadata
            </button>
            <span className="dimmed micro">No network calls required</span>
          </div>

          <div className="form-group">
            <label htmlFor="meta-title">Title</label>
            <input
              id="meta-title"
              type="text"
              className="input-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="meta-author">Author(s)</label>
              <input
                id="meta-author"
                type="text"
                className="input-field"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g. Jane Doe, John Smith"
              />
            </div>

            <div className="form-group">
              <label htmlFor="meta-date">Creation Date</label>
              <input
                id="meta-date"
                type="text"
                className="input-field"
                value={creationDate}
                onChange={(e) => setCreationDate(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="meta-doi">DOI (Digital Object Identifier)</label>
              <input
                id="meta-doi"
                type="text"
                className="input-field"
                value={doi}
                onChange={(e) => setDoi(e.target.value)}
                placeholder="10.xxxx/xxxx"
              />
            </div>

            <div className="form-group">
              <label htmlFor="meta-isbn">ISBN</label>
              <input
                id="meta-isbn"
                type="text"
                className="input-field"
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                placeholder="978-x-xxx-xxxxx-x"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="meta-subject">Subject / Summary</label>
            <textarea
              id="meta-subject"
              className="input-field textarea"
              rows={2}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="meta-keywords">Keywords</label>
            <input
              id="meta-keywords"
              type="text"
              className="input-field"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Comma-separated keywords"
            />
          </div>

          <div className="form-group">
            <label htmlFor="meta-tags">Tags (comma separated)</label>
            <input
              id="meta-tags"
              type="text"
              className="input-field"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="Cognition, Paper, Urgent"
            />
          </div>

          {collectionsList.length > 0 && (
            <div className="form-group">
              <label>Collections</label>
              <div className="collections-checkbox-grid">
                {collectionsList.map((col) => (
                  <label key={col.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={selectedCollections.includes(col.name)}
                      onChange={() => handleCollectionToggle(col.name)}
                    />
                    <span>{col.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="form-row checkboxes-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isFavourite}
                onChange={(e) => setIsFavourite(e.target.checked)}
              />
              <span>⭐ Mark as Favourite</span>
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isArchived}
                onChange={(e) => setIsArchived(e.target.checked)}
              />
              <span>📦 Move to Archive</span>
            </label>
          </div>

          <div className="file-info-bar">
            <span><strong>SHA-256:</strong> <code>{doc.sha256_hash.substring(0, 16)}...</code></span>
            <span><strong>Pages:</strong> {doc.page_count}</span>
            <span><strong>Path:</strong> {doc.filepath}</span>
          </div>

          <footer className="sheet-footer">
            <button type="button" className="button secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Metadata'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
