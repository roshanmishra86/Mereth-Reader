import { describe, it, expect } from 'vitest';
import {
  createEvidenceBlockFromAnnotation,
  buildEvidenceDeepLink,
  parseEvidenceDeepLink,
  EvidenceBlockRecord,
} from './evidenceTypes';
import type { AnnotationRecord } from './annotationTypes';
import type { DocumentRecord } from './pdfImport';

describe('evidenceTypes', () => {
  const dummyDoc: DocumentRecord = {
    id: 'doc-42',
    title: 'The Principles of Psychology',
    filepath: '/path/to/psych.pdf',
    sha256_hash: 'dummyhash',
    page_count: 500,
    author: 'William James',
    ownership_mode: 'open_in_place',
    provenance: 'source_extracted',
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
  };

  const dummyAnn: AnnotationRecord = {
    id: 'ann-101',
    document_id: 'doc-42',
    document_version_id: 'ver-1',
    checksum: 'chk-abc',
    annotation_type: 'highlight',
    page_index: 12,
    page_label: 'xiii',
    rects: [],
    quote: 'Stream of thought flows continuously.',
    prefix_text: '',
    suffix_text: '',
    text_layer_checksum: null,
    comment: 'Key insight on consciousness',
    color: 'emerald',
    tags: ['consciousness', 'stream'],
    deleted_at: null,
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
    provenance: 'source_extracted',
  };

  it('creates an EvidenceBlockRecord from annotation and document', () => {
    const block = createEvidenceBlockFromAnnotation({
      noteId: 'note-1',
      annotation: dummyAnn,
      document: dummyDoc,
      pageIndex: dummyAnn.page_index,
      pageLabel: dummyAnn.page_label,
      sourceKind: 'quote',
      userComment: 'Must quote in intro',
    });

    expect(block.note_id).toBe('note-1');
    expect(block.annotation_id).toBe('ann-101');
    expect(block.document_id).toBe('doc-42');
    expect(block.page_index).toBe(12);
    expect(block.page_label).toBe('xiii');
    expect(block.quote).toBe('Stream of thought flows continuously.');
    expect(block.color).toBe('emerald');
    expect(block.tags).toEqual(['consciousness', 'stream']);
    expect(block.user_comment).toBe('Must quote in intro');
    expect(block.source_kind).toBe('quote');
    expect(block.provenance).toBe('source_extracted');
  });

  it('builds canonical deep link URLs for in-context return', () => {
    const linkWithAnn = buildEvidenceDeepLink('doc-42', 12, 'ann-101');
    expect(linkWithAnn).toBe('mereth://document/doc-42?page=12&annotation=ann-101');

    const linkWithoutAnn = buildEvidenceDeepLink('doc-42', 12);
    expect(linkWithoutAnn).toBe('mereth://document/doc-42?page=12');
  });

  it('parses valid deep link URLs', () => {
    const parsed = parseEvidenceDeepLink('mereth://document/doc-42?page=12&annotation=ann-101');
    expect(parsed).toEqual({
      documentId: 'doc-42',
      pageIndex: 12,
      annotationId: 'ann-101',
    });

    const parsedSimple = parseEvidenceDeepLink('mereth://document/doc-99?page=3');
    expect(parsedSimple).toEqual({
      documentId: 'doc-99',
      pageIndex: 3,
      annotationId: null,
    });
  });

  it('returns null for invalid deep link URLs', () => {
    expect(parseEvidenceDeepLink('https://example.com')).toBeNull();
    expect(parseEvidenceDeepLink('mereth://note/123')).toBeNull();
    expect(parseEvidenceDeepLink('')).toBeNull();
  });
});
