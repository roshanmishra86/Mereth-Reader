import { useMemo, useState } from 'react';
import { DEFAULT_ANNOTATION_PALETTE, PaletteEntry } from '../utils/annotationTypes';
import { isValidPalette } from '../utils/annotationPalette';

interface SettingsAnnotationsProps {
  palette: PaletteEntry[];
  onSavePalette: (palette: PaletteEntry[]) => void;
}

/**
 * Task 3.5 — FR-9.3 configurable semantic palette. Colour and user label are
 * edited together; validation mirrors `annotationPalette.ts` so an invalid
 * edit cannot be saved. Removal only deletes the palette entry — annotations
 * that used that key fall back to neutral grey, their records untouched.
 */
export function SettingsAnnotations({ palette, onSavePalette }: SettingsAnnotationsProps) {
  const [draft, setDraft] = useState<PaletteEntry[]>(palette);
  const [error, setError] = useState<string | null>(null);

  const updateEntry = (index: number, patch: Partial<PaletteEntry>) => {
    setError(null);
    setDraft((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };

  const addEntry = () => {
    setError(null);
    const n = draft.length;
    const usedColors = new Set(draft.map((e) => e.color));
    let color = '';
    for (const hex of ['#e8a33d', '#b070d0', '#57a7a7', '#cd7f57', '#6773c4', '#3f9d58']) {
      if (!usedColors.has(hex)) {
        color = hex;
        break;
      }
    }
    if (!color) {
      setError('No unique colour left — remove one first.');
      return;
    }
    setDraft((prev) => [
      ...prev,
      { key: `custom-${n + 1}`, color, label: `Custom ${n + 1}` },
    ]);
  };

  const removeEntry = (index: number) => {
    setError(null);
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const valid = useMemo(() => isValidPalette(draft), [draft]);

  const save = () => {
    if (!isValidPalette(draft)) return;
    onSavePalette(draft.map((e) => ({ ...e, label: e.label.trim() })));
  };

  const reset = () => {
    setError(null);
    setDraft(DEFAULT_ANNOTATION_PALETTE);
  };

  return (
    <>
      <span className="eyebrow">Annotation colour & labels</span>
      <h1>Annotations</h1>
      <p>
        The semantic palette pairs a colour with your own label. Labels travel
        with quotes into exports; “claim”, “evidence”, “question”, and
        “disagree” are the shipped defaults — rename them freely. Removing a
        colour never deletes annotations; they fall back to neutral grey.
      </p>
      <div className="destination-rule" />

      <div className="setting-group">
        {draft.map((entry, index) => (
          <div className="palette-row" key={entry.key}>
            <label className="palette-color-field">
              <input
                type="color"
                value={entry.color}
                onChange={(e) => updateEntry(index, { color: e.target.value })}
                aria-label={`Colour for ${entry.label}`}
              />
            </label>
            <input
              className="palette-label-input"
              type="text"
              value={entry.label}
              maxLength={48}
              onChange={(e) => updateEntry(index, { label: e.target.value })}
              aria-label="Palette label"
            />
            <code className="palette-key">{entry.key}</code>
            {draft.length > 2 && (
              <button
                className="button compact"
                onClick={() => removeEntry(index)}
                title={`Remove ${entry.label || entry.key} from the palette`}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        {draft.length < 12 && (
          <button className="button compact" onClick={addEntry}>
            + Add colour
          </button>
        )}
        {error && <p className="popup-error" role="alert">{error}</p>}
        {!valid && (
          <p className="popup-error" role="alert">
            This palette is invalid — colours must be unique hex values and labels
            non-empty. Save is disabled.
          </p>
        )}
      </div>

      <div className="modal-actions">
        <button className="wide-action" onClick={reset}>Reset to defaults</button>
        <button className="wide-action primary" onClick={save} disabled={!valid}>
          Save palette
        </button>
      </div>
    </>
  );
}
