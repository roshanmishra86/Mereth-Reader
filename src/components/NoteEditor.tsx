import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NoteRecord, NoteRevisionRecord, validateConceptTitleGuidance } from '../utils/notesTypes';
import { AutosaveCoordinator, diffNoteRevisions } from '../utils/noteRevisions';
import type { EvidenceBlockRecord } from '../utils/evidenceTypes';
import { EvidenceBlockCard } from './EvidenceBlockCard';

export interface NoteEditorProps {
  note: NoteRecord;
  revisions: NoteRevisionRecord[];
  evidenceBlocks?: EvidenceBlockRecord[];
  onSave: (id: string, title: string, bodyMarkdown: string) => Promise<void>;
  onPromoteScratch?: (id: string, targetType: 'concept' | 'source') => Promise<void>;
  onTrash?: (id: string) => Promise<void>;
  onRestoreRevision?: (noteId: string, revisionNumber: number) => Promise<void>;
  onUpdateEvidenceComment?: (id: string, comment: string) => Promise<void>;
  onReorderEvidence?: (noteId: string, blockIds: string[]) => Promise<void>;
  onDeleteEvidence?: (id: string) => Promise<void>;
  onNavigateToSource?: (block: EvidenceBlockRecord) => void;
}

export const NoteEditor: React.FC<NoteEditorProps> = ({
  note,
  revisions,
  evidenceBlocks = [],
  onSave,
  onPromoteScratch,
  onTrash,
  onRestoreRevision,
  onUpdateEvidenceComment,
  onReorderEvidence,
  onDeleteEvidence,
  onNavigateToSource,
}) => {
  const [title, setTitle] = useState(note.title);
  const [bodyMarkdown, setBodyMarkdown] = useState(note.body_markdown);
  const [isPreview, setIsPreview] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');

  const autosaveRef = useRef<AutosaveCoordinator>(new AutosaveCoordinator(400));

  // Sync internal state when active note changes
  useEffect(() => {
    setTitle(note.title);
    setBodyMarkdown(note.body_markdown);
    setSaveStatus('saved');
    setShowRevisions(false);
  }, [note.id]);

  const persistEdits = useCallback(
    async (id: string, newTitle: string, newBody: string) => {
      setSaveStatus('saving');
      try {
        await onSave(id, newTitle, newBody);
        setSaveStatus('saved');
      } catch (err) {
        console.error('Save failed:', err);
        setSaveStatus('dirty');
      }
    },
    [onSave]
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTitle = e.target.value;
    setTitle(nextTitle);
    setSaveStatus('dirty');
    autosaveRef.current.enqueue(note.id, nextTitle, bodyMarkdown, persistEdits);
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextBody = e.target.value;
    setBodyMarkdown(nextBody);
    setSaveStatus('dirty');
    autosaveRef.current.enqueue(note.id, title, nextBody, persistEdits);
  };

  const handleBlur = () => {
    if (autosaveRef.current.hasPending(note.id)) {
      void autosaveRef.current.flush(note.id, persistEdits);
    }
  };

  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    if (!onReorderEvidence) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= evidenceBlocks.length) return;
    const newBlocks = [...evidenceBlocks];
    const [moved] = newBlocks.splice(index, 1);
    newBlocks.splice(targetIndex, 0, moved);
    void onReorderEvidence(
      note.id,
      newBlocks.map((b) => b.id)
    );
  };

  const conceptGuidance = note.note_type === 'concept' ? validateConceptTitleGuidance(title) : null;

  return (
    <article className="note-reading" style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      {/* Scratch Note Banner */}
      {note.note_type === 'scratch' && onPromoteScratch && (
        <div className="banner info" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <strong>Scratch Note</strong>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#444141' }}>
              Scratch notes are temporary workpads and are excluded from polished knowledge exports until promoted.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button className="button compact primary" onClick={() => onPromoteScratch(note.id, 'concept')}>
              Promote to Concept
            </button>
            <button className="button compact" onClick={() => onPromoteScratch(note.id, 'source')}>
              Promote to Source
            </button>
          </div>
        </div>
      )}

      {/* Editor Header & Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '1px solid rgba(32,30,29,.2)', paddingBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="eyebrow" style={{ margin: 0 }}>
            {note.note_type} note
          </span>
          <span style={{ fontSize: '10px', color: saveStatus === 'dirty' ? '#ae1800' : '#605d5d' }}>
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'dirty' ? 'Unsaved edits' : `Autosaved · ${revisions.length} revisions kept`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="outline-button"
            style={{ fontSize: '10.5px', padding: '3px 8px' }}
            onClick={() => setIsPreview(!isPreview)}
          >
            {isPreview ? 'Edit Markdown' : 'Preview'}
          </button>

          <button
            className="outline-button"
            style={{ fontSize: '10.5px', padding: '3px 8px' }}
            onClick={() => setShowRevisions(!showRevisions)}
          >
            History ({revisions.length})
          </button>

          {onTrash && !note.deleted_at && (
            <button
              className="outline-button"
              style={{ fontSize: '10.5px', padding: '3px 8px', color: '#ae1800' }}
              onClick={() => onTrash(note.id)}
            >
              Trash
            </button>
          )}
        </div>
      </div>

      {/* Revisions History Drawer */}
      {showRevisions && (
        <div style={{ background: '#eae9e9', border: '1px solid rgba(32,30,29,.3)', padding: '12px', marginBottom: '14px', borderRadius: '2px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Local Revision History (Max 20 Bounded)
            </strong>
            <button className="icon-button" style={{ fontSize: '12px' }} onClick={() => setShowRevisions(false)}>✕</button>
          </div>
          {revisions.length === 0 ? (
            <div style={{ fontSize: '11px', color: '#605d5d' }}>No prior revisions recorded.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
              {revisions.map((rev, index) => {
                const prevRev = index < revisions.length - 1 ? revisions[index + 1] : rev;
                const diff = diffNoteRevisions(prevRev, rev);
                return (
                  <div
                    key={rev.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      background: '#f3f2f2',
                      border: '1px solid rgba(32,30,29,.2)',
                      fontSize: '11px',
                    }}
                  >
                    <div>
                      <strong>Rev #{rev.revision_number}</strong>
                      <span style={{ marginLeft: '8px', color: '#605d5d', fontSize: '10px' }}>
                        {new Date(rev.created_at).toLocaleTimeString()}
                      </span>
                      <small style={{ display: 'block', color: '#444141', marginTop: '2px' }}>
                        {diff.description}
                      </small>
                    </div>
                    {onRestoreRevision && (
                      <button
                        className="button compact"
                        style={{ fontSize: '10px', padding: '2px 6px' }}
                        onClick={() => onRestoreRevision(note.id, rev.revision_number)}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Title Input & Non-blocking Concept Guidance */}
      <div style={{ marginBottom: '14px' }}>
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          onBlur={handleBlur}
          placeholder={note.note_type === 'concept' ? 'e.g. Testing enhances delayed memory retention' : 'Note title...'}
          style={{
            width: '100%',
            fontSize: '22px',
            fontWeight: 700,
            padding: '6px 0',
            border: 0,
            borderBottom: '2px solid rgba(32,30,29,.4)',
            background: 'transparent',
            outline: 0,
            fontFamily: 'inherit',
          }}
        />
        {conceptGuidance && conceptGuidance.suggestion && (
          <div style={{ marginTop: '4px', fontSize: '10.5px', color: '#ae1800', fontStyle: 'italic' }}>
            💡 {conceptGuidance.suggestion}
          </div>
        )}
      </div>

      {/* Markdown Body Editor or Rendered View */}
      {isPreview ? (
        <div
          style={{
            padding: '12px',
            background: '#eae9e9',
            border: '1px solid rgba(32,30,29,.2)',
            minHeight: '200px',
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
            lineHeight: 1.6,
          }}
        >
          {bodyMarkdown || <em style={{ color: '#605d5d' }}>Empty note body.</em>}
        </div>
      ) : (
        <textarea
          value={bodyMarkdown}
          onChange={handleBodyChange}
          onBlur={handleBlur}
          placeholder="Write your note in Markdown..."
          style={{
            width: '100%',
            minHeight: '220px',
            padding: '12px',
            border: '1px solid rgba(32,30,29,.4)',
            background: '#eae9e9',
            fontFamily: 'inherit',
            fontSize: '13px',
            lineHeight: 1.6,
            resize: 'vertical',
          }}
        />
      )}

      {/* Evidence & Excerpts Section (FR-10.1, FR-10.2) */}
      <section style={{ marginTop: '20px', paddingTop: '16px', borderTop: '2px solid rgba(32,30,29,.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <strong style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Attached Evidence & Source Excerpts ({evidenceBlocks.length})
          </strong>
        </div>

        {evidenceBlocks.length === 0 ? (
          <div style={{ fontSize: '11.5px', color: '#605d5d', fontStyle: 'italic', padding: '8px 0' }}>
            No evidence blocks attached yet. Use &ldquo;Add to note&rdquo; on annotations or selections in the reader.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {evidenceBlocks.map((block, index) => (
              <EvidenceBlockCard
                key={block.id}
                block={block}
                canMoveUp={index > 0}
                canMoveDown={index < evidenceBlocks.length - 1}
                onMoveUp={() => handleMoveBlock(index, 'up')}
                onMoveDown={() => handleMoveBlock(index, 'down')}
                onDelete={() => onDeleteEvidence && void onDeleteEvidence(block.id)}
                onUpdateComment={(comment) => onUpdateEvidenceComment && void onUpdateEvidenceComment(block.id, comment)}
                onNavigateToSource={(b) => onNavigateToSource && onNavigateToSource(b)}
              />
            ))}
          </div>
        )}
      </section>
    </article>
  );
};
