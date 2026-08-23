import { useMemo, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  EmbeddedImportPreview,
  countImportPreviews,
  rgbToHex,
} from '../utils/embeddedAnnotations';
import { AnnotationRecord, paletteLabelFor } from '../utils/annotationTypes';

interface EmbeddedImportModalProps {
  previews: EmbeddedImportPreview[];
  /** sourceIds already imported earlier this session (checked + disabled). */
  importedSourceIds: Set<string>;
  /** Human page label for a zero-based page index. */
  pageLabelFor: (pageIndex: number) => string;
  /** Maps a preview to its palette colour key (must match import-time mapping). */
  colorKeyFor: (preview: EmbeddedImportPreview) => string;
  busy?: boolean;
  onCancel: () => void;
  /**
   * Explicit action (FR-9.9): the user confirms; the caller builds the
   * records (deterministic_transform provenance, quote empty, embedded note
   * text as comment), persists them, and marks the sourceIds imported.
   */
  onImport: (previews: EmbeddedImportPreview[]) => void;
}

/**
 * Task 3.6 (FR-9.9) — the explicit import dialog. Every row previews the
 * original subtype, page, note text, author, PDF colour → palette mapping,
 * and provenance. Duplicates are listed (unchecked by default) so the user
 * decides; unsupported subtypes are listed as skipped, never silently
 * dropped or silently imported.
 */
export function EmbeddedImportModal({
  previews,
  importedSourceIds,
  pageLabelFor,
  colorKeyFor,
  busy,
  onCancel,
  onImport,
}: EmbeddedImportModalProps) {
  const counts = useMemo(() => countImportPreviews(previews), [previews]);

  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        previews
          .filter((p) => p.status === 'new' && !importedSourceIds.has(p.item.sourceId))
          .map((p) => p.item.sourceId)
      )
  );

  const toggle = (sourceId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  };

  const importable = previews.filter((p) => p.mappedType !== null && !importedSourceIds.has(p.item.sourceId));
  const selectedCount = importable.filter((p) => selected.has(p.item.sourceId)).length;
  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen: true, onClose: onCancel });

  return (
    <div
      className="modal-backdrop embedded-import-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="embedded-import-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div ref={trapRef} className="modal embedded-import-modal">
        <button className="modal-close" onClick={onCancel} disabled={busy} aria-label="Close">✕</button>
        <h2 id="embedded-import-title">Import embedded annotations</h2>
        <p>
          This PDF carries {counts.newCount + counts.duplicateCount} annotati{counts.newCount + counts.duplicateCount === 1 ? 'on' : 'ons'} it
          was authored with{counts.newCount + counts.duplicateCount === 1 ? '' : 's'}. Importing copies them into editable Reader
          records with <b>deterministic_transform</b> provenance (never presented as your own writing) — the PDF itself is never
          modified. Nothing is imported until you press Import.
        </p>
        <div className="destination-rule" />

        <div className="embedded-import-list" role="list">
          {previews.map((preview) => {
            const sourceId = preview.item.sourceId;
            const alreadyImported = importedSourceIds.has(sourceId);
            const unsupported = preview.mappedType === null;
            const checked = selected.has(sourceId) || alreadyImported;
            const disabled = busy || alreadyImported || unsupported;
            const colorKey = colorKeyFor(preview);
            const colorHex = preview.item.colorRgb ? rgbToHex(preview.item.colorRgb) : null;

            return (
              <div
                key={sourceId}
                className={`embedded-import-row status-${preview.status}${alreadyImported ? ' imported' : ''}`}
                role="listitem"
              >
                <label className="embedded-import-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(sourceId)}
                    aria-label={`Import ${preview.item.subtype} on page ${pageLabelFor(preview.item.pageIndex)}`}
                  />
                </label>
                <span className="embedded-import-badge">{preview.item.subtype}</span>
                <span className="embedded-import-main">
                  <b>
                    p. {pageLabelFor(preview.item.pageIndex)} — becomes {preview.mappedType ?? '—'}
                  </b>
                  <small>
                    {preview.item.contents ? `“${truncate(preview.item.contents, 140)}”` : 'No note text'}
                    {preview.item.author ? ` · by ${preview.item.author}` : ''}
                  </small>
                  <small className="embedded-import-provenance">
                    Provenance: deterministic_transform
                    {colorKey && (
                      <> · colour → palette “{paletteLabelFor(colorKey)}”</>
                    )}
                    {preview.item.rects.length > 1 ? ` · ${preview.item.rects.length} rects` : ''}
                  </small>
                </span>
                <span className="embedded-import-status">
                  {alreadyImported ? (
                    <em>imported</em>
                  ) : preview.status === 'new' ? (
                    <em className="ok">new</em>
                  ) : preview.status === 'duplicate' ? (
                    <em className="warn">duplicate</em>
                  ) : (
                    <em className="muted">skipped</em>
                  )}
                  <span
                    className="embedded-import-swatch"
                    style={{ background: colorHex ?? '#9b9797' }}
                    title={colorHex ? `PDF colour ${colorHex}` : 'No PDF colour'}
                  />
                </span>
                <p className="embedded-import-reason">{preview.reason}</p>
              </div>
            );
          })}
        </div>

        <div className="embedded-import-summary">
          {counts.newCount} new · {counts.duplicateCount} duplicate · {counts.unsupportedCount} skipped
          {importedSourceIds.size > 0 && ` · ${importedSourceIds.size} already imported`}
        </div>

        <div className="modal-actions">
          <button className="button compact" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="button compact primary"
            disabled={busy || selectedCount === 0}
            onClick={() => onImport(importable.filter((p) => selected.has(p.item.sourceId)))}
            title="Import the checked annotations as editable Reader records"
          >
            Import {selectedCount}
          </button>
        </div>
      </div>
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/** Convenience for the caller to build records without importing the module. */
export type ImportedRecordTuple = { preview: EmbeddedImportPreview; record: AnnotationRecord };
