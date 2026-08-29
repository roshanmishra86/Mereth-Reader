import { Icon } from './icons';
import { useState, useEffect, useRef, useId } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { interceptExternalLink } from '../utils/securityBoundary';
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface ExternalLinkModalProps {
  url: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ExternalLinkModal({ url, isOpen, onClose }: ExternalLinkModalProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ isOpen, onClose, initialFocusRef: openButtonRef });
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (isOpen) {
      setCopyStatus('idle');
      setError(null);
      setTimeout(() => openButtonRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen || !url) return null;

  const decision = interceptExternalLink(url);
  let domain = 'Unknown Domain';
  try {
    const parsed = new URL(url);
    domain = parsed.hostname;
  } catch {
    // Malformed URL fallback
  }

  const handleOpenBrowser = async () => {
    if (!decision.allow || !decision.sanitizedUrl) {
      setError(decision.reason);
      return;
    }
    try {
      await invoke('cmd_open_external_url', { url: decision.sanitizedUrl });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('failed');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onKeyDown={handleKeyDown}
    >
      <div ref={trapRef} className="modal" style={{ maxWidth: '560px' }}>
        <button
          className="modal-close"
          onClick={onClose}
          aria-label="Close external link modal"
        >
          <Icon name="x" />
        </button>
        <span className="eyebrow">Security Boundary Disclosure</span>
        <h2 id={titleId}>External Link Navigation</h2>
        <p id={descId}>
          You are about to leave Mereth Reader and open a link in your system&apos;s default web browser.
          External websites operate outside Mereth Reader&apos;s local-first offline security boundary.
        </p>

        <div style={{ margin: '14px 0', padding: '10px 12px', background: '#eae9e9', border: '1px solid rgba(32,30,29,.4)' }}>
          <div style={{ fontSize: '11px', color: '#605d5d', marginBottom: '4px' }}>
            Domain: <strong style={{ color: '#201e1d' }}>{domain}</strong>
          </div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              wordBreak: 'break-all',
              color: decision.allow ? '#201e1d' : '#ae1800',
              padding: '6px',
              background: '#f3f2f2',
              border: '1px solid rgba(32,30,29,.2)',
            }}
          >
            {url}
          </div>
        </div>

        {!decision.allow && (
          <div className="banner" role="alert" style={{ margin: '10px 0' }}>
            <strong>Blocked Unsafe Link:</strong> {decision.reason}. Mereth Reader blocks non-web protocols (such as file://, javascript:, or shell execution) to protect your local device.
          </div>
        )}

        {error && (
          <div className="banner" role="alert" style={{ margin: '10px 0' }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: '20px' }}>
          <button type="button" className="button" onClick={handleCopy}>
            {copyStatus === 'copied' ? 'Copied to Clipboard' : copyStatus === 'failed' ? 'Copy Failed' : 'Copy Link'}
          </button>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {decision.allow && (
            <button
              ref={openButtonRef}
              type="button"
              className="button primary"
              onClick={() => void handleOpenBrowser()}
            >
              Open in Browser
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
