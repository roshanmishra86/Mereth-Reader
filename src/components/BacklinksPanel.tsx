/**
 * Task 4.3 — Backlinks panel for NoteEditor (PRD R3, FR-10.5).
 *
 * Shows all notes linking to the currently active note with stable navigation.
 */

import React from 'react';
import type { BacklinkRecord } from '../utils/noteLinks';

const Glyph: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="glyph" aria-hidden="true">{children}</span>
);

interface BacklinksPanelProps {
  backlinks: BacklinkRecord[];
  onOpenNote: (noteId: string) => void;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = ({
  backlinks,
  onOpenNote,
}) => {
  if (backlinks.length === 0) {
    return (
      <div className="backlinks-panel empty">
        <span className="backlinks-title">
          <Glyph>☍</Glyph> Linked mentions (0)
        </span>
        <p className="dimmed">No other notes link to this note yet.</p>
      </div>
    );
  }

  return (
    <div className="backlinks-panel">
      <div className="backlinks-header">
        <span className="backlinks-title">
          <Glyph>☍</Glyph> Linked mentions ({backlinks.length})
        </span>
      </div>
      <div className="backlinks-list">
        {backlinks.map((link) => (
          <button
            key={link.link_id}
            type="button"
            className="backlink-item"
            onClick={() => onOpenNote(link.source_note_id)}
            title={`Open ${link.source_note_title}`}
          >
            <span className={`note-badge ${link.source_note_type}`}>
              {link.source_note_type}
            </span>
            <span className="backlink-name">{link.source_note_title}</span>
            <span className="backlink-arrow">→</span>
          </button>
        ))}
      </div>
    </div>
  );
};
