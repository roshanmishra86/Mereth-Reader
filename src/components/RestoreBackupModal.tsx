import { useMemo, useState } from 'react';
import { previewBackupRestore } from '../utils/backupRestore';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface RestoreBackupModalProps {
  isOpen: boolean;
  backupJson: string;
  onClose: () => void;
  onRestore: () => void | Promise<void>;
}

export function RestoreBackupModal({ isOpen, backupJson, onClose, onRestore }: RestoreBackupModalProps) {
  const [busy, setBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLElement>({ isOpen, onClose });
  const preview = useMemo(() => {
    try {
      return previewBackupRestore(JSON.parse(backupJson));
    } catch {
      return { valid: false, errors: ['Backup JSON could not be parsed.'], counts: {} };
    }
  }, [backupJson]);
  if (!isOpen) return null;

  const restore = async () => {
    if (!preview.valid) return;
    setBusy(true); setRestoreError(null);
    try {
      await onRestore();
      onClose();
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : 'Restore failed. Existing profile data was not changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="restore-backup-title">
      <section ref={trapRef} className="modal prompt-modal">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close restore dialog">x</button>
        <span className="eyebrow">Backup restore</span>
        <h2 id="restore-backup-title">Restore into this profile</h2>
        <p>Matching record IDs are updated and missing records are added. This restore does not clear the current profile or create a clean one.</p>
        {preview.valid ? (
          <pre>{JSON.stringify(preview.counts, null, 2)}</pre>
        ) : (
          <div className="banner" role="alert">{preview.errors.join(' ')}</div>
        )}
        {restoreError && <div className="banner" role="alert">{restoreError}</div>}
        <div className="modal-actions">
          <button className="button" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="button primary" type="button" onClick={() => void restore()} disabled={!preview.valid || busy}>Restore</button>
        </div>
      </section>
    </div>
  );
}
