import React from 'react';

interface ScannedPdfBannerProps {
  onDismiss: () => void;
  onActivateAreaCapture?: () => void;
}

export function ScannedPdfBanner({ onDismiss, onActivateAreaCapture }: ScannedPdfBannerProps) {
  return (
    <div className="banner info scanned-pdf-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 14px', borderLeft: '4px solid #7ea3c6', background: '#eef5fc', margin: '8px 12px', fontSize: '12px', borderRadius: '3px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '16px' }}>📷</span>
        <div>
          <strong>Scanned PDF / Image-Only Page:</strong> This page contains image content without a selectable text layer. Text highlighting and text search are unavailable for scanned pages.
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flex: 'none' }}>
        {onActivateAreaCapture && (
          <button className="button primary compact" onClick={onActivateAreaCapture}>
            Area Capture
          </button>
        )}
        <button className="button secondary compact" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
