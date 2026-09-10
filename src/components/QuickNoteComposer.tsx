import { useEffect, useRef, useState } from 'react';
import type { QuickNoteSourceSnapshot } from '../utils/notesTypes';

export function QuickNoteComposer({ source, onSave, onDismiss }: {
  source: QuickNoteSourceSnapshot;
  onSave: (body: string, source: QuickNoteSourceSnapshot) => Promise<void>;
  onDismiss: () => void;
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSave = async () => {
    if (submittedRef.current || saving) return;
    if (!body.trim()) {
      onDismiss();
      return;
    }
    submittedRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(body.trim(), source);
      onDismiss();
    } catch (reason) {
      submittedRef.current = false;
      setSaving(false);
      setError(reason instanceof Error ? reason.message : 'Could not save this note. Try again.');
    }
  };

  const handleDismiss = () => {
    if (body.trim().length > 0 && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onDismiss();
  };

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        if (!body.trim()) {
          onDismiss();
        } else {
          // Do not silently save on outside click; prompt user to keep editing or discard
          setConfirmDiscard(true);
        }
      }
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [body, onDismiss]);

  return (
    <div ref={rootRef} className="quick-note-composer" role="dialog" aria-labelledby="quick-note-title">
      <header>
        <strong id="quick-note-title">Quick note</strong>
        <span>p. {source.pageLabel}</span>
        <button
          className="quick-note-close"
          onClick={handleDismiss}
          aria-label="Close quick note"
          disabled={saving}
        >
          ×
        </button>
      </header>

      {source.selectedQuote && <q>{source.selectedQuote}</q>}

      <textarea
        ref={textareaRef}
        value={body}
        disabled={saving}
        aria-label="Quick note text"
        placeholder="Capture a thought… (Markdown supported)"
        onChange={(e) => {
          setBody(e.target.value);
          if (confirmDiscard) setConfirmDiscard(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            handleDismiss();
            return;
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void handleSave();
          }
          // Bare Enter produces a normal newline
        }}
      />

      {confirmDiscard && (
        <div className="quick-note-confirm-bar" role="alert">
          <span>Unsaved changes. Discard note?</span>
          <div>
            <button className="button micro" onClick={() => onDismiss()}>Discard</button>
            <button className="button micro primary" onClick={() => void handleSave()}>Save</button>
          </div>
        </div>
      )}

      <footer>
        <span role={error ? 'alert' : 'status'}>
          {error ?? (saving ? 'Saving…' : 'Ctrl+Enter to save · Enter for newline')}
        </span>
        <div className="quick-note-actions">
          <button
            type="button"
            className="button compact"
            onClick={handleDismiss}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button compact primary"
            onClick={() => void handleSave()}
            disabled={saving || !body.trim()}
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </footer>
    </div>
  );
}
