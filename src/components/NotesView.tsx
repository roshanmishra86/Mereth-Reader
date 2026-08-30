import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { NoteRecord, NoteRevisionRecord, NoteType, createDefaultNoteRecord } from '../utils/notesTypes';
import type { EvidenceBlockRecord } from '../utils/evidenceTypes';
import {
  listNotes,
  createNote,
  updateNote,
  trashNote,
  getNoteRevisions,
  restoreNoteRevision,
  promoteScratchNote,
  splitNoteTransaction,
} from '../utils/notesIo';
import {
  getNoteEvidenceBlocks,
  updateEvidenceBlockOrder,
  updateEvidenceBlockComment,
  deleteEvidenceBlock,
} from '../utils/evidenceIo';
import type { BacklinkRecord } from '../utils/noteLinks';
import { getNoteBacklinks } from '../utils/noteLinks';
import type { TextRole, NoteSearchResult } from '../utils/noteSearch';
import { searchNotes, roleLabel, roleBadgeClass, filterSearchResultsByRole } from '../utils/noteSearch';
import type { SplitNoteResult } from '../utils/noteSplit';
import { getDefaultTemplate, renderTemplate } from '../utils/noteTemplates';
import { PromptEditorModal } from './PromptEditorModal';
import { NoteEditor } from './NoteEditor';
import { EmptyState } from './EmptyState';

export interface NotesViewProps {
  initialSelectedNoteId?: string | null;
  onNavigateToSource?: (block: EvidenceBlockRecord) => void;
}

export const NotesView: React.FC<NotesViewProps> = ({
  initialSelectedNoteId,
  onNavigateToSource,
}) => {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(initialSelectedNoteId ?? null);
  const [revisions, setRevisions] = useState<NoteRevisionRecord[]>([]);
  const [evidenceBlocks, setEvidenceBlocks] = useState<EvidenceBlockRecord[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NoteSearchResult[]>([]);
  const [selectedRoleFilters, setSelectedRoleFilters] = useState<TextRole[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'concept' | 'source' | 'scratch' | 'trash'>('all');
  const [isLoading, setIsLoading] = useState(true);

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
      const rows = await listNotes({
        includeTrash: isTrash,
        noteType: noteTypeFilter,
      });
      setNotes(rows);

      // Maintain or select active note
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

  // Handle full-text search with role identification (FR-10.9)
  useEffect(() => {
    let isCancelled = false;
    async function runSearch() {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }
      try {
        const noteTypeFilter = (selectedFilter === 'all' || selectedFilter === 'trash') ? undefined : selectedFilter;
        const res = await searchNotes(searchQuery, noteTypeFilter);
        if (!isCancelled) {
          setSearchResults(res);
        }
      } catch (err) {
        console.error('Search failed:', err);
      }
    }
    const timer = setTimeout(() => {
      void runSearch();
    }, 150);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, selectedFilter]);

  // Load revisions, evidence blocks, and backlinks whenever active note changes
  useEffect(() => {
    if (!activeNoteId) {
      setRevisions([]);
      setEvidenceBlocks([]);
      setBacklinks([]);
      return;
    }
    let isCancelled = false;
    async function loadDetails() {
      try {
        const [revs, blocks, links] = await Promise.all([
          getNoteRevisions(activeNoteId!),
          getNoteEvidenceBlocks(activeNoteId!),
          getNoteBacklinks(activeNoteId!),
        ]);
        if (!isCancelled) {
          setRevisions(revs);
          setEvidenceBlocks(blocks);
          setBacklinks(links);
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

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) => n.title.toLowerCase().includes(q) || n.body_markdown.toLowerCase().includes(q)
      );
    }
    return result;
  }, [notes, selectedFilter, searchQuery]);

  const activeNote = useMemo(() => {
    return notes.find((n) => n.id === activeNoteId) || null;
  }, [notes, activeNoteId]);

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
      setActiveNoteId(created.id);
    } catch (err) {
      console.error('Failed to create note:', err);
    }
  };

  const handleSaveNote = async (id: string, title: string, bodyMarkdown: string) => {
    try {
      const updated = await updateNote(id, title, bodyMarkdown, true);
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      const revs = await getNoteRevisions(id);
      setRevisions(revs);
    } catch (err) {
      console.error('Failed to update note:', err);
      throw err;
    }
  };

  const handlePromoteScratch = async (id: string, targetType: 'concept' | 'source') => {
    try {
      const promoted = await promoteScratchNote(id, targetType);
      setNotes((prev) => prev.map((n) => (n.id === id ? promoted : n)));
      const revs = await getNoteRevisions(id);
      setRevisions(revs);
    } catch (err) {
      console.error('Failed to promote scratch note:', err);
    }
  };

  const handleTrashNote = async (id: string) => {
    try {
      await trashNote(id);
      await fetchNotes();
    } catch (err) {
      console.error('Failed to trash note:', err);
    }
  };

  const handleRestoreRevision = async (noteId: string, revisionNumber: number) => {
    try {
      const restored = await restoreNoteRevision(noteId, revisionNumber);
      setNotes((prev) => prev.map((n) => (n.id === noteId ? restored : n)));
      const revs = await getNoteRevisions(noteId);
      setRevisions(revs);
    } catch (err) {
      console.error('Failed to restore revision:', err);
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

  const displayedSearchResults = useMemo(() => {
    return filterSearchResultsByRole(searchResults, selectedRoleFilters);
  }, [searchResults, selectedRoleFilters]);

  const toggleRoleFilter = (role: TextRole) => {
    setSelectedRoleFilters((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  return (
    <section className="destination-view" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top Destination Header */}
      <div className="view-header" style={{ marginBottom: '12px' }}>
        <div>
          <span className="eyebrow">{notes.length} notes · all local</span>
          <h1>Notes</h1>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="button primary compact" onClick={() => handleCreateNote('concept')}>
            + Concept Note
          </button>
          <button className="button compact" onClick={() => handleCreateNote('source')}>
            + Source Note
          </button>
          <button className="button compact" onClick={() => handleCreateNote('scratch')}>
            + Scratchpad
          </button>
        </div>
      </div>

      <div className="destination-rule" />

      {/* Two Column Notes Layout */}
      <div className="notes-layout" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)' }}>
        {/* Left Sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', borderRight: '1px solid rgba(32,30,29,.3)', overflowY: 'auto' }}>
          {/* Search input */}
          <input
            type="text"
            placeholder="Search titles, prose, quotes, comments, tags (FR-10.9)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', fontSize: '11.5px', background: '#eae9e9', border: '1px solid rgba(32,30,29,.4)' }}
          />

          {/* Role Filter Chips (when search query active) */}
          {searchQuery.trim().length > 0 ? (
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
          ) : (
            /* Filter Tabs */
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', margin: '4px 0 8px' }}>
              {(['all', 'concept', 'source', 'scratch', 'trash'] as const).map((filter) => (
                <button
                  key={filter}
                  className={`button micro ${selectedFilter === filter ? 'primary' : ''}`}
                  style={{ textTransform: 'capitalize' }}
                  onClick={() => setSelectedFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>
          )}

          {/* Notes or Search Results List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto', flex: 1 }}>
            {isLoading ? (
              <div style={{ fontSize: '11px', color: '#605d5d', padding: '8px' }}>Loading notes...</div>
            ) : searchQuery.trim().length > 0 ? (
              displayedSearchResults.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#605d5d', padding: '8px' }}>No matches for &ldquo;{searchQuery}&rdquo;.</div>
              ) : (
                displayedSearchResults.map((r, idx) => {
                  const isActive = r.note_id === activeNoteId;
                  return (
                    <button
                      key={`${r.note_id}-${r.text_role}-${idx}`}
                      className={`note-card ${isActive ? 'note-list-active' : ''}`}
                      onClick={() => setActiveNoteId(r.note_id)}
                      style={{
                        padding: '8px 10px',
                        border: 0,
                        borderLeft: isActive ? '3px solid #ec3013' : '3px solid transparent',
                        background: isActive ? '#eae9e9' : 'transparent',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                        <span className="eyebrow" style={{ fontSize: '8px', margin: 0, color: '#ec3013' }}>
                          {roleLabel(r.text_role)}
                        </span>
                        <small style={{ fontSize: '8.5px', color: '#605d5d' }}>
                          {r.note_type}
                        </small>
                      </div>
                      <strong style={{ display: 'block', fontSize: '11.5px', color: '#201e1d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.note_title}
                      </strong>
                      <small style={{ display: 'block', fontSize: '10px', color: '#444141', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.snippet}
                      </small>
                    </button>
                  );
                })
              )
            ) : filteredNotes.length === 0 ? (
              <div style={{ fontSize: '11px', color: '#605d5d', padding: '8px' }}>No notes found.</div>
            ) : (
              filteredNotes.map((n) => {
                const isActive = n.id === activeNoteId;
                return (
                  <button
                    key={n.id}
                    className={`note-card ${isActive ? 'note-list-active' : ''}`}
                    onClick={() => setActiveNoteId(n.id)}
                    style={{
                      padding: '8px 10px',
                      border: 0,
                      borderLeft: isActive ? '3px solid #ec3013' : '3px solid transparent',
                      background: isActive ? '#eae9e9' : 'transparent',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                      <span className="eyebrow" style={{ fontSize: '8.5px', margin: 0 }}>
                        {n.note_type}
                      </span>
                      <small style={{ fontSize: '9.5px', color: '#605d5d' }}>
                        {new Date(n.updated_at).toLocaleDateString()}
                      </small>
                    </div>
                    <strong style={{ display: 'block', fontSize: '12px', color: '#201e1d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.title || 'Untitled Note'}
                    </strong>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Main Note Editor Pane */}
        {activeNote ? (
          <NoteEditor
            note={activeNote}
            revisions={revisions}
            evidenceBlocks={evidenceBlocks}
            backlinks={backlinks}
            onSave={handleSaveNote}
            onPromoteScratch={handlePromoteScratch}
            onTrash={handleTrashNote}
            onRestoreRevision={handleRestoreRevision}
            onUpdateEvidenceComment={handleUpdateEvidenceComment}
            onReorderEvidence={handleReorderEvidence}
            onDeleteEvidence={handleDeleteEvidence}
            onNavigateToSource={onNavigateToSource}
            onOpenNote={(id) => setActiveNoteId(id)}
            onSplitNote={handleSplitNote}
            onRememberNote={handleRememberNote}
            onRememberEvidence={handleRememberEvidence}
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
      </div>

      {/* Remember: Author Prompt Modal (FR-11.1 - FR-11.5) */}
      <PromptEditorModal
        isOpen={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        sourceContext={promptSourceContext}
      />
    </section>
  );
};
