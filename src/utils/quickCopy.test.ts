import { describe, expect, it } from 'vitest';
import { formatQuickCopy, type QuickCopyItem } from './quickCopy';

const annotation: QuickCopyItem = { kind: 'annotation', record: {
  id: 'ann-1', document_id: 'doc-1', document_version_id: 'v1', checksum: '', annotation_type: 'highlight', page_index: 4, page_label: '5', rects: [], quote: 'Retrieval practice improves delayed retention.', prefix_text: '', suffix_text: '', text_layer_checksum: null, comment: 'Use this in the review note.', color: 'evidence', tags: [], deleted_at: null, created_at: '2026-08-21T00:00:00Z', updated_at: '2026-08-21T00:00:00Z', provenance: 'source_extracted',
}, source: { sourceTitle: 'Learning Study', sourceAuthor: 'Karpicke', sourceYear: 2008 } };

describe('Quick Copy (FR-14.1)', () => {
  it('keeps quotation, comment, page reference, and deep link visibly distinct in Markdown', () => {
    const output = formatQuickCopy(annotation);
    expect(output).toContain('> Retrieval practice improves delayed retention.');
    expect(output).toContain('**User comment:** Use this in the review note.');
    expect(output).toContain('Karpicke (2008), p. 5');
    expect(output).toContain('mereth://document/doc-1?page=4&annotation=ann-1');
  });

  it('uses explicit labels in plain text', () => {
    const output = formatQuickCopy(annotation, 'plain');
    expect(output).toContain('QUOTATION');
    expect(output).toContain('USER COMMENT');
    expect(output).toContain('SOURCE REFERENCE');
  });

  it('copies note bodies without pretending prose is quotation', () => {
    const note: QuickCopyItem = { kind: 'note', record: { id: 'note-1', note_type: 'concept', title: 'A claim', body_markdown: 'My own synthesis.', created_at: 'now', updated_at: 'now', provenance: 'user_authored' } };
    const output = formatQuickCopy(note);
    expect(output).toContain('# A claim');
    expect(output).toContain('My own synthesis.');
    expect(output).not.toContain('> My own synthesis.');
  });
});
