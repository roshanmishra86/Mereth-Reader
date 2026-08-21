import { describe, it, expect } from 'vitest';
import { splitNoteContent } from './noteSplit';
import { createDefaultNoteRecord } from './notesTypes';

describe('noteSplit utility', () => {
  it('splits selected text into new concept note and embeds wiki-link in original', () => {
    const original = createDefaultNoteRecord({
      id: 'orig-1',
      note_type: 'concept',
      title: 'General Reading Notes',
      body_markdown: 'Intro paragraph.\n\nRetrieval practice produces durable memory traces.\n\nConcluding remarks.',
    });

    const result = splitNoteContent({
      originalNote: original,
      selectedText: 'Retrieval practice produces durable memory traces.',
      newTitle: 'Retrieval practice produces durable memory traces',
    });

    // Original body has replaced the excerpt with wiki-link
    expect(result.updatedOriginalNote.body_markdown).toContain(`[[mereth:note/${result.newConceptNote.id}|Retrieval practice produces durable memory traces]]`);
    expect(result.updatedOriginalNote.body_markdown).not.toContain('Retrieval practice produces durable memory traces.\n\nConcluding');

    // New concept note has the content
    expect(result.newConceptNote.title).toBe('Retrieval practice produces durable memory traces');
    expect(result.newConceptNote.body_markdown).toContain('Retrieval practice produces durable memory traces.');

    // Forward link created
    expect(result.forwardLink.note_id).toBe('orig-1');
    expect(result.forwardLink.target_note_id).toBe(result.newConceptNote.id);

    // Atomicity check
    expect(result.atomicityWarning).toBeNull();
  });

  it('provides non-blocking atomicity warning for topic-only titles', () => {
    const original = createDefaultNoteRecord({
      id: 'orig-2',
      note_type: 'concept',
      title: 'Psychology Notes',
      body_markdown: 'Some thoughts on memory.',
    });

    const result = splitNoteContent({
      originalNote: original,
      selectedText: 'Some thoughts on memory.',
      newTitle: 'Memory',
    });

    expect(result.atomicityWarning).not.toBeNull();
    expect(result.atomicityWarning).toContain('State a complete claim');
    // Note is still created without blocking
    expect(result.newConceptNote.title).toBe('Memory');
  });
});
