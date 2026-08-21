import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  createNote,
  getNote,
  listNotes,
  updateNote,
  trashNote,
  restoreNote,
  purgeNote,
  getNoteRevisions,
  restoreNoteRevision,
  promoteScratchNote,
} from './notesIo';
import { NoteRecord } from './notesTypes';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('notesIo Typed IPC Bridge (Task 4.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockNote: NoteRecord = {
    id: 'note-101',
    note_type: 'concept',
    title: 'Testing strengthens recall',
    body_markdown: '# Concept Note\n\nContent here.',
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
    provenance: 'user_authored',
  };

  it('delegates createNote to db_add_note', async () => {
    vi.mocked(invoke).mockResolvedValue(mockNote);
    const result = await createNote(mockNote);
    expect(invoke).toHaveBeenCalledWith('db_add_note', { note: mockNote });
    expect(result).toEqual(mockNote);
  });

  it('delegates getNote to db_get_note', async () => {
    vi.mocked(invoke).mockResolvedValue(mockNote);
    const result = await getNote('note-101');
    expect(invoke).toHaveBeenCalledWith('db_get_note', { id: 'note-101' });
    expect(result).toEqual(mockNote);
  });

  it('delegates listNotes with filters', async () => {
    vi.mocked(invoke).mockResolvedValue([mockNote]);
    const result = await listNotes({ noteType: 'concept', includeTrash: false });
    expect(invoke).toHaveBeenCalledWith('db_list_notes', {
      includeTrash: false,
      noteType: 'concept',
      documentId: null,
    });
    expect(result).toHaveLength(1);
  });

  it('delegates updateNote to db_update_note', async () => {
    vi.mocked(invoke).mockResolvedValue({ ...mockNote, title: 'Updated Title' });
    const result = await updateNote('note-101', 'Updated Title', 'New Body', true);
    expect(invoke).toHaveBeenCalledWith('db_update_note', {
      id: 'note-101',
      title: 'Updated Title',
      bodyMarkdown: 'New Body',
      createRevision: true,
    });
    expect(result.title).toBe('Updated Title');
  });

  it('delegates trashNote, restoreNote, purgeNote', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await trashNote('note-101');
    expect(invoke).toHaveBeenCalledWith('db_trash_note', { id: 'note-101' });

    await restoreNote('note-101');
    expect(invoke).toHaveBeenCalledWith('db_restore_note', { id: 'note-101' });

    await purgeNote('note-101');
    expect(invoke).toHaveBeenCalledWith('db_purge_note', { id: 'note-101' });
  });

  it('delegates getNoteRevisions and restoreNoteRevision', async () => {
    const mockRevision = {
      id: 'rev-1',
      note_id: 'note-101',
      revision_number: 1,
      title: 'Initial Title',
      body_markdown: 'Initial Body',
      created_at: '2026-08-21T00:00:00Z',
      provenance: 'user_authored',
    };
    vi.mocked(invoke).mockResolvedValue([mockRevision]);
    const revs = await getNoteRevisions('note-101');
    expect(invoke).toHaveBeenCalledWith('db_get_note_revisions', { noteId: 'note-101' });
    expect(revs).toEqual([mockRevision]);

    vi.mocked(invoke).mockResolvedValue(mockNote);
    const restored = await restoreNoteRevision('note-101', 1);
    expect(invoke).toHaveBeenCalledWith('db_restore_note_revision', {
      noteId: 'note-101',
      revisionNumber: 1,
    });
    expect(restored).toEqual(mockNote);
  });

  it('delegates promoteScratchNote', async () => {
    vi.mocked(invoke).mockResolvedValue({ ...mockNote, note_type: 'concept' });
    const promoted = await promoteScratchNote('note-scratch', 'concept');
    expect(invoke).toHaveBeenCalledWith('db_promote_scratch_note', {
      id: 'note-scratch',
      targetType: 'concept',
      documentId: null,
    });
    expect(promoted.note_type).toBe('concept');
  });
});
