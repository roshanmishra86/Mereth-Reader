import { describe, it, expect } from 'vitest';
import { validateConceptTitleGuidance, createDefaultNoteRecord, isAutoDerivedTitle } from './notesTypes';

describe('notesTypes and Concept Title Guidance (Task 4.1 / FR-10.4)', () => {
  it('encourages non-empty titles', () => {
    const res = validateConceptTitleGuidance('');
    expect(res.isStrongTitle).toBe(false);
    expect(res.suggestion).toContain('Enter a complete claim');
  });

  it('detects questions as strong concept titles', () => {
    const res1 = validateConceptTitleGuidance('Why does testing improve delayed memory retention?');
    expect(res1.isStrongTitle).toBe(true);
    expect(res1.isQuestion).toBe(true);

    const res2 = validateConceptTitleGuidance('How do sleep spindles consolidate memories?');
    expect(res2.isStrongTitle).toBe(true);
    expect(res2.isQuestion).toBe(true);
  });

  it('detects complete claims with common predicates as strong titles', () => {
    const res1 = validateConceptTitleGuidance('Retrieval practice produces durable memory traces');
    expect(res1.isStrongTitle).toBe(true);
    expect(res1.isClaim).toBe(true);

    const res2 = validateConceptTitleGuidance('Interleaving enhances discrimination learning');
    expect(res2.isStrongTitle).toBe(true);
    expect(res2.isClaim).toBe(true);
  });

  it('flags 1-2 word broad topic nouns with helpful suggestions', () => {
    const res1 = validateConceptTitleGuidance('Spaced repetition');
    expect(res1.isStrongTitle).toBe(false);
    expect(res1.suggestion).toContain('State a complete claim');

    const res2 = validateConceptTitleGuidance('Memory');
    expect(res2.isStrongTitle).toBe(false);
    expect(res2.suggestion).toContain('State a complete claim');
  });

  it('creates default NoteRecord with expected fields and defaults', () => {
    const note = createDefaultNoteRecord({
      note_type: 'concept',
      title: 'Testing enhances learning',
    });
    expect(note.id).toBeTruthy();
    expect(note.note_type).toBe('concept');
    expect(note.title).toBe('Testing enhances learning');
    expect(note.body_markdown).toBe('');
    expect(note.document_id).toBeNull();
    expect(note.deleted_at).toBeNull();
    expect(note.provenance).toBe('user_authored');
  });

  describe('isAutoDerivedTitle', () => {
    it('returns true for default placeholders', () => {
      expect(isAutoDerivedTitle('Quick note', 'Some content')).toBe(true);
      expect(isAutoDerivedTitle('Untitled', 'Some content')).toBe(true);
      expect(isAutoDerivedTitle('', 'Some content')).toBe(true);
      expect(isAutoDerivedTitle('   ', 'Some content')).toBe(true);
    });

    it('returns true when title matches the first line of the body', () => {
      const body = 'Initial scratch thought\nMore text';
      expect(isAutoDerivedTitle('Initial scratch thought', body)).toBe(true);
    });

    it('returns false when title is an explicit custom name', () => {
      expect(isAutoDerivedTitle('Chapter 3: Working Memory', 'First line of my notes')).toBe(false);
      expect(isAutoDerivedTitle('Custom Concept Title', 'Some random body text')).toBe(false);
    });
  });
});
