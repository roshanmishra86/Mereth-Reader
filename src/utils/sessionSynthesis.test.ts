import { describe, expect, it } from 'vitest';
import {
  SESSION_SYNTHESIS_QUESTIONS,
  buildSynthesisNoteMarkdown,
  completeSynthesisAttempt,
  createSessionSynthesisState,
  skipSynthesisAttempt,
  updateSynthesisAnswer,
} from './sessionSynthesis';
import type { AnnotationRecord } from './annotationTypes';

describe('session synthesis', () => {
  it('creates the four PRD recall questions', () => {
    const state = createSessionSynthesisState();
    expect(state.answers.map((answer) => answer.question)).toEqual([...SESSION_SYNTHESIS_QUESTIONS]);
    expect(state.sourceVisible).toBe(false);
  });

  it('keeps sources hidden until completion or explicit skip', () => {
    const draft = updateSynthesisAnswer(createSessionSynthesisState(), 0, 'A central claim.');
    expect(draft.sourceVisible).toBe(false);
    expect(completeSynthesisAttempt(draft).sourceVisible).toBe(true);
    expect(skipSynthesisAttempt(draft).sourceVisible).toBe(true);
  });

  it('builds a synthesis note from answers and session annotations', () => {
    const state = completeSynthesisAttempt(updateSynthesisAnswer(createSessionSynthesisState(), 1, 'The result was surprising.'));
    const annotation: AnnotationRecord = {
      id: 'a1',
      document_id: 'd1',
      document_version_id: 'v1',
      checksum: 'c',
      annotation_type: 'highlight',
      page_index: 2,
      page_label: '3',
      rects: [],
      quote: 'retrieval practice improves recall',
      prefix_text: '',
      suffix_text: '',
      text_layer_checksum: null,
      comment: '',
      color: 'claim',
      tags: [],
      deleted_at: null,
      created_at: '2026-08-21T00:00:00Z',
      updated_at: '2026-08-21T00:00:00Z',
      provenance: 'user_authored',
    };
    const markdown = buildSynthesisNoteMarkdown(state, [annotation]);
    expect(markdown).toContain('The result was surprising.');
    expect(markdown).toContain('p. 3');
  });
});

