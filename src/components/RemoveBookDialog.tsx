import { useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { DocumentRecord } from '../utils/pdfImport';

interface RemoveBookDialogProps {
  book: DocumentRecord | null;
  onCancel: () => void;
  onConfirm: (book: DocumentRecord, keepNotes: boolean) => Promise<void>;
}

export function RemoveBookDialog({ book, onCancel, onConfirm }: RemoveBookDialogProps) {
  const [keepNotes, setKeepNotes] = useState(true);
  const [isRemoving, setIsRemoving] = useState(false);
  const trapRef = useFocusTrap<HTMLElement>({ isOpen: Boolean(book), onClose: isRemoving ? undefined : onCancel });
  if (!book) return null;

  const submit = async () => {
    setIsRemoving(true);
    try {
      await onConfirm(book, keepNotes);
    } catch {
      // The app-level operation banner reports the backend error; keep this
      // dialog open so the user can retry or cancel.
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !isRemoving) onCancel();
    }}>
      <section ref={trapRef} className="modal remove-book-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-book-title" aria-describedby="remove-book-description">
        <span className="eyebrow">Remove from library</span>
        <h2 id="remove-book-title">Remove “{book.title}”?</h2>
        <p id="remove-book-description">
          {book.ownership_mode === 'managed_library'
            ? 'Mereth will delete its private PDF copy and cached document data. Your original PDF will remain on your hard drive.'
            : 'Mereth will delete its cached document data. The PDF on your hard drive will not be changed or deleted.'}
        </p>
        <fieldset className="remove-book-note-choice" disabled={isRemoving}>
          <legend>What should happen to this book’s notes?</legend>
          <label>
            <input type="radio" name="note-policy" checked={keepNotes} onChange={() => setKeepNotes(true)} />
            <span><strong>Keep notes</strong><small>Keep the note text in Notes, detached from this book.</small></span>
          </label>
          <label>
            <input type="radio" name="note-policy" checked={!keepNotes} onChange={() => setKeepNotes(false)} />
            <span><strong>Delete notes</strong><small>Permanently delete source notes linked to this book.</small></span>
          </label>
        </fieldset>
        <p className="remove-book-warning">Annotations, review prompts, reading position, and search cache will be permanently deleted.</p>
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onCancel} disabled={isRemoving}>Cancel</button>
          <button className="button primary" type="button" onClick={() => void submit()} disabled={isRemoving}>{isRemoving ? 'Removing…' : 'Remove book'}</button>
        </div>
      </section>
    </div>
  );
}
