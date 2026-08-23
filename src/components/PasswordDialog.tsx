import React, { useState } from 'react';
import { validatePdfPassword } from '../utils/recoveryUtils';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface PasswordDialogProps {
  isOpen: boolean;
  documentTitle: string;
  onPasswordSubmit: (password: string) => void;
  onCancel: () => void;
  isRejected?: boolean;
  errorMessage?: string;
}

export function PasswordDialog({
  isOpen,
  documentTitle,
  onPasswordSubmit,
  onCancel,
  isRejected = false,
  errorMessage,
}: PasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose: onCancel });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const check = validatePdfPassword(password);
    if (!check.isValid) {
      setValidationError(check.error || 'Invalid password.');
      return;
    }
    setValidationError(null);
    onPasswordSubmit(password);
  };

  return (
    <div className="sheet-backdrop" role="presentation">
      <div ref={trapRef} className="sheet password-dialog-sheet" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title">
        <header className="sheet-header">
          <h3 id="password-dialog-title">🔒 Password-Protected PDF</h3>
          <button className="icon-button" onClick={onCancel} aria-label="Cancel and close">
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="sheet-body">
            <p className="dimmed micro">
              The document <strong>"{documentTitle}"</strong> is encrypted. Enter the password to decrypt PDF streams in volatile memory. Decrypted bytes are never written to disk.
            </p>

            {(isRejected || errorMessage || validationError) && (
              <div className="banner danger" style={{ borderLeft: '4px solid #ec3013', background: '#fff2ef', padding: '10px', margin: '10px 0', fontSize: '12px', color: '#ae1800' }}>
                ⚠️ {errorMessage || validationError || 'Incorrect password. Decryption failed. Please try again.'}
              </div>
            )}

            <div style={{ marginTop: '14px' }}>
              <label htmlFor="pdf-password-input" className="field-label" style={{ fontWeight: 700, fontSize: '11px', display: 'block', marginBottom: '6px' }}>
                Document Password
              </label>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  id="pdf-password-input"
                  type={showPassword ? 'text' : 'password'}
                  className="input-field"
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid rgba(32,30,29,0.4)', background: '#fff', fontSize: '13px' }}
                  placeholder="Enter password..."
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  autoFocus
                />

                <button
                  type="button"
                  className="button secondary compact"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>

          <footer className="sheet-footer">
            <button type="button" className="button secondary" onClick={onCancel}>
              Cancel & Close
            </button>
            <button type="submit" className="button primary">
              Unlock Document
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
