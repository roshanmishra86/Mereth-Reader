import { describe, expect, it } from 'vitest';
import {
  AnnotationRecord,
  ANNOTATION_TYPES,
  buildAreaAnnotation,
  buildAreaAssetRecord,
  buildBookmarkAnnotation,
  buildCommentAnnotation,
  buildTextAnnotation,
  computeAnnotationChecksum,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_ANNOTATION_PALETTE,
  isTextAnnotationType,
  paletteColorFor,
  paletteEntryForColor,
  paletteLabelFor,
  physicalPageFor,
  withAlpha,
} from './annotationTypes';
import { selectReanchorActions } from './versionAnchoring';

const VERSION_V1 = 'version-v1';
const VERSION_V2 = 'version-v2';
const DOC = 'doc-1';

function baseInput(overrides: Partial<Parameters<typeof buildTextAnnotation>[0]> = {}) {
  return {
    documentId: DOC,
    documentVersionId: VERSION_V1,
    pageIndex: 2,
    pageLabel: 'iii',
    type: 'highlight' as const,
    rects: [{ x: 0.1, y: 0.2, width: 0.6, height: 0.04 }],
    quote: 'The plaintiff moves for summary judgment',
    prefix: 'Here, ',
    suffix: ' on the merits.',
    textLayerChecksum: 'abc123',
    ...overrides,
  };
}

describe('creation checksum parity with task 3.3 re-anchoring', () => {
  it('selectReanchorActions recomputes the same checksum creation would compute', () => {
    const record: AnnotationRecord = buildTextAnnotation(baseInput({ type: 'underline' }));
    const pageTextByNumber = new Map<number, string>([
      [record.page_index + 1, `junk ${record.quote} junk`],
    ]);

    // The re-anchor plan for a NEW version must compute exactly what
    // creation-time checksumming would produce for that version.
    const expected = computeAnnotationChecksum({
      documentVersionId: VERSION_V2,
      pageIndex: record.page_index,
      annotationType: record.annotation_type,
      firstRect: record.rects[0],
      exactQuote: record.quote,
    });

    const plan = selectReanchorActions({
      annotations: [
        {
          id: record.id,
          document_version_id: VERSION_V1,
          annotation_type: record.annotation_type,
          page_index: record.page_index,
          rects: record.rects,
          quote: record.quote,
          prefix_text: record.prefix_text,
          suffix_text: record.suffix_text,
        },
      ],
      newVersionId: VERSION_V2,
      pageTextByNumber,
    });

    expect(plan.reanchor).toHaveLength(1);
    expect(plan.reanchor[0].newChecksum).toBe(expected);
    expect(plan.detached).toHaveLength(0);
  });

  it('stores the version-bound checksum at creation with the same inputs', () => {
    const record = buildTextAnnotation(baseInput({ type: 'highlight' }));
    const expected = computeAnnotationChecksum({
      documentVersionId: record.document_version_id,
      pageIndex: record.page_index,
      annotationType: record.annotation_type,
      firstRect: record.rects[0],
      exactQuote: record.quote,
    });
    expect(record.checksum).toBe(expected);
  });
});

describe('annotation builders', () => {
  it('highlight/underline carry quote, prefix/suffix, rects, checksum, provenance', () => {
    const record = buildTextAnnotation(baseInput({ type: 'highlight', comment: 'Central claim' }));
    expect(record.annotation_type).toBe('highlight');
    expect(record.quote).toBe('The plaintiff moves for summary judgment');
    expect(record.prefix_text).toBe('Here, ');
    expect(record.suffix_text).toBe(' on the merits.');
    expect(record.text_layer_checksum).toBe('abc123');
    expect(record.rects).toEqual([{ x: 0.1, y: 0.2, width: 0.6, height: 0.04 }]);
    expect(record.comment).toBe('Central claim');
    expect(record.provenance).toBe('user_authored');
    expect(record.document_version_id).toBe(VERSION_V1);
    expect(record.page_index).toBe(2);
    expect(record.page_label).toBe('iii');
    expect(record.deleted_at).toBeNull();
    expect(record.tags).toEqual([]);
    expect(record.checksum.length).toBe(64);
    expect(Number.isNaN(Date.parse(record.created_at))).toBe(false);
    expect(record.updated_at).toBe(record.created_at);
  });

  it('rejects text annotations without a quote or rects (FR-9.4)', () => {
    expect(() => buildTextAnnotation(baseInput({ quote: '   ' }))).toThrow(/quote/);
    expect(() => buildTextAnnotation(baseInput({ rects: [] }))).toThrow(/rectangle/);
  });

  it('area annotations carry exactly one crop rect and no quote (FR-9.7)', () => {
    const record = buildAreaAnnotation({
      documentId: DOC,
      documentVersionId: VERSION_V1,
      pageIndex: 0,
      pageLabel: '1',
      rect: { x: 0.2, y: 0.3, width: 0.4, height: 0.25 },
      caption: 'Figure 1',
    });
    expect(record.annotation_type).toBe('area');
    expect(record.quote).toBe('');
    expect(record.rects).toHaveLength(1);
    expect(record.color).toBe(DEFAULT_ANNOTATION_COLOR);
    expect(() =>
      buildAreaAnnotation({
        documentId: DOC,
        documentVersionId: VERSION_V1,
        pageIndex: 0,
        pageLabel: '1',
        rect: { x: 0, y: 0, width: 0, height: 0 },
      })
    ).toThrow(/crop/);
  });

  it('comment annotations require text and anchor rects, never a quote (FR-9.1/9.5)', () => {
    const record = buildCommentAnnotation({
      documentId: DOC,
      documentVersionId: VERSION_V1,
      pageIndex: 1,
      pageLabel: '2',
      rects: [{ x: 0.5, y: 0.5, width: 0.01, height: 0.01 }],
      comment: 'Revisit this',
    });
    expect(record.annotation_type).toBe('comment');
    expect(record.quote).toBe('');
    expect(record.comment).toBe('Revisit this');
    expect(() =>
      buildCommentAnnotation({
        documentId: DOC,
        documentVersionId: VERSION_V1,
        pageIndex: 1,
        pageLabel: '2',
        rects: [],
        comment: '',
      })
    ).toThrow();
  });

  it('bookmarks are page markers without geometry or quote', () => {
    const record = buildBookmarkAnnotation({
      documentId: DOC,
      documentVersionId: VERSION_V1,
      pageIndex: 5,
      pageLabel: '6',
    });
    expect(record.annotation_type).toBe('bookmark');
    expect(record.rects).toEqual([]);
    expect(record.quote).toBe('');
    expect(physicalPageFor(record)).toBe(6);
  });

  it('asset records carry kind, dimensions, and provenance (FR-9.7)', () => {
    const asset = buildAreaAssetRecord({
      id: 'asset-1',
      annotationId: 'ann-1',
      documentId: DOC,
      relativePath: 'annotations/asset-1.png',
      widthPx: 640,
      heightPx: 480,
      caption: 'Fig',
    });
    expect(asset.asset_kind).toBe('area_capture');
    expect(asset.content_type).toBe('image/png');
    expect(asset.provenance).toBe('user_authored');
    expect(() =>
      buildAreaAssetRecord({
        id: 'a',
        annotationId: 'b',
        documentId: DOC,
        relativePath: 'annotations/a.png',
        widthPx: 0,
        heightPx: 1,
        caption: '',
      })
    ).toThrow(/dimensions/);
  });
});

describe('semantic palette (FR-9.3 defaults)', () => {
  it('ships five labelled colours with unique keys and colours', () => {
    expect(DEFAULT_ANNOTATION_PALETTE).toHaveLength(5);
    const keys = new Set(DEFAULT_ANNOTATION_PALETTE.map((e) => e.key));
    const colors = new Set(DEFAULT_ANNOTATION_PALETTE.map((e) => e.color));
    expect(keys.size).toBe(5);
    expect(colors.size).toBe(5);
    for (const entry of DEFAULT_ANNOTATION_PALETTE) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(paletteColorFor('claim')).toBe('#d9bd3a');
    expect(paletteLabelFor('evidence')).toBe('Evidence');
  });

  it('falls back gracefully for unknown keys', () => {
    expect(paletteColorFor('nope')).toBe('#9b9797');
    expect(paletteLabelFor('nope')).toBe('nope');
    expect(paletteEntryForColor('#123456')).toBeUndefined();
  });

  it('withAlpha produces rgba fills', () => {
    expect(withAlpha('#d9bd3a', 0.45)).toBe('rgba(217, 189, 58, 0.45)');
    expect(withAlpha('#ec3013', 1)).toBe('rgba(236, 48, 19, 1)');
    expect(withAlpha('red', 0.5)).toBe('red');
  });
});

describe('type vocabulary', () => {
  it('matches the Rust ANNOTATION_TYPES set exactly (FR-9.1)', () => {
    expect(ANNOTATION_TYPES).toEqual(['highlight', 'underline', 'area', 'comment', 'bookmark']);
    expect(isTextAnnotationType('highlight')).toBe(true);
    expect(isTextAnnotationType('underline')).toBe(true);
    for (const other of ['area', 'comment', 'bookmark']) {
      expect(isTextAnnotationType(other)).toBe(false);
    }
  });
});
