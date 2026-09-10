import React, { useState, useEffect, useMemo, useCallback, useDeferredValue, useRef } from 'react';
import { NoteRecord, NoteType, createDefaultNoteRecord, NoteRevisionRecord } from '../utils/notesTypes';
import type { EvidenceBlockRecord } from '../utils/evidenceTypes';
import type { AnnotationRecord } from '../utils/annotationTypes';
import { loadAllAnnotations } from '../utils/annotationIo';
import { searchNotes, filterSearchResultsByRole, roleLabel, TextRole, NoteSearchResult } from '../utils/noteSearch';
import {
  listNotes,
  createNote,
  updateNote,
  trashNote,
  restoreNote,
  purgeNote,
  promoteScratchNote,
  splitNoteTransaction,
  getNoteRevisions,
  restoreNoteRevision,
} from '../utils/notesIo';
import {
  getNoteEvidenceBlocks,
  updateEvidenceBlockOrder,
  updateEvidenceBlockComment,
  deleteEvidenceBlock,
} from '../utils/evidenceIo';
import type { BacklinkRecord, NoteLinkRecord } from '../utils/noteLinks';
import { formatWikiLink, getForwardLinks, getNoteBacklinks, syncNoteLinks } from '../utils/noteLinks';
import type { SplitNoteResult } from '../utils/noteSplit';
import { getDefaultTemplate, renderTemplate } from '../utils/noteTemplates';
import { PromptEditorModal } from './PromptEditorModal';
import { NoteEditor, NoteEditorHandle } from './NoteEditor';
import { EmptyState } from './EmptyState';

export interface NotesViewProps {
  initialSelectedNoteId?: string | null;
  onNavigateToSource?: (block: EvidenceBlockRecord) => void;
  onNavigateToAnnotation?: (annotation: AnnotationRecord) => void;
}

export const NotesView: React.FC<NotesViewProps> = ({
  initialSelectedNoteId,
  onNavigateToSource,
  onNavigateToAnnotation,
}) => {
  const editorRef = useRef<NoteEditorHandle>(null);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [linkableNotes, setLinkableNotes] = useState<NoteRecord[]>([]);
  const [linkableAnnotations, setLinkableAnnotations] = useState<AnnotationRecord[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(initialSelectedNoteId ?? null);
  const [revisions, setRevisions] = useState<NoteRevisionRecord[]>([]);
  const [evidenceBlocks, setEvidenceBlocks] = useState<EvidenceBlockRecord[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([]);
  const [forwardLinks, setForwardLinks] = useState<NoteLinkRecord[]>([]);
  const [relatedNoteId, setRelatedNoteId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [searchResults, setSearchResults] = useState<NoteSearchResult[]>([]);
  const [selectedRoleFilters, setSelectedRoleFilters] = useState<TextRole[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'concept' | 'source' | 'scratch' | 'trash'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'read' | 'edit'>('read');
  const [showDetailsSidebar, setShowDetailsSidebar] = useState(false);
  const [isSourcesCollapsed, setIsSourcesCollapsed] = useState(false);
  const [editingCommentBlockId, setEditingCommentBlockId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [promptSourceContext, setPromptSourceContext] = useState<{
    title: string;
    quote?: string | null;
    annotationId?: string | null;
    noteId?: string | null;
  } | undefined>(undefined);

  const handleRememberNote = (n: NoteRecord) => {
    setPromptSourceContext({
      title: n.title || 'Note',
      quote: n.body_markdown.slice(0, 300),
      noteId: n.id,
    });
    setPromptModalOpen(true);
  };

  const handleRememberEvidence = (block: EvidenceBlockRecord) => {
    setPromptSourceContext({
      title: `Evidence p.${block.page_label}`,
      quote: block.quote,
      annotationId: block.annotation_id,
      noteId: block.note_id,
    });
    setPromptModalOpen(true);
  };

  const fetchNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      const isTrash = selectedFilter === 'trash';
      const noteTypeFilter = (selectedFilter === 'all' || isTrash) ? undefined : (selectedFilter as NoteType);
      const [rawRows, allActiveNotes] = await Promise.all([
        listNotes({ includeTrash: isTrash, noteType: noteTypeFilter }),
        selectedFilter === 'all' && !isTrash ? Promise.resolve(null) : listNotes({ includeTrash: false }),
      ]);
      const rows = isTrash ? rawRows.filter((n) => n.deleted_at !== null) : rawRows.filter((n) => n.deleted_at === null);
      setNotes(rows);
      setLinkableNotes(allActiveNotes ?? rawRows.filter((note) => !note.deleted_at));

      // Maintain or select active note from the current filter's rows
      if (rows.length > 0) {
        if (!activeNoteId || !rows.some((n) => n.id === activeNoteId)) {
          setActiveNoteId(initialSelectedNoteId && rows.some(r => r.id === initialSelectedNoteId) ? initialSelectedNoteId : rows[0].id);
        }
      } else {
        setActiveNoteId(null);
      }
    } catch (err) {
      console.error('Failed to list notes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFilter, activeNoteId, initialSelectedNoteId]);

  useEffect(() => {
    void fetchNotes();
  }, [selectedFilter]);

  // Synchronize initialSelectedNoteId prop reactively when changed by external route or deep link
  useEffect(() => {
    if (initialSelectedNoteId && initialSelectedNoteId !== activeNoteId) {
      setSelectedFilter('all');
      setActiveNoteId(initialSelectedNoteId);
    }
  }, [initialSelectedNoteId]);

  useEffect(() => {
    if (!activeNoteId) return;
    let cancelled = false;
    void loadAllAnnotations()
      .then((annotations) => { if (!cancelled) setLinkableAnnotations(annotations); })
      .catch((error) => console.error('Failed to load linkable annotations:', error));
    return () => { cancelled = true; };
  }, [activeNoteId]);

  // Load source evidence and both link directions whenever the active note changes.
  useEffect(() => {
    if (!activeNoteId) {
      setRevisions([]);
      setEvidenceBlocks([]);
      setBacklinks([]);
      setForwardLinks([]);
      return;
    }
    let isCancelled = false;
    async function loadDetails() {
      try {
        const [blocks, incomingLinks, outgoingLinks, revs] = await Promise.all([
          getNoteEvidenceBlocks(activeNoteId!),
          getNoteBacklinks(activeNoteId!),
          getForwardLinks(activeNoteId!),
          getNoteRevisions(activeNoteId!),
        ]);
        if (!isCancelled) {
          setEvidenceBlocks(blocks);
          setBacklinks(incomingLinks);
          setForwardLinks(outgoingLinks);
          setRevisions(revs);
        }
      } catch (err) {
        console.error('Failed to load note details:', err);
      }
    }
    void loadDetails();
    return () => {
      isCancelled = true;
    };
  }, [activeNoteId]);

  useEffect(() => {
    let isCancelled = false;
    if (selectedFilter === 'trash') {
      setSearchResults([]);
      return;
    }
    if (deferredSearchQuery.trim()) {
      searchNotes(deferredSearchQuery, selectedFilter !== 'all' ? selectedFilter : undefined)
        .then(results => { if (!isCancelled) setSearchResults(results); })
        .catch(err => console.error('Failed to search notes:', err));
    } else {
      setSearchResults([]);
    }
    return () => { isCancelled = true; };
  }, [deferredSearchQuery, selectedFilter]);

  const filteredNotes = useMemo(() => {
    let result = notes;
    if (selectedFilter === 'trash') {
      result = result.filter((n) => n.deleted_at !== null);
    } else {
      result = result.filter((n) => n.deleted_at === null);
      if (selectedFilter !== 'all') {
        result = result.filter((n) => n.note_type === selectedFilter);
      }
    }
    return result;
  }, [notes, selectedFilter]);

  const activeNote = useMemo(() => {
    return filteredNotes.find((n) => n.id === activeNoteId) || null;
  }, [filteredNotes, activeNoteId]);

  const handleCreateNote = async (type: NoteType) => {
    const templateBody = getDefaultTemplate(type);
    const renderedBody = renderTemplate(templateBody, {
      title: type === 'concept' ? 'New Concept Claim' : type === 'source' ? 'Source Note' : 'Quick Scratchpad',
      tags_json: [],
      citation_formatted: 'Source document',
      mereth_document_url: '',
      evidence_blocks: '',
    });

    const newNote = createDefaultNoteRecord({
      note_type: type,
      title: type === 'concept' ? 'New Concept Claim' : type === 'source' ? 'Source Note' : 'Quick Scratchpad',
      body_markdown: renderedBody,
    });

    try {
      const created = await createNote(newNote);
      setNotes((prev) => [created, ...prev]);
      setLinkableNotes((prev) => [created, ...prev]);
      setActiveNoteId(created.id);
      setViewMode('edit');
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  };

  const handleSaveNote = async (id: string, title: string, bodyMarkdown: string) => {
    try {
      const updated = await updateNote(id, title, bodyMarkdown, true);
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      setLinkableNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
    } catch (err) {
      console.error('Failed to update note:', err);
      throw err;
    }
  };

  const handlePromoteScratch = async (id: string, targetType: 'concept' | 'source') => {
    try {
      const promoted = await promoteScratchNote(id, targetType);
      setNotes((prev) => prev.map((n) => (n.id === id ? promoted : n)));
      setLinkableNotes((prev) => prev.map((n) => (n.id === id ? promoted : n)));
    } catch (err) {
      console.error('Failed to promote scratch note:', err);
    }
  };

  const handleTrashNote = async (id: string) => {
    try {
      await trashNote(id);
      setLinkableNotes((current) => current.filter((note) => note.id !== id));
      await fetchNotes();
    } catch (err) {
      console.error('Failed to trash note:', err);
    }
  };

  const handleRestoreNote = async (id: string) => {
    try {
      await restoreNote(id);
      await fetchNotes();
    } catch (err) {
      console.error('Failed to restore note from trash:', err);
    }
  };

  const handlePurgeNote = async (id: string) => {
    try {
      await purgeNote(id);
      setActiveNoteId(null);
      await fetchNotes();
    } catch (err) {
      console.error('Failed to permanently delete note:', err);
    }
  };

  const handleUpdateEvidenceComment = async (blockId: string, comment: string) => {
    try {
      await updateEvidenceBlockComment(blockId, comment);
      setEvidenceBlocks((prev) =>
        prev.map((b) => (b.id === blockId ? { ...b, user_comment: comment } : b))
      );
    } catch (err) {
      console.error('Failed to update evidence comment:', err);
    }
  };

  const handleReorderEvidence = async (noteId: string, blockIds: string[]) => {
    try {
      await updateEvidenceBlockOrder(noteId, blockIds);
      const reordered = await getNoteEvidenceBlocks(noteId);
      setEvidenceBlocks(reordered);
    } catch (err) {
      console.error('Failed to reorder evidence blocks:', err);
    }
  };

  const handleDeleteEvidence = async (blockId: string) => {
    try {
      await deleteEvidenceBlock(blockId);
      setEvidenceBlocks((prev) => prev.filter((b) => b.id !== blockId));
    } catch (err) {
      console.error('Failed to delete evidence block:', err);
    }
  };

  const refreshActiveLinks = useCallback(async () => {
    if (!activeNoteId) return;
    const [incoming, outgoing] = await Promise.all([
      getNoteBacklinks(activeNoteId),
      getForwardLinks(activeNoteId),
    ]);
    setBacklinks(incoming);
    setForwardLinks(outgoing);
  }, [activeNoteId]);

  const handleSplitNote = async (result: SplitNoteResult) => {
    try {
      const split = await splitNoteTransaction({
        originalId: result.updatedOriginalNote.id,
        originalTitle: result.updatedOriginalNote.title,
        originalBody: result.updatedOriginalNote.body_markdown,
        newNote: result.newConceptNote,
        link: result.forwardLink,
      });
      setNotes((prev) => [
        split.new_note,
        ...prev.map((n) => (n.id === split.original_note.id ? split.original_note : n)),
      ]);
      setActiveNoteId(split.new_note.id);
    } catch (err) {
      console.error('Failed to apply note split:', err);
    }
  };

  const handleLinkRelatedNote = async () => {
    if (!activeNote || !relatedNoteId || relatedNoteId === activeNote.id) return;
    const target = linkableNotes.find((note) => note.id === relatedNoteId);
    if (!target) return;

    if (editorRef.current) {
      await editorRef.current.addRelatedLink(target.id, target.title || 'Untitled note');
      setRelatedNoteId('');
      setForwardLinks(await getForwardLinks(activeNote.id));
      return;
    }

    const wikiLink = formatWikiLink('note', target.id, target.title || 'Untitled note');
    const hasRelationship = activeNote.body_markdown.includes(`mereth:note/${target.id}`);
    if (hasRelationship) {
      setRelatedNoteId('');
      return;
    }
    const hasRelatedSection = /^## Related notes\s*$/im.test(activeNote.body_markdown);
    const separator = activeNote.body_markdown.trim() ? '\n\n' : '';
    const nextBody = hasRelatedSection
      ? `${activeNote.body_markdown.trimEnd()}\n- ${wikiLink}`
      : `${activeNote.body_markdown}${separator}## Related notes\n\n- ${wikiLink}`;
    const parsedTargets = [
      ...forwardLinks.flatMap((link) => link.target_note_id ? [link.target_note_id] : []),
      target.id,
    ];
    try {
      const updated = await updateNote(activeNote.id, activeNote.title, nextBody, true);
      await syncNoteLinks(activeNote.id, {
        noteIds: Array.from(new Set(parsedTargets)),
        docIds: forwardLinks.flatMap((link) => link.target_document_id ? [link.target_document_id] : []),
        annIds: forwardLinks.flatMap((link) => link.target_annotation_id ? [link.target_annotation_id] : []),
      });
      setNotes((current) => current.map((note) => note.id === updated.id ? updated : note));
      setLinkableNotes((current) => current.map((note) => note.id === updated.id ? updated : note));
      setForwardLinks(await getForwardLinks(activeNote.id));
      setRelatedNoteId('');
    } catch (error) {
      console.error('Failed to link related note:', error);
    }
  };

  const noteById = useMemo(() => new Map(linkableNotes.map((note) => [note.id, note])), [linkableNotes]);
  const availableRelatedNotes = useMemo(() => {
    const linkedIds = new Set(forwardLinks.flatMap((link) => link.target_note_id ? [link.target_note_id] : []));
    return linkableNotes.filter((note) => !note.deleted_at && note.id !== activeNoteId && !linkedIds.has(note.id));
  }, [activeNoteId, forwardLinks, linkableNotes]);

  const openLinkedNote = (noteId: string) => {
    if (linkableNotes.length > 0 && !linkableNotes.some((note) => note.id === noteId && !note.deleted_at)) return;
    setSelectedFilter('all');
    setActiveNoteId(noteId);
    setViewMode('read');
  };

  const handleOpenAnnotation = useCallback(async (annotation: AnnotationRecord) => {
    if (annotation.document_id) {
      onNavigateToAnnotation?.(annotation);
      return;
    }
    try {
      const all = await loadAllAnnotations();
      const match = all.find((a) => a.id === annotation.id);
      if (match) {
        setLinkableAnnotations(all);
        onNavigateToAnnotation?.(match);
      }
    } catch (err) {
      console.error('Failed to resolve annotation link:', err);
    }
  }, [onNavigateToAnnotation]);

  const handleRestoreRevision = async (noteId: string, revisionNumber: number) => {
    try {
      const restored = await restoreNoteRevision(noteId, revisionNumber);
      setNotes((prev) => prev.map((n) => (n.id === restored.id ? restored : n)));
      setLinkableNotes((prev) => prev.map((n) => (n.id === restored.id ? restored : n)));
      const revs = await getNoteRevisions(noteId);
      setRevisions(revs);
      await fetchNotes();
    } catch (err) {
      console.error('Failed to restore revision:', err);
    }
  };

  const displayedSearchResults = useMemo(() => {
    return filterSearchResultsByRole(searchResults, selectedRoleFilters);
  }, [searchResults, selectedRoleFilters]);

  const toggleRoleFilter = (role: TextRole) => {
    setSelectedRoleFilters((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const sidebarCounts = useMemo(() => {
    const active = linkableNotes.filter((n) => !n.deleted_at);
    return {
      all: active.length,
      concept: active.filter((n) => n.note_type === 'concept').length,
      source: active.filter((n) => n.note_type === 'source').length,
      scratch: active.filter((n) => n.note_type === 'scratch').length,
    };
  }, [linkableNotes]);

  return (
    <section className={`knowledge-workspace${showDetailsSidebar ? ' show-details' : ''}`}>
      <aside className="knowledge-navigation">
        <div className="knowledge-nav-block">
          <h3>Knowledge</h3>
          <button className={selectedFilter === 'all' ? 'active' : ''} onClick={() => setSelectedFilter('all')}><span>Overview</span></button>
          <button onClick={() => setSelectedFilter('all')}><span>All Knowledge Notes</span><small>{sidebarCounts.all}</small></button>
          <button className={selectedFilter === 'concept' ? 'active' : ''} onClick={() => setSelectedFilter('concept')}><span>My Concepts</span><small>{sidebarCounts.concept}</small></button>
          <button className={selectedFilter === 'source' ? 'active' : ''} onClick={() => setSelectedFilter('source')}><span>Source Notes</span><small>{sidebarCounts.source}</small></button>
          <button className={selectedFilter === 'scratch' ? 'active' : ''} onClick={() => setSelectedFilter('scratch')}><span>Scratchpads</span><small>{sidebarCounts.scratch}</small></button>
          <button className={selectedFilter === 'trash' ? 'active' : ''} onClick={() => { setSelectedFilter('trash'); setSearchQuery(''); }}><span>Trash</span></button>
        </div>
        <div className="knowledge-nav-block grow">
          <div className="nav-section-title"><h3>Recently edited</h3></div>
          {selectedFilter === 'trash' && (
            <p className="knowledge-trash-policy" role="note">
              Notes in Trash are permanently deleted after 30 days.
            </p>
          )}
          <label className="knowledge-search"><span>Search</span><input value={selectedFilter === 'trash' ? '' : searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={selectedFilter === 'trash' ? 'Search is unavailable in Trash' : 'Knowledge notes...'} disabled={selectedFilter === 'trash'} /></label>

          {selectedFilter !== 'trash' && searchQuery.trim().length > 0 && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', margin: '2px 0 6px' }}>
              {(['title', 'prose', 'evidence_quote', 'evidence_comment', 'tag'] as const).map((role) => {
                const isSelected = selectedRoleFilters.includes(role);
                return (
                  <button
                    key={role}
                    className={`button micro ${isSelected ? 'primary' : ''}`}
                    style={{ fontSize: '9px', padding: '1px 5px' }}
                    onClick={() => toggleRoleFilter(role)}
                  >
                    {roleLabel(role)}
                  </button>
                );
              })}
            </div>
          )}

          <div className="knowledge-note-list">
            {isLoading ? <p>Loading notes…</p> :
             selectedFilter !== 'trash' && searchQuery.trim().length > 0 ? (
               displayedSearchResults.length === 0 ? (
                 <p style={{ fontSize: '11px', color: '#605d5d', padding: '8px' }}>No matches found.</p>
               ) : (
                 displayedSearchResults.map((r, idx) => (
                   <button
                     key={`${r.note_id}-${r.text_role}-${idx}`}
                     className={r.note_id === activeNoteId ? 'active note-row' : 'note-row'}
                     onClick={() => { setActiveNoteId(r.note_id); setViewMode('read'); }}
                   >
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <span style={{ fontSize: '9px', color: '#ec3013' }}>{roleLabel(r.text_role)}</span>
                       <small>{r.note_type}</small>
                     </div>
                     <b>{r.note_title}</b>
                     <small>{r.snippet}</small>
                   </button>
                 ))
               )
             ) : filteredNotes.length === 0 ? (
               <p style={{ fontSize: '11px', color: '#605d5d', padding: '8px' }}>No notes found.</p>
             ) : (
               filteredNotes.map((n) => <button key={n.id} className={n.id === activeNoteId ? 'active note-row' : 'note-row'} onClick={() => { setActiveNoteId(n.id); setViewMode('read'); }}><b>{n.title || 'Untitled note'}</b><small>{new Date(n.updated_at).toLocaleDateString()}</small></button>)
             )
            }
          </div>
        </div>
        <div className="knowledge-storage"><span>Local storage</span><small>All notes on this device</small><i /></div>
      </aside>

      <main className="knowledge-document">
        <header className="knowledge-document-bar">
          <div><b>Knowledge</b><span>{viewMode === 'read' ? 'Your connected ideas' : 'Edit note'}</span></div>
          <div className="knowledge-create-actions">
            {activeNote && (
              <button
                type="button"
                className="button compact knowledge-details-toggle"
                onClick={() => setShowDetailsSidebar((prev) => !prev)}
                aria-label="Toggle note details sidebar"
                aria-expanded={showDetailsSidebar}
              >
                {showDetailsSidebar ? 'Hide details' : 'Note details'}
              </button>
            )}
            {activeNote && <button className="button compact" onClick={() => setViewMode(viewMode === 'read' ? 'edit' : 'read')}>{viewMode === 'read' ? 'Edit' : 'Read'}</button>}
            <button className="button primary compact" onClick={() => handleCreateNote('concept')}>+ New note</button>
            <button className="button compact" onClick={() => handleCreateNote('scratch')}>Scratchpad</button>
          </div>
        </header>
        {activeNote ? (
          <NoteEditor
            ref={editorRef}
            note={activeNote}
            revisions={revisions}
            onRestoreRevision={handleRestoreRevision}
            evidenceBlocks={evidenceBlocks}
            backlinks={backlinks}
            onSave={handleSaveNote}
            onPromoteScratch={handlePromoteScratch}
            onTrash={handleTrashNote}
            onRestoreNote={handleRestoreNote}
            onPurgeNote={handlePurgeNote}
            onUpdateEvidenceComment={handleUpdateEvidenceComment}
            onReorderEvidence={handleReorderEvidence}
            onDeleteEvidence={handleDeleteEvidence}
            onNavigateToSource={onNavigateToSource}
            onSplitNote={handleSplitNote}
            onRememberNote={handleRememberNote}
            onRememberEvidence={handleRememberEvidence}
            mode={viewMode}
            onModeChange={setViewMode}
            onLinksChanged={refreshActiveLinks}
            linkableNotes={linkableNotes}
            linkableAnnotations={linkableAnnotations}
            onOpenNote={openLinkedNote}
            onOpenAnnotation={handleOpenAnnotation}
          />
        ) : (
          <EmptyState
            viewType="notes"
            customTitle="No note selected"
            customDescription="Select a note from the list, or create one with the template buttons above."
            onPrimaryAction={() => handleCreateNote('scratch')}
            onSecondaryAction={() => handleCreateNote('concept')}
          />
        )}
      </main>

      <aside className="knowledge-details">
        <header><b>Note details</b></header>
        {activeNote ? <>
          <section><h3>Spaced repetition</h3><div className="review-state-card"><b>Ready when you are</b><p>{activeNote.note_type === 'concept' ? 'Create or manage review prompts for this knowledge note.' : 'Promote this note to a concept before scheduling review.'}</p><button className="button compact" onClick={() => handleRememberNote(activeNote)}>Add to Review</button></div></section>
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '9px' }}>
              <h3 style={{ margin: 0 }}>
                Sources <span>({evidenceBlocks.length})</span>
              </h3>
              {evidenceBlocks.length > 0 && (
                <button
                  type="button"
                  className="button compact"
                  style={{ fontSize: '9px', padding: '1px 6px' }}
                  onClick={() => setIsSourcesCollapsed((prev) => !prev)}
                  aria-expanded={!isSourcesCollapsed}
                  aria-controls="knowledge-source-list"
                >
                  {isSourcesCollapsed ? 'Expand' : 'Collapse'}
                </button>
              )}
            </div>
            {!isSourcesCollapsed && (
              <div id="knowledge-source-list" className="knowledge-source-list">
                {evidenceBlocks.map((block) => (
                  <div key={block.id} className="knowledge-source-card" data-testid={`knowledge-source-item-${block.id}`}>
                    <button
                      type="button"
                      className="knowledge-source-jump"
                      onClick={() => onNavigateToSource?.(block)}
                      title="Jump to source in document"
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%' }}>
                        <b>Linked PDF source</b>
                        <small>p. {block.page_label} ↗</small>
                      </div>
                      <q>{block.quote || 'Linked source'}</q>
                    </button>

                    {editingCommentBlockId === block.id ? (
                      <div className="knowledge-source-comment-editor" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                        <textarea
                          aria-label="Edit evidence comment"
                          value={commentDraft}
                          onChange={(e) => setCommentDraft(e.target.value)}
                          placeholder="Add a note or interpretation..."
                          rows={2}
                          style={{ width: '100%', fontSize: '10px', padding: '4px', resize: 'vertical' }}
                          autoFocus
                        />
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="button compact"
                            style={{ fontSize: '9px', padding: '1px 6px' }}
                            onClick={() => setEditingCommentBlockId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="button compact primary"
                            style={{ fontSize: '9px', padding: '1px 6px' }}
                            onClick={async () => {
                              await handleUpdateEvidenceComment(block.id, commentDraft);
                              setEditingCommentBlockId(null);
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {block.user_comment && (
                          <p className="knowledge-source-comment">{block.user_comment}</p>
                        )}
                        <div className="knowledge-source-actions">
                          <button
                            type="button"
                            className="button compact"
                            onClick={() => {
                              setEditingCommentBlockId(block.id);
                              setCommentDraft(block.user_comment || '');
                            }}
                            title={block.user_comment ? 'Edit user comment' : 'Add user comment'}
                          >
                            {block.user_comment ? 'Edit Note' : '+ Note'}
                          </button>
                          <button
                            type="button"
                            className="button compact"
                            onClick={() => handleRememberEvidence(block)}
                            title="Create review prompt from this evidence (FR-11.1)"
                          >
                            Remember
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {evidenceBlocks.length === 0 && <p>No annotations linked yet.</p>}
              </div>
            )}
          </section>
          <section className="knowledge-relationships"><h3>Related notes</h3><p className="relationship-help">Connect interpretations across sources. Link direction stays visible so you can follow an argument in either direction.</p><label><span>Link this note to</span><div><select value={relatedNoteId} onChange={(event) => setRelatedNoteId(event.target.value)}><option value="">Choose a knowledge note…</option>{availableRelatedNotes.map((note) => <option key={note.id} value={note.id}>{note.title || 'Untitled note'}</option>)}</select><button className="button compact" disabled={!relatedNoteId} onClick={() => void handleLinkRelatedNote()}>Add link</button></div></label><div className="relationship-group"><b>This note references <small>{forwardLinks.filter((link) => link.target_note_id).length}</small></b>{forwardLinks.filter((link) => link.target_note_id).map((link) => { const target = link.target_note_id ? noteById.get(link.target_note_id) : null; return target ? <button key={link.id} onClick={() => openLinkedNote(target.id)}><span>{target.title || 'Untitled note'}</span><small>Open referenced note →</small></button> : null; })}{forwardLinks.every((link) => !link.target_note_id) && <p>No note references yet.</p>}</div><div className="relationship-group"><b>Referenced by <small>{backlinks.length}</small></b>{backlinks.map((link) => <button key={link.link_id} onClick={() => openLinkedNote(link.source_note_id)}><span>{link.source_note_title || 'Untitled note'}</span><small>{link.source_note_type} note points here ←</small></button>)}{backlinks.length === 0 && <p>No other notes point here yet.</p>}</div></section>
          <section><h3>Properties</h3><dl><div><dt>Type</dt><dd>{activeNote.note_type} note</dd></div><div><dt>Created</dt><dd>{new Date(activeNote.created_at).toLocaleDateString()}</dd></div><div><dt>Updated</dt><dd>{new Date(activeNote.updated_at).toLocaleDateString()}</dd></div><div><dt>Linked notes</dt><dd>{forwardLinks.filter((link) => link.target_note_id).length + backlinks.length}</dd></div></dl></section>
          {activeNote.deleted_at ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
              <button
                className="button primary compact"
                onClick={() => handleRestoreNote(activeNote.id)}
              >
                Restore note
              </button>
              <button
                className="button compact"
                style={{ color: '#ae1800', borderColor: 'rgba(174,24,0,.3)' }}
                onClick={() => handlePurgeNote(activeNote.id)}
              >
                Permanently delete
              </button>
            </div>
          ) : (
            <button className="knowledge-delete" onClick={() => handleTrashNote(activeNote.id)}>Delete note</button>
          )}
        </> : <p className="knowledge-details-empty">Select a knowledge note to see its sources and review state.</p>}
      </aside>

      {/* Remember: Author Prompt Modal (FR-11.1 - FR-11.5) */}
      <PromptEditorModal
        isOpen={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        sourceContext={promptSourceContext}
      />
    </section>
  );
};
