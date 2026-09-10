// @vitest-environment happy-dom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { RightPane, type ReaderProps } from '../main';
import { createDefaultNoteRecord, type NoteRecord, type NoteSourceAnchorRecord } from '../utils/notesTypes';
import type { DocumentRecord } from '../utils/pdfImport';
import { DEFAULT_APPEARANCE_PREFERENCES } from '../utils/appearanceUtils';

// Mock Tauri APIs called by main.tsx dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn().mockReturnValue(false),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    onDragDropEvent: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

// Mock notes IO
const mockListNotes = vi.fn<() => Promise<NoteRecord[]>>();
const mockListNoteSourceAnchors = vi.fn<() => Promise<NoteSourceAnchorRecord[]>>();
const mockUpdateNote = vi.fn<(id: string, title: string, body: string) => Promise<NoteRecord>>();
const mockTrashNote = vi.fn<(id: string) => Promise<void>>();

vi.mock('../utils/notesIo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/notesIo')>();
  return {
    ...actual,
    listNotes: () => mockListNotes(),
    listNoteSourceAnchors: () => mockListNoteSourceAnchors(),
    updateNote: (id: string, title: string, body: string) => mockUpdateNote(id, title, body),
    trashNote: (id: string) => mockTrashNote(id),
  };
});

function createMockReaderProps(overrides?: Partial<ReaderProps>): ReaderProps {
  const dummyDoc: DocumentRecord = {
    id: 'doc-1',
    title: 'Test Document',
    filepath: '/path/to/doc.pdf',
    page_count: 10,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    sha256_hash: 'hash-123',
    provenance: 'local',
    ownership_mode: 'managed_library',
  };

  return {
    activeAnnotation: null,
    activeDocument: dummyDoc,
    activeSession: null,
    appearance: DEFAULT_APPEARANCE_PREFERENCES,
    documentName: 'Test Document',
    leftOpen: false,
    readingOnly: false,
    rightOpen: true,
    rightTab: 'note',
    selected: '',
    totalPages: 10,
    annotationsList: [],
    currentVersionId: 'ver-1',
    versionHash: 'hash-123',
    openGeneration: 1,
    trashedAnnotations: [],
    palette: [],
    onAnnotationCreated: vi.fn().mockResolvedValue(undefined),
    onAreaAnnotationCreated: vi.fn().mockResolvedValue(undefined),
    onAnnotationUpdated: vi.fn().mockResolvedValue(undefined),
    onTrashAnnotation: vi.fn().mockResolvedValue(undefined),
    onRestoreAnnotation: vi.fn().mockResolvedValue(undefined),
    onPurgeAnnotation: vi.fn().mockResolvedValue(undefined),
    onUndoAnnotation: vi.fn().mockResolvedValue(undefined),
    undoCount: 0,
    setImportOpen: vi.fn(),
    setLeftOpen: vi.fn(),
    setReadingOnly: vi.fn(),
    setRightOpen: vi.fn(),
    setRightTab: vi.fn(),
    setSelected: vi.fn(),
    ...overrides,
  };
}

describe('RightPane Note Draft Controller', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockListNoteSourceAnchors.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it('retains draft B when typing while draft A save is in flight and never overwrites it with draft A', async () => {
    const initialNote = createDefaultNoteRecord({
      id: 'note-1',
      note_type: 'scratch' as const,
      title: 'Quick note',
      body_markdown: 'Original text',
      document_id: 'doc-1',
    });
    mockListNotes.mockResolvedValue([initialNote]);

    let resolveSaveA: ((note: NoteRecord) => void) | null = null;
    mockUpdateNote.mockImplementation((id, title, body) => {
      if (body === 'Draft A') {
        return new Promise<NoteRecord>((resolve) => {
          resolveSaveA = resolve;
        });
      }
      return Promise.resolve(
        createDefaultNoteRecord({
          id,
          note_type: 'scratch' as const,
          title,
          body_markdown: body,
          document_id: 'doc-1',
        })
      );
    });

    render(<RightPane {...createMockReaderProps()} />);

    // Wait for document notes to render and open the note
    await waitFor(() => {
      expect(screen.getByText('Quick note')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Quick note'));
    });

    // Note drawer is open
    const textarea = screen.getByLabelText('Note body') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Original text');

    // 1. User types Draft A
    fireEvent.change(textarea, { target: { value: 'Draft A' } });
    expect(textarea.value).toBe('Draft A');

    // Debounce timer (400ms) expires, triggering save for Draft A
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(mockUpdateNote).toHaveBeenCalledWith('note-1', 'Draft A', 'Draft A');

    // 2. While Draft A save is in-flight, user types Draft B!
    fireEvent.change(textarea, { target: { value: 'Draft B' } });
    expect(textarea.value).toBe('Draft B');

    // 3. Draft A resolves with saved record
    await act(async () => {
      resolveSaveA!(
        createDefaultNoteRecord({
          id: 'note-1',
          note_type: 'scratch' as const,
          title: 'Draft A',
          body_markdown: 'Draft A',
          document_id: 'doc-1',
        })
      );
    });

    // 4. Verify textarea STILL retains Draft B and was never overwritten by Draft A save response!
    expect(textarea.value).toBe('Draft B');

    // 5. Next debounce timer expires for Draft B
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(mockUpdateNote).toHaveBeenCalledWith('note-1', 'Draft B', 'Draft B');
    expect(textarea.value).toBe('Draft B');
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('preserves explicit note titles when body is updated', async () => {
    const explicitNote = createDefaultNoteRecord({
      id: 'note-2',
      note_type: 'scratch' as const,
      title: 'Chapter 3: Working Memory Architecture',
      body_markdown: 'Initial body paragraph',
      document_id: 'doc-1',
    });
    const autoDerivedNote = createDefaultNoteRecord({
      id: 'note-3',
      note_type: 'scratch' as const,
      title: 'Quick note',
      body_markdown: '',
      document_id: 'doc-1',
    });

    mockListNotes.mockResolvedValue([explicitNote, autoDerivedNote]);
    mockUpdateNote.mockImplementation((id, title, body) =>
      Promise.resolve(
        createDefaultNoteRecord({
          id,
          note_type: 'scratch' as const,
          title,
          body_markdown: body,
          document_id: 'doc-1',
        })
      )
    );

    render(<RightPane {...createMockReaderProps()} />);

    // 1. Select the explicitly titled note
    await waitFor(() => {
      expect(screen.getByText('Chapter 3: Working Memory Architecture')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Chapter 3: Working Memory Architecture'));
    });

    const textarea = screen.getByLabelText('Note body') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Initial body paragraph');

    // Type a new first line in the body
    fireEvent.change(textarea, {
      target: { value: 'New first line of text\nSecond line with details' },
    });

    // Flush save via blur
    await act(async () => {
      fireEvent.blur(textarea);
    });

    // The explicit title MUST be preserved, NOT replaced with "New first line of text"
    expect(mockUpdateNote).toHaveBeenCalledWith(
      'note-2',
      'Chapter 3: Working Memory Architecture',
      'New first line of text\nSecond line with details'
    );

    // 2. Now select the auto-derived note
    await act(async () => {
      fireEvent.click(screen.getByText('Quick note'));
    });
    const textareaAuto = screen.getByLabelText('Note body') as HTMLTextAreaElement;

    // Type a new first line in the auto-derived note
    fireEvent.change(textareaAuto, {
      target: { value: 'Auto-derived Concept Title\nBody details' },
    });

    await act(async () => {
      fireEvent.blur(textareaAuto);
    });

    // Auto-derived title should update to the first line
    expect(mockUpdateNote).toHaveBeenCalledWith(
      'note-3',
      'Auto-derived Concept Title',
      'Auto-derived Concept Title\nBody details'
    );
  });

  it('retains failed drafts for retry on failure and prevents closing drawer', async () => {
    const initialNote = createDefaultNoteRecord({
      id: 'note-1',
      note_type: 'scratch' as const,
      title: 'Quick note',
      body_markdown: 'Initial persisted body',
      document_id: 'doc-1',
    });
    mockListNotes.mockResolvedValue([initialNote]);

    let shouldFail = true;
    mockUpdateNote.mockImplementation((id, title, body) => {
      if (shouldFail) {
        return Promise.reject(new Error('Network or database failure'));
      }
      return Promise.resolve(
        createDefaultNoteRecord({
          id,
          note_type: 'scratch' as const,
          title,
          body_markdown: body,
          document_id: 'doc-1',
        })
      );
    });

    render(<RightPane {...createMockReaderProps()} />);

    await waitFor(() => {
      expect(screen.getByText('Quick note')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Quick note'));
    });

    const textarea = screen.getByLabelText('Note body') as HTMLTextAreaElement;

    // Type new draft content
    fireEvent.change(textarea, { target: { value: 'Draft that will fail to persist' } });

    // Flush save
    await act(async () => {
      fireEvent.blur(textarea);
    });

    // Save failed: verify noteSaveState is error and retry button is shown
    expect(screen.getByText(/save failed/i)).toBeTruthy();
    const retryButton = screen.getByRole('button', { name: /retry/i });
    expect(retryButton).toBeTruthy();

    // Draft is retained in textarea
    expect(textarea.value).toBe('Draft that will fail to persist');

    // Pressing Escape MUST NOT close the drawer when save failed
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.getByLabelText('Note body')).toBeTruthy();
    expect(textarea.value).toBe('Draft that will fail to persist');

    // Clicking close drawer '×' button MUST NOT close the drawer when save failed
    const closeButton = screen.getByLabelText('Close note detail');
    await act(async () => {
      fireEvent.click(closeButton);
    });
    expect(screen.getByLabelText('Note body')).toBeTruthy();
    expect(textarea.value).toBe('Draft that will fail to persist');

    // Now resolve failure and retry save
    shouldFail = false;
    const currentRetry = screen.getByRole('button', { name: /retry/i });
    await act(async () => {
      fireEvent.click(currentRetry);
      await vi.runAllTimersAsync();
    });

    // Save succeeded: shows Saved and retains draft
    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeTruthy();
    });
    expect(textarea.value).toBe('Draft that will fail to persist');

    // Now pressing Escape closes the drawer cleanly
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByLabelText('Note body')).toBeNull();
  });

  it('flushes pending save on window beforeunload', async () => {
    const initialNote = createDefaultNoteRecord({
      id: 'note-1',
      note_type: 'scratch' as const,
      title: 'Quick note',
      body_markdown: 'Initial body',
      document_id: 'doc-1',
    });
    mockListNotes.mockResolvedValue([initialNote]);
    mockUpdateNote.mockImplementation((id, title, body) =>
      Promise.resolve(
        createDefaultNoteRecord({
          id,
          note_type: 'scratch' as const,
          title,
          body_markdown: body,
          document_id: 'doc-1',
        })
      )
    );

    render(<RightPane {...createMockReaderProps()} />);

    await waitFor(() => {
      expect(screen.getByText('Quick note')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Quick note'));
    });

    const textarea = screen.getByLabelText('Note body') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Draft typed before tab close' } });

    // Dispatch beforeunload event
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    // Verify updateNote was called with the pending draft
    expect(mockUpdateNote).toHaveBeenCalledWith(
      'note-1',
      'Draft typed before tab close',
      'Draft typed before tab close'
    );
  });
});
