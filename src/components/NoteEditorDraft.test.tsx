// @vitest-environment happy-dom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NoteEditor, type NoteEditorHandle } from './NoteEditor';
import { createDefaultNoteRecord } from '../utils/notesTypes';
import { getRecoverableDraft } from '../utils/noteRevisions';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock('../utils/noteLinks', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/noteLinks')>(),
  syncNoteLinks: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => { cleanup(); localStorage.clear(); });

it('persists a related link without deadlocking and retains newer typing in WAL', async () => {
  const ref = React.createRef<NoteEditorHandle>();
  const note = createDefaultNoteRecord({ id: 'related-link-race', note_type: 'concept', body_markdown: 'Original' });
  let finish!: () => void;
  const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<NoteEditor ref={ref} note={note} revisions={[]} onSave={onSave} />);
  let saving!: Promise<void>;
  act(() => { saving = ref.current!.addRelatedLink('target', 'Target'); });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(getRecoverableDraft(note.id)?.bodyMarkdown).toContain('mereth:note/target');
  const body = screen.getByPlaceholderText('Write in Markdown. Type [[ to link another note.');
  fireEvent.change(body, { target: { value: `${ref.current!.getCurrentDraft().bodyMarkdown}\nNew typing` } });
  await act(async () => { finish(); await saving; });
  expect(getRecoverableDraft(note.id)?.bodyMarkdown).toContain('New typing');
  onSave.mockResolvedValue(undefined);
  await act(async () => { await ref.current!.flush(); });
  expect(getRecoverableDraft(note.id)).toBeNull();
});
