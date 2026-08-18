import { useEffect, useMemo, useState } from 'react';
import { AnnotationRecord, PaletteEntry, paletteLabelFor } from '../utils/annotationTypes';
import { annotationCopyText, formatAnnotationQuotation } from '../utils/annotationText';

interface AnnotationEditorProps {
  annotation: AnnotationRecord;
  palette: PaletteEntry[];
  busy?: boolean;
  onSave: (id: string, color: string, comment: string, tags: string[]) => void;
  onTrash: (id: string) => void;
}

/**
 * Task 3.5 — edit surface for one annotation.
 *
 * FR-9.5: the source passage renders in a read-only block and the update path
 * (`db_update_annotation_fields`) can only touch colour/comment/tags — the
 * quote, prefix/suffix, geometry, and version binding are immutable. FR-9.3:
 * colour chips come from the user's configured palette. FR-9.8: Trash moves
 * the row to the recoverable trash; Undo lives at the session level.
 */
export function AnnotationEditor({ annotation, palette, busy, onSave, onTrash }: AnnotationEditorProps) {
  const [color, setColor] = useState(annotation.color);
  const [comment, setComment] = useState(annotation.comment);
  const [tagsText, setTagsText] = useState(annotation.tags.join(', '));

  // Re-sync local state when the selection changes documents/annotations.
  useEffect(() => {
    setColor(annotation.color);
    setComment(annotation.comment);
    setTagsText(annotation.tags.join(', '));
  }, [annotation.id]);

  const tags = useMemo(
    () =>
      tagsText
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsText]
  );

  const quoteBlock = formatAnnotationQuotation(annotation);
  const copyText = annotationCopyText(annotation);
  const changed =
    color !== annotation.color ||
    comment !== annotation.comment ||
    tags.join('|') !== annotation.tags.join('|');

  return (
    <div className="annotation-editor">
      <div className="pane-heading">
        <span>Edit selected</span>
      </div>

      {(copyText.quote || quoteBlock) && (
        <blockquote className="editor-quote" aria-label="Source passage (read-only)">
          <span className="editor-field-label">Source passage · read-only (FR-9.5)</span>
          {quoteBlock ?? `“${copyText.quote}”`}
        </blockquote>
      )}

      <label className="editor-field">
        <span className="editor-field-label">Semantic colour · {paletteLabelFor(color, palette)}</span>
        <span className="popup-swatches" role="group" aria-label="Semantic colour">
          {palette.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`popup-swatch${entry.key === color ? ' selected' : ''}`}
              style={{ background: entry.color }}
              aria-label={entry.label}
              aria-pressed={entry.key === color}
              title={entry.label}
              onClick={() => setColor(entry.key)}
              disabled={busy}
            />
          ))}
        </span>
      </label>

      <label className="editor-field">
        <span className="editor-field-label">Your comment — separate from the source passage</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Your own words. They are stored and exported separately from the quote."
          aria-label="Annotation comment"
          disabled={busy}
        />
      </label>

      <label className="editor-field">
        <span className="editor-field-label">Tags (comma separated)</span>
        <input
          type="text"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="claim, chapter-3"
          aria-label="Annotation tags"
          disabled={busy}
        />
      </label>

      <div className="popup-actions">
        <button
          className="button compact danger-ghost"
          onClick={() => onTrash(annotation.id)}
          disabled={busy}
          title="Move to trash — recoverable, undoable (FR-9.8)"
        >
          Trash
        </button>
        <button
          className="button compact primary"
          onClick={() => onSave(annotation.id, color, comment, tags)}
          disabled={busy || !changed}
          title={changed ? 'Save colour/comment/tags — the quote never changes' : 'No changes yet'}
        >
          Save
        </button>
      </div>
    </div>
  );
}
