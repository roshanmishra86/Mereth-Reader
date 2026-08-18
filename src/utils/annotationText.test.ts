import { describe, expect, it } from 'vitest';
import { AnnotationRecord } from './annotationTypes';
import { annotationCopyText, formatAnnotationComment, formatAnnotationQuotation } from './annotationText';

function record(overrides: Partial<AnnotationRecord>): AnnotationRecord {
  return {
    id: 'a1',
    document_id: 'd1',
    document_version_id: 'v1',
    checksum: 'c',
    annotation_type: 'highlight',
    page_index: 2,
    page_label: 'iii',
    rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.04 }],
    quote: 'The plaintiff moves for summary judgment',
    prefix_text: 'Here, ',
    suffix_text: ' on the merits.',
    text_layer_checksum: 't',
    comment: 'Central claim',
    color: 'claim',
    tags: [],
    deleted_at: null,
    created_at: '2026-08-04T13:52:57Z',
    updated_at: '2026-08-04T13:52:57Z',
    provenance: 'user_authored',
    ...overrides,
  };
}

describe('quote/comment separation (FR-9.5)', () => {
  it('highlight: quote and comment are distinct fields, body is the quote', () => {
    const text = annotationCopyText(record({}));
    expect(text.quote).toBe('The plaintiff moves for summary judgment');
    expect(text.comment).toBe('Central claim');
    expect(text.body).toBe(text.quote);
    // The quotation formatter never mixes the comment into the quotation.
    expect(formatAnnotationQuotation(record({}))).toBe('“The plaintiff moves for summary judgment” (p. iii)');
    expect(formatAnnotationComment(record({}))).toBe('Central claim');
  });

  it('comment-type annotations carry no quote — formatting returns null, never inventing one', () => {
    const commentRec = record({ annotation_type: 'comment', quote: '', comment: 'Revisit this' });
    const text = annotationCopyText(commentRec);
    expect(text.quote).toBeNull();
    expect(text.comment).toBe('Revisit this');
    expect(formatAnnotationQuotation(commentRec)).toBeNull();
    expect(formatAnnotationComment(commentRec)).toBe('Revisit this');
    // Even a maliciously-duplicated string must not pass as a quotation.
    const sneaky = record({ annotation_type: 'bookmark', quote: '', comment: '“fake quote”' });
    expect(formatAnnotationQuotation(sneaky)).toBeNull();
  });

  it('area captures present as captions, never as quoted source', () => {
    const area = record({ annotation_type: 'area', quote: '', comment: 'Figure 3' });
    const text = annotationCopyText(area);
    expect(text.quote).toBeNull();
    expect(text.body).toBe('Area capture: Figure 3');
    expect(formatAnnotationQuotation(area)).toBeNull();
  });

  it('page reference uses the visible label with physical fallback', () => {
    expect(annotationCopyText(record({ page_label: '42' })).pageRef).toBe('42');
    expect(annotationCopyText(record({ page_label: '' })).pageRef).toBe('3');
  });

  it('a comment identical to the quote is not emitted as a separate comment', () => {
    const same = record({ comment: 'The plaintiff moves for summary judgment' });
    expect(formatAnnotationComment(same)).toBeNull();
    expect(formatAnnotationQuotation(same)).not.toBeNull();
  });
});
