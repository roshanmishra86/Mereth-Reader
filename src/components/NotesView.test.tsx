// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { NotesView } from './NotesView';
import type { NoteRecord, NoteRevisionRecord } from '../utils/notesTypes';
import type { EvidenceBlockRecord } from '../utils/evidenceTypes';
import type { BacklinkRecord, NoteLinkRecord } from '../utils/noteLinks';
import type { AnnotationRecord } from '../utils/annotationTypes';
import type { NoteSearchResult } from '../utils/noteSearch';
import type { NoteEditorHandle, NoteEditorProps } from './NoteEditor';

// Mock NoteEditor to inspect the props passed down to it
vi.mock('./NoteEditor', () => ({
  NoteEditor: React.forwardRef<NoteEditorHandle, NoteEditorProps>((props, _ref) => (
    <article className="note-reading" data-testid="mock-note-editor">
      <h2 data-testid="mock-editor-title">{props.note.title}</h2>
      <span data-testid="mock-editor-note-id">{props.note.id}</span>
      <button data-testid="mock-editor-open-note-2" onClick={() => props.onOpenNote?.('note-2')}>Open Note 2</button>
      <section data-testid="mock-editor-evidence-section">
        <h3>Attached Evidence ({(props.evidenceBlocks ?? []).length})</h3>
        {(props.evidenceBlocks ?? []).map((b) => (
          <div key={b.id} data-testid={`editor-evidence-${b.id}`}>
            <span>{b.quote}</span>
            <button onClick={() => props.onNavigateToSource?.(b)}>Jump to Source</button>
            <button onClick={() => props.onRememberEvidence?.(b)}>Remember</button>
          </div>
        ))}
      </section>
      <section data-testid="mock-editor-backlinks-section">
        <h3>Backlinks ({(props.backlinks ?? []).length})</h3>
        {(props.backlinks ?? []).map((bl) => (
          <div key={bl.link_id} data-testid={`editor-backlink-${bl.link_id}`}>
            <span>{bl.source_note_title}</span>
          </div>
        ))}
      </section>
    </article>
  )),
}));

// Mock PromptEditorModal
vi.mock('./PromptEditorModal', () => ({
  PromptEditorModal: ({
    isOpen,
    onClose,
    sourceContext,
  }: {
    isOpen: boolean;
    onClose: () => void;
    sourceContext?: {
      title: string;
      quote?: string | null;
      annotationId?: string | null;
      noteId?: string | null;
    };
  }) =>
    isOpen ? (
      <div data-testid="prompt-editor-modal">
        <span data-testid="prompt-modal-title">{sourceContext?.title}</span>
        <span data-testid="prompt-modal-quote">{sourceContext?.quote}</span>
        <span data-testid="prompt-modal-note-id">{sourceContext?.noteId}</span>
        <button onClick={onClose}>Close Prompt Modal</button>
      </div>
    ) : null,
}));

// Mock IO utilities
const mockListNotes = vi.fn<() => Promise<NoteRecord[]>>();
const mockGetNoteEvidenceBlocks = vi.fn<(noteId: string) => Promise<EvidenceBlockRecord[]>>();
const mockGetNoteBacklinks = vi.fn<(noteId: string) => Promise<BacklinkRecord[]>>();
const mockGetForwardLinks = vi.fn<(noteId: string) => Promise<NoteLinkRecord[]>>();
const mockGetNoteRevisions = vi.fn<() => Promise<NoteRevisionRecord[]>>();
const mockUpdateEvidenceBlockComment = vi.fn<(blockId: string, comment: string) => Promise<void>>();
const mockLoadAllAnnotations = vi.fn<() => Promise<AnnotationRecord[]>>();

vi.mock('../utils/notesIo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/notesIo')>();
  return {
    ...actual,
    listNotes: () => mockListNotes(),
    getNoteRevisions: () => mockGetNoteRevisions(),
  };
});

vi.mock('../utils/evidenceIo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/evidenceIo')>();
  return {
    ...actual,
    getNoteEvidenceBlocks: (noteId: string) => mockGetNoteEvidenceBlocks(noteId),
    updateEvidenceBlockComment: (blockId: string, comment: string) => mockUpdateEvidenceBlockComment(blockId, comment),
  };
});

vi.mock('../utils/noteLinks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/noteLinks')>();
  return {
    ...actual,
    getForwardLinks: (noteId: string) => mockGetForwardLinks(noteId),
    getNoteBacklinks: (noteId: string) => mockGetNoteBacklinks(noteId),
  };
});

vi.mock('../utils/annotationIo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/annotationIo')>();
  return {
    ...actual,
    loadAllAnnotations: () => mockLoadAllAnnotations(),
  };
});

vi.mock('../utils/noteSearch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/noteSearch')>();
  return {
    ...actual,
    searchNotes: vi.fn<() => Promise<NoteSearchResult[]>>().mockResolvedValue([]),
  };
});

describe('NotesView evidence & backlinks visibility', () => {
  const dummyNote: NoteRecord = {
    id: 'note-1',
    note_type: 'concept',
    title: 'Testing Active Recall',
    body_markdown: 'Active recall strengthens long-term retention.',
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    deleted_at: null,
    provenance: 'user_authored',
  };

  const dummyNote2: NoteRecord = {
    id: 'note-2',
    note_type: 'concept',
    title: 'Spaced Repetition Systems',
    body_markdown: 'Spaced repetition optimizes review intervals.',
    created_at: '2026-09-02T10:00:00Z',
    updated_at: '2026-09-02T10:00:00Z',
    deleted_at: null,
    provenance: 'user_authored',
  };

  const dummyEvidenceBlocks: EvidenceBlockRecord[] = [
    {
      id: 'eb-1',
      note_id: 'note-1',
      source_kind: 'quote',
      document_id: 'doc-1',
      page_index: 0,
      page_label: '1',
      quote: 'First evidence quote',
      color: '#ffff00',
      tags: ['study'],
      user_comment: 'Initial comment on first',
      sort_order: 0,
      created_at: '2026-09-01T12:01:00Z',
      provenance: 'user_authored',
    },
    {
      id: 'eb-2',
      note_id: 'note-1',
      source_kind: 'quote',
      document_id: 'doc-1',
      page_index: 1,
      page_label: '2',
      quote: 'Second evidence quote',
      color: '#ffff00',
      tags: ['data'],
      user_comment: '',
      sort_order: 1,
      created_at: '2026-09-01T12:02:00Z',
      provenance: 'user_authored',
    },
    {
      id: 'eb-3',
      note_id: 'note-1',
      source_kind: 'quote',
      document_id: 'doc-1',
      page_index: 2,
      page_label: '3',
      quote: 'Third evidence quote',
      color: '#ffff00',
      tags: [],
      user_comment: 'Third note comment',
      sort_order: 2,
      created_at: '2026-09-01T12:03:00Z',
      provenance: 'user_authored',
    },
    {
      id: 'eb-4',
      note_id: 'note-1',
      source_kind: 'quote',
      document_id: 'doc-1',
      page_index: 3,
      page_label: '4',
      quote: 'Fourth evidence quote',
      color: '#ffff00',
      tags: [],
      user_comment: '',
      sort_order: 3,
      created_at: '2026-09-01T12:04:00Z',
      provenance: 'user_authored',
    },
    {
      id: 'eb-5',
      note_id: 'note-1',
      source_kind: 'quote',
      document_id: 'doc-1',
      page_index: 4,
      page_label: '5',
      quote: 'Fifth evidence quote beyond cap',
      color: '#ffff00',
      tags: [],
      user_comment: 'Fifth note comment',
      sort_order: 4,
      created_at: '2026-09-01T12:05:00Z',
      provenance: 'user_authored',
    },
    {
      id: 'eb-6',
      note_id: 'note-1',
      source_kind: 'quote',
      document_id: 'doc-1',
      page_index: 5,
      page_label: '6',
      quote: 'Sixth evidence quote beyond cap',
      color: '#ffff00',
      tags: [],
      user_comment: '',
      sort_order: 5,
      created_at: '2026-09-01T12:06:00Z',
      provenance: 'user_authored',
    },
  ];

  const dummyBacklinks: BacklinkRecord[] = [
    {
      link_id: 'link-1',
      source_note_id: 'note-2',
      source_note_title: 'Spaced Repetition Systems',
      source_note_type: 'concept',
      created_at: '2026-09-02T10:00:00Z',
    },
  ];

  beforeEach(() => {
    mockListNotes.mockResolvedValue([dummyNote, dummyNote2]);
    mockGetNoteEvidenceBlocks.mockResolvedValue(dummyEvidenceBlocks);
    mockGetNoteBacklinks.mockResolvedValue(dummyBacklinks);
    mockGetForwardLinks.mockResolvedValue([]);
    mockGetNoteRevisions.mockResolvedValue([]);
    mockLoadAllAnnotations.mockResolvedValue([]);
    mockUpdateEvidenceBlockComment.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('passes all evidence blocks and backlinks to NoteEditor for in-editor visibility', async () => {
    await act(async () => {
      render(<NotesView initialSelectedNoteId="note-1" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-note-editor')).toBeTruthy();
    });

    // Verify NoteEditor receives all 6 evidence blocks and backlinks
    expect(screen.getByTestId('mock-editor-evidence-section').textContent).toContain('Attached Evidence (6)');
    expect(screen.getByTestId('mock-editor-backlinks-section').textContent).toContain('Backlinks (1)');
    expect(screen.getByTestId('editor-evidence-eb-5')).toBeTruthy();
    expect(screen.getByTestId('editor-backlink-link-1')).toBeTruthy();
  });

  it('renders all evidence blocks in sidebar without hardcoded 4-item cap', async () => {
    await act(async () => {
      render(<NotesView initialSelectedNoteId="note-1" />);
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Sources \(6\)/i })).toBeTruthy();
    });

    // Check that items 5 and 6 are listed in the sidebar
    expect(screen.getByTestId('knowledge-source-item-eb-1')).toBeTruthy();
    expect(screen.getByTestId('knowledge-source-item-eb-4')).toBeTruthy();
    expect(screen.getByTestId('knowledge-source-item-eb-5')).toBeTruthy();
    expect(screen.getByTestId('knowledge-source-item-eb-6')).toBeTruthy();

    expect(screen.getAllByText('Fifth evidence quote beyond cap').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Sixth evidence quote beyond cap').length).toBeGreaterThanOrEqual(1);
  });

  it('allows clicking evidence block jump button to navigate to source', async () => {
    const onNavigateToSource = vi.fn();
    await act(async () => {
      render(<NotesView initialSelectedNoteId="note-1" onNavigateToSource={onNavigateToSource} />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('knowledge-source-item-eb-1')).toBeTruthy();
    });

    const item1 = screen.getByTestId('knowledge-source-item-eb-1');
    const jumpButton = item1.querySelector('.knowledge-source-jump') as HTMLElement;
    expect(jumpButton).toBeTruthy();

    fireEvent.click(jumpButton);
    expect(onNavigateToSource).toHaveBeenCalledTimes(1);
    expect(onNavigateToSource).toHaveBeenCalledWith(dummyEvidenceBlocks[0]);
  });

  it('displays comments and allows authoring/updating evidence comments', async () => {
    await act(async () => {
      render(<NotesView initialSelectedNoteId="note-1" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Initial comment on first')).toBeTruthy();
    });

    // Item 1 has an existing comment, so it shows 'Edit Note'
    const item1 = screen.getByTestId('knowledge-source-item-eb-1');
    const editBtn = item1.querySelector('button[title="Edit user comment"]') as HTMLElement;
    expect(editBtn).toBeTruthy();

    fireEvent.click(editBtn);

    // Textarea should now be open
    const textarea = screen.getByRole('textbox', { name: /edit evidence comment/i });
    expect(textarea).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe('Initial comment on first');

    fireEvent.change(textarea, { target: { value: 'Updated comment text' } });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(mockUpdateEvidenceBlockComment).toHaveBeenCalledWith('eb-1', 'Updated comment text');
  });

  it('allows authoring review prompts from evidence blocks via Remember button', async () => {
    await act(async () => {
      render(<NotesView initialSelectedNoteId="note-1" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('knowledge-source-item-eb-1')).toBeTruthy();
    });

    const item1 = screen.getByTestId('knowledge-source-item-eb-1');
    const rememberBtn = item1.querySelector('button[title*="Create review prompt"]') as HTMLElement;
    expect(rememberBtn).toBeTruthy();

    fireEvent.click(rememberBtn);

    // PromptEditorModal should be opened with evidence context
    expect(screen.getByTestId('prompt-editor-modal')).toBeTruthy();
    expect(screen.getByTestId('prompt-modal-title').textContent).toBe('Evidence p.1');
    expect(screen.getByTestId('prompt-modal-quote').textContent).toBe('First evidence quote');
  });

  it('supports collapsing and expanding the Sources section in sidebar', async () => {
    await act(async () => {
      render(<NotesView initialSelectedNoteId="note-1" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('knowledge-source-item-eb-1')).toBeTruthy();
    });

    const collapseButton = screen.getByRole('button', { name: /collapse/i });
    fireEvent.click(collapseButton);

    // When collapsed, the list is not shown and button changes to 'Expand'
    expect(screen.queryByTestId('knowledge-source-item-eb-1')).toBeNull();
    expect(screen.getByRole('button', { name: /expand/i })).toBeTruthy();

    // Clicking Expand restores the list
    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(screen.getByTestId('knowledge-source-item-eb-1')).toBeTruthy();
  });

  it('supports responsive note details sidebar toggle', async () => {
    await act(async () => {
      render(<NotesView initialSelectedNoteId="note-1" />);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /note details/i })).toBeTruthy();
    });

    const toggleBtn = screen.getByRole('button', { name: /note details/i });
    const workspace = document.querySelector('.knowledge-workspace') as HTMLElement;
    expect(workspace.className).not.toContain('show-details');

    fireEvent.click(toggleBtn);
    expect(workspace.className).toContain('show-details');
    expect(toggleBtn.textContent).toBe('Hide details');

    fireEvent.click(toggleBtn);
    expect(workspace.className).not.toContain('show-details');
    expect(toggleBtn.textContent).toBe('Note details');
  });

  it('reactively synchronizes initialSelectedNoteId prop changes into active note selection', async () => {
    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(<NotesView initialSelectedNoteId="note-1" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-editor-note-id').textContent).toBe('note-1');
    });

    // Rerender with a new initialSelectedNoteId (e.g. from deep link or router)
    await act(async () => {
      rendered.rerender(<NotesView initialSelectedNoteId="note-2" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-editor-note-id').textContent).toBe('note-2');
    });
  });

  it('allows clicking note links to switch displayed note in NotesView', async () => {
    await act(async () => {
      render(<NotesView initialSelectedNoteId="note-1" />);
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-editor-note-id').textContent).toBe('note-1');
    });

    // Click note-2 link button inside NoteEditor
    const openNote2Btn = screen.getByTestId('mock-editor-open-note-2');
    await act(async () => {
      fireEvent.click(openNote2Btn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-editor-note-id').textContent).toBe('note-2');
    });
  });
});
