import { Icon } from './icons';
import React, { useState, useEffect, useRef, useCallback, useMemo, useImperativeHandle } from 'react';
import { NoteRecord, NoteRevisionRecord, validateConceptTitleGuidance } from '../utils/notesTypes';
import type { EvidenceBlockRecord } from '../utils/evidenceTypes';
import { AutosaveCoordinator, diffNoteRevisions, registerPendingSaveHandler, getRecoverableDraft } from '../utils/noteRevisions';
import type { AnnotationRecord } from '../utils/annotationTypes';
import { EvidenceBlockCard } from './EvidenceBlockCard';
import type { BacklinkRecord } from '../utils/noteLinks';
import { extractWikiLinks, formatWikiLink, syncNoteLinks } from '../utils/noteLinks';
import { BacklinksPanel } from './BacklinksPanel';
import { SplitNoteModal } from './SplitNoteModal';
import type { SplitNoteResult } from '../utils/noteSplit';
import { renderMarkdownToHtml } from '../utils/markdownRenderer';
import { copyQuickCopy } from '../utils/quickCopy';
import { listPromptsForSource } from '../utils/promptsIo';
import { pendingWork } from '../utils/pendingWork';


interface WikiLinkCandidate {
  kind: 'note' | 'ann';
  id: string;
  label: string;
  meta: string;
  annotation?: AnnotationRecord;
}

function getTextareaCaretPosition(textarea: HTMLTextAreaElement, position: number) {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  mirror.style.position = 'fixed';
  mirror.style.left = '-10000px';
  mirror.style.top = '0';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.boxSizing = computed.boxSizing;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.padding = computed.padding;
  mirror.style.border = computed.border;
  mirror.style.font = computed.font;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(position, position + 1) || '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.6;
  const left = Math.max(8, Math.min(marker.offsetLeft - textarea.scrollLeft, textarea.clientWidth - 398));
  const top = Math.max(8, marker.offsetTop - textarea.scrollTop + lineHeight + 4);
  mirror.remove();
  return { left, top };
}

export interface NoteEditorProps {
  note: NoteRecord;
  revisions: NoteRevisionRecord[];
  evidenceBlocks?: EvidenceBlockRecord[];
  backlinks?: BacklinkRecord[];
  onSave: (id: string, title: string, bodyMarkdown: string) => Promise<void>;
  onPromoteScratch?: (id: string, targetType: 'concept' | 'source') => Promise<void>;
  onTrash?: (id: string) => Promise<void>;
  onRestoreRevision?: (noteId: string, revisionNumber: number) => Promise<void>;
  onUpdateEvidenceComment?: (id: string, comment: string) => Promise<void>;
  onReorderEvidence?: (noteId: string, blockIds: string[]) => Promise<void>;
  onDeleteEvidence?: (id: string) => Promise<void>;
  onNavigateToSource?: (block: EvidenceBlockRecord) => void;
  onOpenNote?: (noteId: string) => void;
  onSplitNote?: (result: SplitNoteResult) => void;
  onRememberNote?: (note: NoteRecord) => void;
  onRememberEvidence?: (block: EvidenceBlockRecord) => void;
  onRestoreNote?: (id: string) => Promise<void> | void;
  onPurgeNote?: (id: string) => Promise<void> | void;
  mode?: 'read' | 'edit';
  onModeChange?: (mode: 'read' | 'edit') => void;
  onLinksChanged?: () => void | Promise<void>;
  linkableNotes?: NoteRecord[];
  linkableAnnotations?: AnnotationRecord[];
  onOpenAnnotation?: (annotation: AnnotationRecord) => void;
}


export interface NoteEditorHandle {
  flush: () => Promise<void>;
  addRelatedLink: (targetId: string, targetTitle: string) => Promise<void>;
  getCurrentDraft: () => { title: string; bodyMarkdown: string };
}

export const NoteEditor = React.forwardRef<NoteEditorHandle, NoteEditorProps>(({
  note,
  revisions,
  evidenceBlocks = [],
  backlinks = [],
  onSave,
  onPromoteScratch,
  onTrash,
  onRestoreRevision,
  onRestoreNote,
  onPurgeNote,
  onUpdateEvidenceComment,
  onReorderEvidence,
  onDeleteEvidence,
  onNavigateToSource,
  onOpenNote,
  onSplitNote,
  onRememberNote,

  onRememberEvidence,
  mode,
  onModeChange,
  onLinksChanged,
  linkableNotes = [],
  linkableAnnotations = [],
  onOpenAnnotation,
}, ref) => {
  const [title, setTitle] = useState(note.title);
  const [bodyMarkdown, setBodyMarkdown] = useState(note.body_markdown);
  const [isPreview, setIsPreview] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);

  const [wikiQuery, setWikiQuery] = useState<{ start: number; query: string; activeIndex: number; top: number; left: number } | null>(null);
  const previewMode = mode ? mode === 'read' : isPreview;

  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const saveStatusByNoteRef = useRef<Record<string, 'saved' | 'saving' | 'dirty'>>({});
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [promptCount, setPromptCount] = useState(0);

  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [selectedTextForSplit, setSelectedTextForSplit] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autosaveRef = useRef<AutosaveCoordinator>(new AutosaveCoordinator(400));
  const currentNoteIdRef = useRef(note.id);
  const titleRef = useRef(title);
  titleRef.current = title;
  const bodyRef = useRef(bodyMarkdown);
  bodyRef.current = bodyMarkdown;

  const persistEdits = useCallback(
    async (id: string, newTitle: string, newBody: string) => {
      saveStatusByNoteRef.current[id] = 'saving';
      if (id === currentNoteIdRef.current) {
        setSaveStatus('saving');
      }
      try {
        await onSave(id, newTitle, newBody);
        saveStatusByNoteRef.current[id] = 'saved';
        if (id === currentNoteIdRef.current) {
          setSaveStatus('saved');
        }
        try {
          const parsed = extractWikiLinks(newBody);
          await syncNoteLinks(id, {
            noteIds: parsed.targetNoteIds,
            docIds: parsed.targetDocIds,
            annIds: parsed.targetAnnIds,
          });
          await onLinksChanged?.();
        } catch (linkErr) {
          console.warn(`Link sync failed for note ${id}:`, linkErr);
        }
      } catch (err) {
        console.error('Save failed:', err);
        saveStatusByNoteRef.current[id] = 'dirty';
        if (id === currentNoteIdRef.current) {
          setSaveStatus('dirty');
        }
        throw err;
      }
    },
    [onSave, onLinksChanged]
  );

  // Sync internal state when active note changes or is restored
  useEffect(() => {
    const idChanged = currentNoteIdRef.current !== note.id;
    currentNoteIdRef.current = note.id;

    if (idChanged || (!autosaveRef.current.hasPending(note.id) && !autosaveRef.current.hasInFlight(note.id))) {
      const draft = getRecoverableDraft(note.id);
      if (draft && (draft.title !== note.title || draft.bodyMarkdown !== note.body_markdown)) {
        setTitle(draft.title);
        setBodyMarkdown(draft.bodyMarkdown);
        titleRef.current = draft.title;
        bodyRef.current = draft.bodyMarkdown;
        saveStatusByNoteRef.current[note.id] = 'dirty';
        setSaveStatus('dirty');
        setShowRevisions(false);
        autosaveRef.current.enqueue(note.id, draft.title, draft.bodyMarkdown, persistEdits);
      } else {
        setTitle(note.title);
        setBodyMarkdown(note.body_markdown);
        if (!autosaveRef.current.hasPending(note.id) && !autosaveRef.current.hasInFlight(note.id)) {
          saveStatusByNoteRef.current[note.id] = 'saved';
        }
        setSaveStatus(saveStatusByNoteRef.current[note.id] ?? 'saved');
        setShowRevisions(false);
      }
    }
  }, [note.id, note.updated_at, note.title, note.body_markdown, persistEdits]);

  useEffect(() => {
    let cancelled = false;
    void listPromptsForSource(null, note.id).then((prompts) => {
      if (!cancelled) setPromptCount(prompts.length);
    }).catch(() => { if (!cancelled) setPromptCount(0); });
    return () => { cancelled = true; };
  }, [note.id]);

  useImperativeHandle(ref, () => ({
    flush: async () => {
      await autosaveRef.current.flush(note.id, persistEdits);
    },
    getCurrentDraft: () => ({
      title: titleRef.current,
      bodyMarkdown: bodyRef.current,
    }),
    addRelatedLink: async (targetId: string, targetTitle: string) => {
        const currentBody = bodyRef.current;
        const currentTitle = titleRef.current;
        const wikiLink = formatWikiLink('note', targetId, targetTitle);
        if (currentBody.includes(`mereth:note/${targetId}`)) {
          return;
        }

        const hasRelatedSection = /^## Related notes\s*$/im.test(currentBody);
        const separator = currentBody.trim() ? '\n\n' : '';
        const nextBody = hasRelatedSection
          ? `${currentBody.trimEnd()}\n- ${wikiLink}`
          : `${currentBody}${separator}## Related notes\n\n- ${wikiLink}`;

        setBodyMarkdown(nextBody);
        bodyRef.current = nextBody;
        // Write the replacement into the WAL before waiting on any older save;
        // the coordinator clears it only if this generation saves successfully.
        await autosaveRef.current.replace(note.id, currentTitle, nextBody, persistEdits);
    },
  }), [note.id, persistEdits]);

  useEffect(() => pendingWork.register(`note:${note.id}`, async () => {
    await autosaveRef.current.flush(note.id, persistEdits);
  }), [note.id, persistEdits]);

  useEffect(() => {
    return registerPendingSaveHandler(async () => {
      await autosaveRef.current.flush(currentNoteIdRef.current, persistEdits);
    });
  }, [persistEdits]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTitle = e.target.value;
    setTitle(nextTitle);
    saveStatusByNoteRef.current[note.id] = 'dirty';
    setSaveStatus('dirty');
    autosaveRef.current.enqueue(note.id, nextTitle, bodyMarkdown, persistEdits);
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextBody = e.target.value;
    const caret = e.target.selectionStart;
    setBodyMarkdown(nextBody);
    saveStatusByNoteRef.current[note.id] = 'dirty';
    setSaveStatus('dirty');
    autosaveRef.current.enqueue(note.id, title, nextBody, persistEdits);

    const textBeforeCaret = nextBody.slice(0, caret);
    const triggerIndex = textBeforeCaret.lastIndexOf('[[');
    if (triggerIndex !== -1) {
      const query = textBeforeCaret.slice(triggerIndex + 2);
      if (!query.includes('\n') && !query.includes(']]')) {
        const anchor = getTextareaCaretPosition(e.target, caret);
        setWikiQuery({
          start: triggerIndex,
          query,
          activeIndex: 0,
          ...anchor,
        });
        return;
      }
    }
    setWikiQuery(null);
  };

  const handleBlur = () => {
    if (autosaveRef.current.hasPending(note.id)) {
      void autosaveRef.current.flush(note.id, persistEdits);
    }
  };

  const handleOpenSplit = () => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      const selected = bodyMarkdown.substring(start, end).trim();
      setSelectedTextForSplit(selected || bodyMarkdown.trim());
    } else {
      setSelectedTextForSplit(bodyMarkdown.trim());
    }
    setSplitModalOpen(true);
  };

  const handleConfirmSplit = (result: SplitNoteResult) => {
    setBodyMarkdown(result.updatedOriginalNote.body_markdown);
    onSplitNote?.(result);
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
  const renderedMarkdown = useMemo(() => renderMarkdownToHtml(bodyMarkdown), [bodyMarkdown]);
  const wordCount = useMemo(() => bodyMarkdown.trim() ? bodyMarkdown.trim().split(/\s+/).length : 0, [bodyMarkdown]);
  const wikiSuggestions = useMemo(() => {
    if (!wikiQuery) return [];
    const query = wikiQuery.query.toLocaleLowerCase();
    const noteCandidates: WikiLinkCandidate[] = linkableNotes
      .filter((candidate) => candidate.id !== note.id && !candidate.deleted_at)
      .map((candidate) => ({
        kind: 'note',
        id: candidate.id,
        label: candidate.title || 'Untitled note',
        meta: candidate.note_type === 'scratch' ? 'Quick note' : `${candidate.note_type} note`,
      }));
    const annotationCandidates: WikiLinkCandidate[] = linkableAnnotations.map((annotation) => ({
      kind: 'ann',
      id: annotation.id,
      label: annotation.quote || annotation.comment || `${annotation.annotation_type} on page ${annotation.page_label}`,
      meta: `${annotation.annotation_type} · p. ${annotation.page_label}`,
      annotation,
    }));
    return [...noteCandidates, ...annotationCandidates]
      .filter((candidate) => !query || `${candidate.label} ${candidate.meta}`.toLocaleLowerCase().includes(query))
      .slice(0, 12);
  }, [linkableAnnotations, linkableNotes, note.id, wikiQuery]);

  const insertWikiLink = (target: WikiLinkCandidate) => {
    const textarea = textareaRef.current;
    if (!textarea || !wikiQuery) return;
    const caret = textarea.selectionStart;
    const suffixLength = bodyMarkdown.slice(caret, caret + 2) === ']]' ? 2 : 0;
    const link = formatWikiLink(target.kind, target.id, target.label);
    const nextBody = `${bodyMarkdown.slice(0, wikiQuery.start)}${link}${bodyMarkdown.slice(caret + suffixLength)}`;
    const nextCaret = wikiQuery.start + link.length;
    setBodyMarkdown(nextBody);
    setWikiQuery(null);
    saveStatusByNoteRef.current[note.id] = 'dirty';
    setSaveStatus('dirty');
    autosaveRef.current.enqueue(note.id, title, nextBody, persistEdits);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!wikiQuery) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setWikiQuery(null);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setWikiQuery((current) => current ? { ...current, activeIndex: Math.max(0, Math.min(wikiSuggestions.length - 1, current.activeIndex + direction)) } : null);
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && wikiSuggestions.length > 0) {
      event.preventDefault();
      insertWikiLink(wikiSuggestions[Math.min(wikiQuery.activeIndex, wikiSuggestions.length - 1)]);
    }
  };

  const handlePreviewClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.wiki-link[data-link-id]');
    if (!link) return;
    event.preventDefault();
    const targetId = link.dataset.linkId;
    if (!targetId) return;
    if (link.dataset.linkKind === 'note') onOpenNote?.(targetId);
    if (link.dataset.linkKind === 'ann') {
      const annotation = linkableAnnotations?.find((item) => item.id === targetId);
      if (annotation) {
        onOpenAnnotation?.(annotation);
      } else {
        onOpenAnnotation?.({ id: targetId } as AnnotationRecord);
      }
    }
  };

  const setEditorMode = (next: 'read' | 'edit') => {
    if (onModeChange) onModeChange(next);
    else setIsPreview(next === 'read');
  };

  const wrapSelection = (before: string, after = before, fallback = 'text') => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = bodyMarkdown.slice(start, end) || fallback;
    const nextBody = `${bodyMarkdown.slice(0, start)}${before}${selection}${after}${bodyMarkdown.slice(end)}`;
    setBodyMarkdown(nextBody);
    saveStatusByNoteRef.current[note.id] = 'dirty';
    setSaveStatus('dirty');
    autosaveRef.current.enqueue(note.id, title, nextBody, persistEdits);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selection.length);
    });
  };


  return (
    <article className="note-reading" style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
      {/* Trashed Note Banner */}
      {note.deleted_at && (
        <div className="banner warning" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
          <div>
            <strong>Note is in Trash</strong>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#444141' }}>
              This note is trashed and will be permanently deleted after 30 days.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            {onRestoreNote && (
              <button className="button compact primary" onClick={() => onRestoreNote(note.id)}>
                Restore note
              </button>
            )}
            {onPurgeNote && (
              <button
                className="button compact"
                style={{ color: '#ae1800' }}
                onClick={() => onPurgeNote(note.id)}
              >
                Permanently delete
              </button>
            )}
          </div>
        </div>
      )}

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
          {onRememberNote && (
            <button
              className="outline-button"
              style={{ fontSize: '10.5px', padding: '3px 8px' }}
              onClick={() => onRememberNote(note)}
              title="Create a review prompt linked to this note (FR-11.1)"
            >
              Remember
            </button>
          )}
          <button className="outline-button" onClick={() => {
            void copyQuickCopy({ kind: 'note', record: { ...note, title, body_markdown: bodyMarkdown } })
              .then(() => setCopyStatus('Copied'))
              .catch((err) => setCopyStatus(err instanceof Error ? err.message : 'Copy failed'));
          }}>Quick Copy</button>

          <button
            className="outline-button"
            style={{ fontSize: '10.5px', padding: '3px 8px' }}
            onClick={handleOpenSplit}
            title="Split selected passage or entire note into an atomic concept note (FR-10.6)"
          >
            ✂ Split Note
          </button>

          <button
            className="outline-button"
            style={{ fontSize: '10.5px', padding: '3px 8px' }}
            onClick={() => setEditorMode(previewMode ? 'edit' : 'read')}
          >
            {previewMode ? 'Edit Markdown' : 'Preview'}
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
          {onRestoreNote && note.deleted_at && (
            <button
              className="button compact primary"
              style={{ fontSize: '10.5px', padding: '3px 8px' }}
              onClick={() => onRestoreNote(note.id)}
            >
              Restore
            </button>
          )}
          {onPurgeNote && note.deleted_at && (
            <button
              className="button compact"
              style={{ fontSize: '10.5px', padding: '3px 8px', color: '#ae1800' }}
              onClick={() => onPurgeNote(note.id)}
            >
              Delete Permanently
            </button>
          )}
        </div>
      </div>
      <div className="note-context-summary" aria-live="polite">
        <span><b>Prompts from this note</b> · {promptCount}</span>
        {copyStatus && <span>{copyStatus}</span>}
      </div>

      {/* Revisions History Drawer */}
      {showRevisions && (
        <div style={{ background: '#eae9e9', border: '1px solid rgba(32,30,29,.3)', padding: '12px', marginBottom: '14px', borderRadius: '2px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <strong style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Local Revision History (Max 20 Bounded)
            </strong>
            <button className="icon-button" style={{ fontSize: '12px' }} onClick={() => setShowRevisions(false)}><Icon name="x" /></button>
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
                        disabled={saveStatus === 'saving' || saveStatus === 'dirty' || autosaveRef.current.hasInFlight(note.id)}
                        title={
                          saveStatus === 'saving' || autosaveRef.current.hasInFlight(note.id)
                            ? 'Saving in progress...'
                            : saveStatus === 'dirty'
                            ? 'Wait for changes to save before restoring'
                            : undefined
                        }
                        onClick={async () => {
                          if (saveStatus === 'saving' || saveStatus === 'dirty' || autosaveRef.current.hasInFlight(note.id)) return;
                          autosaveRef.current.cancel(note.id);
                          await autosaveRef.current.waitForInFlight(note.id);
                          await onRestoreRevision(note.id, rev.revision_number);
                        }}
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


      {!previewMode && <div className="markdown-toolbar" role="toolbar" aria-label="Markdown formatting">
        <button onClick={() => wrapSelection('## ', '', 'Heading')}>Heading</button>
        <span />
        <button aria-label="Bold" onClick={() => wrapSelection('**')}>B</button>
        <button aria-label="Italic" onClick={() => wrapSelection('_')}>I</button>
        <button aria-label="Inline code" onClick={() => wrapSelection('`')}>{'</>'}</button>
        <button aria-label="Link" onClick={() => wrapSelection('[', '](https://)', 'label')}>Link</button>
        <span />
        <button aria-label="Bulleted list" onClick={() => wrapSelection('- ', '', 'List item')}>• List</button>
        <button aria-label="Numbered list" onClick={() => wrapSelection('1. ', '', 'List item')}>1. List</button>
        <button aria-label="Quote" onClick={() => wrapSelection('> ', '', 'Quote')}>Quote</button>
      </div>}

      {/* Markdown Body Editor or Rendered View */}
      {previewMode ? (
        <div
          className="note-markdown-rendered"
          onClick={handlePreviewClick}
          style={{
            padding: '12px',
            background: '#eae9e9',
            border: '1px solid rgba(32,30,29,.2)',
            minHeight: '200px',
            fontFamily: 'inherit',
            lineHeight: 1.6,
          }}
          dangerouslySetInnerHTML={{
            __html: renderedMarkdown || '<em style="color: #605d5d">Empty note body.</em>',
          }}
        />
      ) : (
        <div className="markdown-editor-shell">
          <textarea
            ref={textareaRef}
            value={bodyMarkdown}
            onChange={handleBodyChange}
            onKeyDown={handleEditorKeyDown}
            onScroll={(event) => {
              if (!wikiQuery) return;
              const textarea = event.currentTarget;
              const anchor = getTextareaCaretPosition(textarea, textarea.selectionStart);
              setWikiQuery((current) => current ? { ...current, ...anchor } : null);
            }}
            onBlur={handleBlur}
            placeholder="Write in Markdown. Type [[ to link another note."
            aria-autocomplete="list"
            aria-controls={wikiQuery ? 'wiki-link-suggestions' : undefined}
            aria-expanded={Boolean(wikiQuery)}
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
          {wikiQuery && (
            <div
              id="wiki-link-suggestions"
              className="wiki-link-suggestions"
              role="listbox"
              aria-label="Notes and annotations to link"
              style={{ top: wikiQuery.top, left: wikiQuery.left }}
            >
              <header>
                <b>Link knowledge</b>
                <span>↑↓ choose · Tab insert</span>
              </header>
              {wikiSuggestions.length > 0 ? (
                wikiSuggestions.map((candidate, index) => (
                  <button
                    key={`${candidate.kind}:${candidate.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === wikiQuery.activeIndex}
                    className={index === wikiQuery.activeIndex ? 'active' : ''}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertWikiLink(candidate)}
                  >
                    <span>{candidate.label}</span>
                    <small>{candidate.meta}</small>
                  </button>
                ))
              ) : (
                <p>No notes or annotations match “{wikiQuery.query}”.</p>
              )}
            </div>
          )}
        </div>
      )}
      <div className="note-word-count"><span>{bodyMarkdown.length.toLocaleString()} characters</span><span>{wordCount.toLocaleString()} words</span></div>

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
                onRemember={(b) => onRememberEvidence && onRememberEvidence(b)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Backlinks & Linked Mentions Panel (FR-10.5) */}
      <section style={{ marginTop: '20px', paddingTop: '16px', borderTop: '2px solid rgba(32,30,29,.2)' }}>
        <BacklinksPanel
          backlinks={backlinks}
          onOpenNote={(noteId) => onOpenNote && onOpenNote(noteId)}
        />
      </section>

      {/* Split Note Modal (FR-10.6) */}
      <SplitNoteModal
        isOpen={splitModalOpen}
        onClose={() => setSplitModalOpen(false)}
        originalNote={note}
        selectedText={selectedTextForSplit}
        onConfirmSplit={handleConfirmSplit}
      />
    </article>
  );
});

NoteEditor.displayName = 'NoteEditor';
