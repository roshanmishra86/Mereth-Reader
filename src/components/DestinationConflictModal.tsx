import { suggestCopyPath } from '../utils/destinationSafety';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { evaluateResilientState } from '../utils/resilientStateMatrix';

interface DestinationConflictModalProps {
  isOpen: boolean;
  path: string;
  diffPreview: string;
  onOverwrite: () => void;
  onRename: (path: string) => void;
  onCancel: () => void;
}

export function DestinationConflictModal({
  isOpen,
  path,
  diffPreview,
  onOverwrite,
  onRename,
  onCancel,
}: DestinationConflictModalProps) {
  const trapRef = useFocusTrap<HTMLElement>({ isOpen, onClose: onCancel });
  const resilientState = evaluateResilientState({ exportConflict: true });
  if (!isOpen) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="destination-conflict-title">
      <section ref={trapRef} className="modal prompt-modal">
        <button className="modal-close" type="button" onClick={onCancel} aria-label="Close destination conflict">x</button>
        <span className="eyebrow">Export conflict</span>
        <h2 id="destination-conflict-title">{resilientState.title}</h2>
        <p>{resilientState.description} Review the difference before replacing anything.</p>
        <pre>{diffPreview}</pre>
        <div className="modal-actions">
          <button className="button" type="button" onClick={onCancel}>Cancel</button>
          <button className="button" type="button" onClick={() => onRename(suggestCopyPath(path))}>Rename copy</button>
          <button className="button primary" type="button" onClick={onOverwrite}>Overwrite</button>
        </div>
      </section>
    </div>
  );
}
