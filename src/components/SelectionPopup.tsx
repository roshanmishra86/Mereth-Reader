import { PaletteEntry } from '../utils/annotationTypes';

export interface SelectionPopupAnchor {
  /** Absolute position relative to the reader canvas container. */
  left: number;
  top: number;
  /** 1-based page whose wrapper contains the selection. */
  pageNumber: number;
}

interface SelectionPopupProps {
  anchor: SelectionPopupAnchor;
  palette: PaletteEntry[];
  color: string;
  onColorChange: (key: string) => void;
  comment: string;
  onCommentChange: (value: string) => void;
  locked: boolean;
  onToggleLocked: () => void;
  busy: boolean;
  error: string | null;
  onCreate: (type: 'highlight' | 'underline' | 'comment') => void;
  onClose: () => void;
}

/**
 * FR-9.2 compact creation popover: semantic colour chips, an optional comment
 * field, one-tap Highlight / Underline / Comment actions, and a locked
 * repeat mode for rapid consecutive captures. Escape and the close control
 * dismiss it; the locked toggle keeps it open after each creation so the next
 * selection captures immediately.
 */
export function SelectionPopup(props: SelectionPopupProps) {
  const { anchor, palette, color, onColorChange, comment, onCommentChange, locked, onToggleLocked, busy, error, onCreate, onClose } = props;
  const needComment = comment.trim().length === 0;

  return (
    <div
      className="selection-popup"
      style={{ left: Math.max(0, anchor.left), top: Math.max(0, anchor.top) }}
      role="dialog"
      aria-label="Annotation tools"
    >
      <div className="popup-heading">
        <span>Annotate p. {anchor.pageNumber}</span>
        <button className="popup-close" onClick={onClose} aria-label="Close annotation tools" disabled={busy}>
          ×
        </button>
      </div>

      <div className="popup-swatches" role="group" aria-label="Semantic colour">
        {palette.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`popup-swatch${entry.key === color ? ' selected' : ''}`}
            style={{ background: entry.color }}
            aria-label={entry.label}
            aria-pressed={entry.key === color}
            title={entry.label}
            onClick={() => onColorChange(entry.key)}
            disabled={busy}
          />
        ))}
      </div>

      <label className="popup-field">
        <span>Optional comment</span>
        <textarea
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="Your words stay separate from the quote (FR-9.5)"
          aria-label="Annotation comment"
          disabled={busy}
        />
      </label>

      {error && <p className="popup-error" role="alert">{error}</p>}

      <div className="popup-actions">
        <button className="button compact" onClick={() => onCreate('highlight')} disabled={busy}>
          Highlight
        </button>
        <button className="button compact" onClick={() => onCreate('underline')} disabled={busy}>
          Underline
        </button>
        <button
          className="button compact"
          onClick={() => onCreate('comment')}
          disabled={busy || needComment}
          title={needComment ? 'Add a comment first' : 'Anchored comment without a highlight'}
        >
          Comment
        </button>
      </div>

      <label className="popup-lock">
        <input type="checkbox" checked={locked} onChange={onToggleLocked} disabled={busy} />
        <span>Repeat — keep open for the next selection</span>
      </label>
    </div>
  );
}
