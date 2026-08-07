import React from 'react';
import { EmptyStateViewType, getEmptyStateDetails } from '../utils/recoveryUtils';

interface EmptyStateProps {
  viewType: EmptyStateViewType;
  context?: { searchQuery?: string; collectionName?: string };
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  customTitle?: string;
  customDescription?: string;
}

export function EmptyState({
  viewType,
  context,
  onPrimaryAction,
  onSecondaryAction,
  customTitle,
  customDescription,
}: EmptyStateProps) {
  const details = getEmptyStateDetails(viewType, context);
  const title = customTitle || details.title;
  const description = customDescription || details.description;

  return (
    <div
      className={`empty-state-card empty-${viewType}-state`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        textAlign: 'center',
        margin: 'auto',
      }}
    >
      <div style={{ fontSize: '36px', marginBottom: '10px' }}>{details.icon}</div>
      <h3 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 700, color: '#201e1d' }}>
        {title}
      </h3>
      <p
        className="dimmed"
        style={{
          maxWidth: '420px',
          margin: '0 0 16px',
          fontSize: '12px',
          lineHeight: 1.45,
          color: '#605d5d',
        }}
      >
        {description}
      </p>

      <div style={{ display: 'flex', gap: '8px' }}>
        {details.primaryActionLabel && onPrimaryAction && (
          <button className="button primary compact" onClick={onPrimaryAction}>
            {details.primaryActionLabel}
          </button>
        )}
        {details.secondaryActionLabel && onSecondaryAction && (
          <button className="button secondary compact" onClick={onSecondaryAction}>
            {details.secondaryActionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
