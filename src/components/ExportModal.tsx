import { useEffect, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
  EXPORT_DEFINITIONS,
  exportProgressFor,
  getExportDefinition,
  nativeWriterUnavailableMessage,
  type ExportFormat,
  type ExportProgressStage,
} from '../utils/exportJob';

export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat, destination: string) => void | Promise<void>;
  onChooseDestination: (format: ExportFormat) => Promise<string | null>;
}

export type { ExportFormat } from '../utils/exportJob';

export function ExportModal({ isOpen, onClose, onExport, onChooseDestination }: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<ExportProgressStage>('idle');
  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose });

  useEffect(() => { if (isOpen) { setFormat('markdown'); setDestination(''); setBusy(false); setError(null); setStage('idle'); } }, [isOpen]);
  if (!isOpen) return null;

  const definition = getExportDefinition(format);
  const unavailableMessage = nativeWriterUnavailableMessage(format);

  const chooseDestination = async () => {
    setBusy(true); setError(null); setStage('choosing_destination');
    try {
      const selected = await onChooseDestination(format);
      if (selected) setDestination(selected);
      setStage('idle');
    } catch (err) {
      setStage('failed');
      setError(err instanceof Error ? `Native destination picker failed: ${err.message}` : 'The native destination picker could not be opened.');
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (unavailableMessage) { setError(unavailableMessage); return; }
    if (!destination) { setError('Choose a native destination first.'); return; }
    setBusy(true); setError(null);
    setStage('inspecting_destination');
    try {
      await onExport(format, destination);
      setStage('completed');
      onClose();
    } catch (err) {
      setStage('failed');
      setError(err instanceof Error ? err.message : exportProgressFor('failed').message);
    } finally { setBusy(false); }
  };

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
    <div ref={trapRef} className="modal" style={{ width: 'min(560px, 100%)' }}>
      <button className="modal-close" type="button" onClick={onClose} aria-label="Close export dialog">x</button>
      <span className="eyebrow">FR-14 · portable output</span>
      <h2 id="export-modal-title">Export your work</h2>
      <p>Choose a readable package, review table, or versioned local backup. The native picker makes the destination explicit; existing files are not silently replaced.</p>
      <div role="radiogroup" aria-label="Export format">
        {EXPORT_DEFINITIONS.map((option) => <label key={option.format} className={`import-choice ${format === option.format ? 'selected' : ''}`}>
          <input type="radio" checked={format === option.format} onChange={() => { setFormat(option.format); setDestination(''); setError(null); setStage('idle'); }} />
          <span><b>{option.label}</b><small>{option.description}{option.capability !== 'ready' ? ' Native writer connection pending.' : ''}</small></span>
        </label>)}
      </div>
      <div className="field-label">
        <span>Native destination</span>
        <div className="modal-actions">
          <button className="button" type="button" onClick={() => void chooseDestination()} disabled={busy || Boolean(unavailableMessage)}>{destination ? 'Choose another…' : definition.destinationKind === 'directory' ? 'Choose folder…' : 'Choose file…'}</button>
          {destination && <span role="status" aria-live="polite">{destination}</span>}
        </div>
      </div>
      {unavailableMessage && <div className="banner" role="status">{unavailableMessage}</div>}
      {stage !== 'idle' && stage !== 'completed' && <p role="status" aria-live="polite">{exportProgressFor(stage).message}</p>}
      <p className="form-help">The current native commands do not report cancellable or atomic-commit progress to the frontend. Keep Mereth open until completion; a failed export is reported without claiming that recovery was completed.</p>
      {error && <div className="banner" role="alert">{error}</div>}
      <div className="modal-actions"><button className="button" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="button" onClick={() => void submit()} disabled={busy || Boolean(unavailableMessage)}>{busy ? 'Preparing…' : unavailableMessage ? 'Native writer required' : 'Export'}</button></div>
    </div>
  </div>;
}
