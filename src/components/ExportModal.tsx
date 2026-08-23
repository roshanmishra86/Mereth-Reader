import { useEffect, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

export type ExportFormat = 'markdown' | 'json_backup';
export interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat, destination: string) => void | Promise<void>;
}

export function ExportModal({ isOpen, onClose, onExport }: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose });

  useEffect(() => { if (isOpen) { setFormat('markdown'); setDestination(''); setBusy(false); setError(null); } }, [isOpen]);
  if (!isOpen) return null;

  const submit = async () => {
    setBusy(true); setError(null);
    try { await onExport(format, destination.trim()); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Export failed. Your existing data was not changed.'); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="export-modal-title">
    <div ref={trapRef} className="modal" style={{ width: 'min(560px, 100%)' }}>
      <button className="modal-close" type="button" onClick={onClose} aria-label="Close export dialog">x</button>
      <span className="eyebrow">FR-14 · portable output</span>
      <h2 id="export-modal-title">Export your work</h2>
      <p>Choose a readable package or a versioned local backup. The destination is explicit; existing files are not silently replaced.</p>
      <div role="radiogroup" aria-label="Export format">
        <label className={`import-choice ${format === 'markdown' ? 'selected' : ''}`}><input type="radio" checked={format === 'markdown'} onChange={() => setFormat('markdown')} /> <span><b>Markdown package</b><small>Notes, sources, assets, reviews, and a manifest readable without Mereth.</small></span></label>
        <label className={`import-choice ${format === 'json_backup' ? 'selected' : ''}`}><input type="radio" checked={format === 'json_backup'} onChange={() => setFormat('json_backup')} /> <span><b>JSON backup</b><small>Versioned documents, annotations, notes, links, prompts, review history, settings, and provenance.</small></span></label>
      </div>
      <label className="field-label" htmlFor="export-destination">Destination (optional until native picker is wired)<input id="export-destination" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder={format === 'markdown' ? 'Choose an export folder' : 'Choose a backup file'} /></label>
      {error && <div className="banner" role="alert">{error}</div>}
      <div className="modal-actions"><button className="button" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="button" onClick={submit} disabled={busy}>{busy ? 'Preparing...' : 'Export'}</button></div>
    </div>
  </div>;
}
