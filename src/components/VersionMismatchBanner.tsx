import React from 'react';

interface VersionMismatchBannerProps {
  onReanchor: () => void;
  onDismiss: () => void;
}

export function VersionMismatchBanner({ onReanchor, onDismiss }: VersionMismatchBannerProps) {
  return (
    <div className="banner warning version-mismatch-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 14px', borderLeft: '4px solid #ec3013', background: '#fff2ef', margin: '8px 12px', fontSize: '12px', borderRadius: '3px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px' }}>⚠️</span>
        <div>
          <strong>Document Version Mismatch:</strong> The file content on disk has changed since annotations were created. Existing text highlights or notes may need re-anchoring.
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flex: 'none' }}>
        <button className="button primary compact" onClick={onReanchor}>
          Re-anchor
        </button>
        <button className="button secondary compact" onClick={onDismiss}>
          Ignore
        </button>
      </div>
    </div>
  );
}
