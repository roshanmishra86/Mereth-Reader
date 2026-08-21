import { describe, it, expect } from 'vitest';
import {
  lintPromptQuality,
  createDefaultPromptRecord,
  promptHasSource,
} from './promptTypes';

describe('promptTypes utility functions', () => {
  it('creates default prompt record with draft status and focused_qa type', () => {
    const record = createDefaultPromptRecord({
      annotation_id: 'ann-1',
      question: 'What is spacing effect?',
      answer: 'Spaced practice improves recall.',
    });

    expect(record.status).toBe('draft');
    expect(record.adopted_at).toBeNull();
    expect(record.prompt_type).toBe('focused_qa');
    expect(record.annotation_id).toBe('ann-1');
  });

  it('lints prompt quality and warns on empty or short question', () => {
    const emptyLint = lintPromptQuality({ question: '' });
    expect(emptyLint.isValid).toBe(false);
    expect(emptyLint.issues[0].message).toContain('cannot be empty');

    const shortLint = lintPromptQuality({ question: 'Why?' });
    expect(shortLint.isValid).toBe(true);
    expect(shortLint.issues.some((i) => i.message.includes('very short'))).toBe(true);
  });

  it('warns on multiple question marks and vague cues', () => {
    const compoundLint = lintPromptQuality({
      question: 'What is retrieval practice? How does it help?',
      cue: 'What is this?',
    });

    expect(compoundLint.issues.some((i) => i.message.includes('Multiple question marks'))).toBe(true);
    expect(compoundLint.issues.some((i) => i.message.includes('Cue is vague'))).toBe(true);
  });

  it('validates cloze deletion syntax', () => {
    const badCloze = lintPromptQuality({
      prompt_type: 'cloze',
      question: 'The capital of France is Paris.',
    });
    expect(badCloze.issues.some((i) => i.message.includes('require {{c1::hidden text}}'))).toBe(true);

    const goodCloze = lintPromptQuality({
      prompt_type: 'cloze',
      question: 'The capital of France is {{c1::Paris}}.',
    });
    expect(goodCloze.issues.some((i) => i.message.includes('require {{c1::hidden text}}'))).toBe(false);
  });

  it('detects weak binary question framing without blocking save', () => {
    const lint = lintPromptQuality({
      prompt_type: 'focused_qa',
      question: 'Does retrieval practice improve delayed recall?',
    });

    expect(lint.isValid).toBe(true);
    expect(lint.issues.some((i) => i.message.includes('Binary yes/no framing'))).toBe(true);
  });

  it('identifies whether a prompt is linked to at least one source', () => {
    expect(promptHasSource({ annotation_id: null, note_id: null })).toBe(false);
    expect(promptHasSource({ annotation_id: 'ann-1', note_id: null })).toBe(true);
    expect(promptHasSource({ annotation_id: null, note_id: 'note-1' })).toBe(true);
  });
});
