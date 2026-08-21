import { describe, expect, it } from 'vitest';
import { createDefaultPromptRecord } from './promptTypes';
import { exportReviewPromptsTable } from './reviewExport';

describe('review prompt export (FR-14.5)', () => {
  it('exports RFC-4180-compatible CSV with quoted fields', () => {
    const prompt = createDefaultPromptRecord({
      id: 'p1',
      annotation_id: 'a1',
      question: 'What is "retrieval"?',
      answer: 'Recall, not recognition',
      status: 'adopted',
    });
    const csv = exportReviewPromptsTable([{
      prompt,
      sourceReference: 'Book, p. 4',
      events: [{ id: 'e1', prompt_id: 'p1', reviewed_at: 'now', outcome: 'good', duration_ms: 1, user_response: 'Typed, answer', provenance: 'user_authored' }],
    }], 'csv');
    expect(csv).toContain('"What is ""retrieval""?"');
    expect(csv).toContain('"Book, p. 4"');
    expect(csv).toContain('"Typed, answer"');
  });

  it('exports TSV without tabs or newlines inside fields', () => {
    const prompt = createDefaultPromptRecord({ id: 'p1', question: 'Line\nbreak', answer: 'A\tB' });
    const tsv = exportReviewPromptsTable([{ prompt, sourceReference: 'Source', events: [] }], 'tsv');
    expect(tsv).toContain('Line break');
    expect(tsv).toContain('A B');
  });
});

