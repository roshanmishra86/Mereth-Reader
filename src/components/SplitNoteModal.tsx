/**
 * Task 4.3 — Split Note Modal with real-time atomicity linting (PRD R3, FR-10.6).
 */

import React, { useState, useMemo } from 'react';
import type { NoteRecord } from '../utils/notesTypes';
import { validateConceptTitleGuidance } from '../utils/notesTypes';
import { splitNoteContent, SplitNoteResult } from '../utils/noteSplit';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface SplitNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  originalNote: NoteRecord;
  selectedText: string;
  onConfirmSplit: (result: SplitNoteResult) => void;
}

export const SplitNoteModal: React.FC<SplitNoteModalProps> = ({
  isOpen,
  onClose,
  originalNote,
  selectedText,
  onConfirmSplit,
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [additionalProse, setAdditionalProse] = useState('');
  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose });

  const guidance = useMemo(() => validateConceptTitleGuidance(newTitle), [newTitle]);

  if (!isOpen) return null;

  const handleSplit = () => {
    if (!newTitle.trim()) return;

    const result = splitNoteContent({
      originalNote,
      selectedText,
      newTitle,
      additionalProse: additionalProse.trim() ? additionalProse : undefined,
    });

    onConfirmSplit(result);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="split-modal-title">
      <div ref={trapRef} className="modal-card split-note-modal">
        <h2 id="split-modal-title">Split into Atomic Concept Note (FR-10.6)</h2>
        <p className="modal-description">
          The selected passage will be extracted into a new concept note, and a forward link will be inserted in this note.
        </p>

        <div className="split-extracted-preview">
          <label>Extracted Passage:</label>
          <blockquote>{selectedText || 'No text selected (empty block)'}</blockquote>
        </div>

        <div className="form-group">
          <label htmlFor="split-concept-title">Concept Note Title:</label>
          <input
            id="split-concept-title"
            type="text"
            placeholder="e.g., Testing strengthens memory pathways"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            autoFocus
          />
          {!guidance.isStrongTitle && newTitle.trim().length > 0 && (
            <p className="atomicity-hint warning">
              ⚠️ {guidance.suggestion}
            </p>
          )}
          {guidance.isStrongTitle && newTitle.trim().length > 0 && (
            <p className="atomicity-hint success">
              ✓ Good atomic claim or question title
            </p>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="split-additional-prose">Additional Prose (optional):</label>
          <textarea
            id="split-additional-prose"
            rows={3}
            placeholder="Add further context or synthesis for the new concept note..."
            value={additionalProse}
            onChange={(e) => setAdditionalProse(e.target.value)}
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={!newTitle.trim()}
            onClick={handleSplit}
          >
            Split & Link
          </button>
        </div>
      </div>
    </div>
  );
};
